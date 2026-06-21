// DISABLED: Keyboard shortcut — see src/reddit-injector/shortcut-handler.ts
// import { MSG_OPEN_RECORDER } from '@/src/messaging/types';
import { expectedBase64CharLength } from '@/src/messaging/binary-verify';
import {
  BACKGROUND_BLOB_CHUNK_BYTES,
  BACKGROUND_BLOB_PORT,
  MSG_GET_BACKGROUND_BLOB,
  MSG_GET_BACKGROUND_BLOB_CHUNK,
  MSG_GET_BACKGROUND_BLOB_META,
  type BackgroundBlobChunkPayload,
  type BackgroundBlobMetaPayload,
  type BackgroundBlobPortMessage,
  type BackgroundBlobPortRequest,
  type GetBackgroundBlobChunkRequest,
  type GetBackgroundBlobMetaRequest,
  type GetBackgroundBlobRequest,
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

async function loadBackgroundBytes(
  id: string,
): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  const record = await getBackgroundAsset(id);
  if (!record) return null;
  return {
    bytes: new Uint8Array(await record.blob.arrayBuffer()),
    mimeType: record.mimeType,
  };
}

function backgroundBlobMeta(bytes: Uint8Array, mimeType: string): BackgroundBlobMetaPayload {
  const chunkCount = Math.max(1, Math.ceil(bytes.length / BACKGROUND_BLOB_CHUNK_BYTES));
  return {
    ok: true,
    mimeType,
    totalByteLength: bytes.length,
    chunkCount,
  };
}

function backgroundBlobChunk(bytes: Uint8Array, chunkIndex: number): BackgroundBlobChunkPayload {
  const start = chunkIndex * BACKGROUND_BLOB_CHUNK_BYTES;
  if (start >= bytes.length) {
    return { ok: false, chunkIndex, error: 'Chunk index out of range.' };
  }
  const slice = bytes.subarray(start, Math.min(start + BACKGROUND_BLOB_CHUNK_BYTES, bytes.length));
  const packed = packBinary(slice);
  return {
    ok: true,
    chunkIndex,
    dataBase64: packed.dataBase64,
    byteLength: packed.byteLength,
  };
}

async function relayBackgroundBlobViaPort(port: browser.runtime.Port, id: string): Promise<void> {
  const loaded = await loadBackgroundBytes(id);
  if (!loaded) {
    port.postMessage({ phase: 'error', ok: false, error: 'Background not found.' } satisfies BackgroundBlobPortMessage);
    return;
  }

  const { bytes, mimeType } = loaded;
  const meta = backgroundBlobMeta(bytes, mimeType);
  port.postMessage({
    phase: 'meta',
    ok: true,
    mimeType: meta.mimeType!,
    totalByteLength: meta.totalByteLength!,
    chunkCount: meta.chunkCount!,
  } satisfies BackgroundBlobPortMessage);

  for (let chunkIndex = 0; chunkIndex < meta.chunkCount!; chunkIndex += 1) {
    const chunk = backgroundBlobChunk(bytes, chunkIndex);
    if (!chunk.ok || !chunk.dataBase64 || chunk.byteLength === undefined) {
      port.postMessage({
        phase: 'error',
        ok: false,
        error: chunk.error ?? 'Failed to pack background chunk.',
      } satisfies BackgroundBlobPortMessage);
      return;
    }
    port.postMessage({
      phase: 'chunk',
      ok: true,
      chunkIndex,
      dataBase64: chunk.dataBase64,
      byteLength: chunk.byteLength,
    } satisfies BackgroundBlobPortMessage);
  }

  port.postMessage({ phase: 'done', ok: true } satisfies BackgroundBlobPortMessage);
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
            port.postMessage({
              phase: 'error',
              ok: false,
              error: 'Missing background id.',
            } satisfies BackgroundBlobPortMessage);
            return;
          }
          await relayBackgroundBlobViaPort(port, id);
        } catch (error) {
          port.postMessage({
            phase: 'error',
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          } satisfies BackgroundBlobPortMessage);
        }
      })();
    });
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (typeof message === 'object' && message !== null && 'type' in message) {
      const type = (message as { type: string }).type;

      if (type === MSG_GET_BACKGROUND_BLOB_META) {
        void (async () => {
          const response: BackgroundBlobMetaPayload = { ok: false };
          try {
            const { id } = message as GetBackgroundBlobMetaRequest;
            const loaded = await loadBackgroundBytes(id);
            if (!loaded) {
              response.error = 'Background not found.';
              sendResponse(response);
              return;
            }
            sendResponse(backgroundBlobMeta(loaded.bytes, loaded.mimeType));
          } catch (error) {
            response.error = error instanceof Error ? error.message : String(error);
            sendResponse(response);
          }
        })();
        return true;
      }

      if (type === MSG_GET_BACKGROUND_BLOB_CHUNK) {
        void (async () => {
          const response: BackgroundBlobChunkPayload = { ok: false };
          try {
            const { id, chunkIndex } = message as GetBackgroundBlobChunkRequest;
            const loaded = await loadBackgroundBytes(id);
            if (!loaded) {
              response.error = 'Background not found.';
              sendResponse(response);
              return;
            }
            sendResponse(backgroundBlobChunk(loaded.bytes, chunkIndex));
          } catch (error) {
            response.error = error instanceof Error ? error.message : String(error);
            sendResponse(response);
          }
        })();
        return true;
      }

      if (type === MSG_GET_BACKGROUND_BLOB) {
        void (async () => {
          sendResponse({
            ok: false,
            error: 'Use chunked background blob relay (meta + chunk messages).',
          } satisfies BackgroundBlobMetaPayload);
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