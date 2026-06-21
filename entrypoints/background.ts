// DISABLED: Keyboard shortcut — see src/reddit-injector/shortcut-handler.ts
// import { MSG_OPEN_RECORDER } from '@/src/messaging/types';
import { expectedBase64CharLength } from '@/src/messaging/binary-verify';
import {
  BACKGROUND_BLOB_PORT,
  MSG_GET_BACKGROUND_BLOB,
  type BackgroundBlobPortRequest,
  type BackgroundBlobPortResponse,
  type GetBackgroundBlobRequest,
  type GetBackgroundBlobResponse,
} from '@/src/messaging/background-blob';
import { packBinary } from '@/src/messaging/binary';
import { getBackgroundAsset } from '@/src/storage/image-db';
import {
  MSG_OFFSCREEN_PING,
  MSG_TRANSCODE_ACK,
  MSG_TRANSCODE_CANCEL,
  MSG_TRANSCODE_COMPLETE,
  MSG_TRANSCODE_OFFSCREEN,
  MSG_TRANSCODE_PROGRESS,
  MSG_TRANSCODE_START,
  type OffscreenPingRequest,
  type OffscreenPongResponse,
  type TranscodeAckResponse,
  type TranscodeCancelRequest,
  type TranscodeCompleteMessage,
  type TranscodeOffscreenRequest,
  type TranscodeProgressMessage,
  type TranscodeStartRequest,
} from '@/src/messaging/types';

const OFFSCREEN_PATH = 'offscreen.html';
const OFFSCREEN_READY_RETRIES = 30;
const OFFSCREEN_READY_DELAY_MS = 100;
const KEEP_ALIVE_INTERVAL_MS = 5_000;

const REDDIT_TAB_URLS = ['https://www.reddit.com/*', 'https://reddit.com/*'] as const;

type ChromeOffscreenApi = {
  hasDocument?: () => Promise<boolean>;
  createDocument?: (options: {
    url: string;
    reasons: string[];
    justification: string;
  }) => Promise<void>;
  Reason?: { WORKERS: string };
};

function getChromeOffscreen(): ChromeOffscreenApi | undefined {
  const chromeApi = (globalThis as { chrome?: { offscreen?: ChromeOffscreenApi } }).chrome;
  return chromeApi?.offscreen;
}

let creatingOffscreen: Promise<void> | null = null;

// BUG FIX: Transcode progress stuck at 0%
// Fix: Offscreen runtime.sendMessage does not reach content scripts; relay via tabs.sendMessage.
const transcodeTabByJobId = new Map<string, number>();
const activeJobByTabId = new Map<number, string>();

let activeTranscodeJobs = 0;
let keepAliveInterval: ReturnType<typeof setInterval> | null = null;

function startTranscodeKeepAlive(): void {
  activeTranscodeJobs += 1;
  if (keepAliveInterval) return;

  // BUG FIX: FFmpeg stuck at 0% in production zip/build loads
  // Fix: MV3 service worker sleeps after relay; poll runtime while transcodes run (WXT dev does this automatically).
  keepAliveInterval = setInterval(() => {
    void browser.runtime.getPlatformInfo().catch(() => {
      // Service worker may be shutting down.
    });
  }, KEEP_ALIVE_INTERVAL_MS);
}

function stopTranscodeKeepAlive(): void {
  activeTranscodeJobs = Math.max(0, activeTranscodeJobs - 1);
  if (activeTranscodeJobs === 0 && keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

function relayTranscodeBroadcast(message: TranscodeProgressMessage | TranscodeCompleteMessage): void {
  const tabId = transcodeTabByJobId.get(message.jobId);
  if (tabId === undefined) {
    console.warn('[Reddit Voice Notes] No tab registered for transcode relay', message.jobId);
    return;
  }

  void browser.tabs.sendMessage(tabId, message).catch((error) => {
    console.warn('[Reddit Voice Notes] Tab relay failed:', error);
  });

  if (message.type === MSG_TRANSCODE_COMPLETE) {
    const tabId = transcodeTabByJobId.get(message.jobId);
    if (tabId !== undefined && activeJobByTabId.get(tabId) === message.jobId) {
      activeJobByTabId.delete(tabId);
    }
    transcodeTabByJobId.delete(message.jobId);
    stopTranscodeKeepAlive();
  }
}

async function cancelOffscreenJob(jobId: string): Promise<void> {
  const cancel: TranscodeCancelRequest = {
    type: MSG_TRANSCODE_CANCEL,
    target: 'offscreen',
    jobId,
  };
  try {
    await ensureOffscreenDocument();
    await browser.runtime.sendMessage(cancel);
  } catch (error) {
    console.warn('[Reddit Voice Notes] Offscreen cancel failed:', jobId, error);
  }
}

async function registerTranscodeTab(jobId: string, senderTabId: number | undefined): Promise<void> {
  if (senderTabId !== undefined) {
    const previousJobId = activeJobByTabId.get(senderTabId);
    if (previousJobId && previousJobId !== jobId) {
      console.warn('[Reddit Voice Notes] Superseding in-flight transcode', {
        tabId: senderTabId,
        previousJobId,
        jobId,
      });
      transcodeTabByJobId.delete(previousJobId);
      void cancelOffscreenJob(previousJobId);
    }
    activeJobByTabId.set(senderTabId, jobId);
    transcodeTabByJobId.set(jobId, senderTabId);
    return;
  }

  const tabs = await browser.tabs.query({ url: [...REDDIT_TAB_URLS] });
  const target = tabs.find((tab) => tab.active) ?? tabs[0];
  if (target?.id !== undefined) {
    transcodeTabByJobId.set(jobId, target.id);
    return;
  }

  console.warn('[Reddit Voice Notes] Could not resolve Reddit tab for transcode relay', jobId);
}

function isOffscreenTarget(message: unknown): boolean {
  return (
    typeof message === 'object' &&
    message !== null &&
    'target' in message &&
    (message as { target: string }).target === 'offscreen'
  );
}

function validateTranscodeStartRequest(request: TranscodeStartRequest): void {
  if (!request.jobId) {
    throw new Error('Transcode request missing jobId.');
  }
  if (!request.webmBase64 || request.webmByteLength <= 0) {
    throw new Error(`WebM payload missing at background relay (bytes=${request.webmByteLength}).`);
  }

  const expectedChars = expectedBase64CharLength(request.webmByteLength);
  if (Math.abs(request.webmBase64.length - expectedChars) > 4) {
    throw new Error(
      `WebM base64 length mismatch at relay (bytes=${request.webmByteLength}, chars=${request.webmBase64.length}, expected≈${expectedChars}).`,
    );
  }
}

async function hasOffscreenDocument(): Promise<boolean> {
  const offscreen = getChromeOffscreen();
  if (!offscreen?.hasDocument) return false;
  return offscreen.hasDocument();
}

async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) return;
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  const offscreen = getChromeOffscreen();
  if (!offscreen?.createDocument) {
    throw new Error(
      'Offscreen documents are unavailable. Reload the extension — Chrome requires the "offscreen" permission (Chrome 109+).',
    );
  }

  const workersReason = offscreen.Reason?.WORKERS ?? 'WORKERS';

  creatingOffscreen = offscreen
    .createDocument({
      url: browser.runtime.getURL(OFFSCREEN_PATH as never),
      reasons: [workersReason],
      justification: 'FFmpeg WASM transcoding for voice note MP4 export',
    })
    .finally(() => {
      creatingOffscreen = null;
    });

  await creatingOffscreen;
}

async function waitForOffscreenReady(): Promise<void> {
  const ping: OffscreenPingRequest = { type: MSG_OFFSCREEN_PING, target: 'offscreen' };

  for (let attempt = 0; attempt < OFFSCREEN_READY_RETRIES; attempt += 1) {
    try {
      const response = (await browser.runtime.sendMessage(ping)) as OffscreenPongResponse | undefined;
      if (response?.ready) return;
    } catch {
      // Offscreen script may still be loading.
    }
    await new Promise((resolve) => setTimeout(resolve, OFFSCREEN_READY_DELAY_MS));
  }

  throw new Error('FFmpeg offscreen worker failed to start.');
}

async function dispatchToOffscreen(request: TranscodeOffscreenRequest): Promise<void> {
  await ensureOffscreenDocument();
  await waitForOffscreenReady();

  const response = await browser.runtime.sendMessage(request);
  if (response && typeof response === 'object' && 'ok' in response && !(response as { ok: boolean }).ok) {
    throw new Error((response as { error?: string }).error ?? 'Offscreen worker rejected the job.');
  }
}

function relayTranscodeFailure(jobId: string, error: unknown): void {
  const completeMsg: TranscodeCompleteMessage = {
    type: MSG_TRANSCODE_COMPLETE,
    jobId,
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
  relayTranscodeBroadcast(completeMsg);
}

async function readBackgroundBlobForRelay(id: string): Promise<BackgroundBlobPortResponse> {
  const record = await getBackgroundAsset(id);
  if (!record) {
    return { ok: false, error: 'Background not found.' };
  }
  const bytes = new Uint8Array(await record.blob.arrayBuffer());
  const packed = packBinary(bytes);
  return {
    ok: true,
    mimeType: record.mimeType,
    dataBase64: packed.dataBase64,
    byteLength: packed.byteLength,
  };
}

export default defineBackground(() => {
  console.log('[Reddit Voice Notes] Background service worker started', {
    id: browser.runtime.id,
    offscreenApi: Boolean(getChromeOffscreen()?.createDocument),
  });

  // DISABLED: chrome.commands shortcut relay — see shortcut-handler.ts
  // browser.commands.onCommand.addListener((command) => { ... });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== BACKGROUND_BLOB_PORT) return;

    port.onMessage.addListener((message) => {
      void (async () => {
        try {
          const { id } = message as BackgroundBlobPortRequest;
          if (!id) {
            port.postMessage({ ok: false, error: 'Missing background id.' } satisfies BackgroundBlobPortResponse);
            return;
          }
          const payload = await readBackgroundBlobForRelay(id);
          port.postMessage(payload);
        } catch (error) {
          const response: BackgroundBlobPortResponse = {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
          port.postMessage(response);
        }
      })();
    });
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (typeof message === 'object' && message !== null && 'type' in message) {
      const type = (message as { type: string }).type;

      if (type === MSG_GET_BACKGROUND_BLOB) {
        void (async () => {
          const response: GetBackgroundBlobResponse = { ok: false };
          try {
            const { id } = message as GetBackgroundBlobRequest;
            const payload = await readBackgroundBlobForRelay(id);
            sendResponse(payload);
          } catch (error) {
            response.error = error instanceof Error ? error.message : String(error);
            sendResponse(response);
          }
        })();
        return true;
      }

      if (type === MSG_TRANSCODE_CANCEL) {
        const jobId = (message as TranscodeCancelRequest).jobId;
        if (jobId) void cancelOffscreenJob(jobId);
        return;
      }
      if (type === MSG_TRANSCODE_PROGRESS || type === MSG_TRANSCODE_COMPLETE) {
        relayTranscodeBroadcast(
          message as TranscodeProgressMessage | TranscodeCompleteMessage,
        );
        return;
      }
    }

    if (isOffscreenTarget(message)) return;

    const request = message as TranscodeStartRequest;
    if (request?.type !== MSG_TRANSCODE_START) return;

    void (async () => {
      let ackSent = false;

      try {
        validateTranscodeStartRequest(request);
        await registerTranscodeTab(request.jobId, sender.tab?.id);
        startTranscodeKeepAlive();

        const ack: TranscodeAckResponse = {
          type: MSG_TRANSCODE_ACK,
          jobId: request.jobId,
          ok: true,
        };
        sendResponse(ack);
        ackSent = true;

        console.log('[Reddit Voice Notes] Relaying WebM to offscreen', {
          jobId: request.jobId,
          bytes: request.webmByteLength,
          base64Chars: request.webmBase64.length,
          tabId: transcodeTabByJobId.get(request.jobId),
        });

        const offscreenRequest: TranscodeOffscreenRequest = {
          type: MSG_TRANSCODE_OFFSCREEN,
          target: 'offscreen',
          jobId: request.jobId,
          webmBase64: request.webmBase64,
          webmByteLength: request.webmByteLength,
        };

        await dispatchToOffscreen(offscreenRequest);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);

        if (!ackSent) {
          const failAck: TranscodeAckResponse = {
            type: MSG_TRANSCODE_ACK,
            jobId: request.jobId,
            ok: false,
            error: errMsg,
          };
          sendResponse(failAck);
        } else {
          transcodeTabByJobId.delete(request.jobId);
          stopTranscodeKeepAlive();
          relayTranscodeFailure(request.jobId, error);
        }
      }
    })();

    return true;
  });
});