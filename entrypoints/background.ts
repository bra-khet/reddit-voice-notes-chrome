// DISABLED: Keyboard shortcut — see src/reddit-injector/shortcut-handler.ts
// import { MSG_OPEN_RECORDER } from '@/src/messaging/types';
import {
  MSG_OFFSCREEN_PING,
  MSG_TRANSCODE_ACK,
  MSG_TRANSCODE_COMPLETE,
  MSG_TRANSCODE_OFFSCREEN,
  MSG_TRANSCODE_PROGRESS,
  MSG_TRANSCODE_START,
  type OffscreenPingRequest,
  type OffscreenPongResponse,
  type TranscodeAckResponse,
  type TranscodeCompleteMessage,
  type TranscodeOffscreenRequest,
  type TranscodeProgressMessage,
  type TranscodeStartRequest,
} from '@/src/messaging/types';

const OFFSCREEN_PATH = 'offscreen.html';
const OFFSCREEN_READY_RETRIES = 30;
const OFFSCREEN_READY_DELAY_MS = 100;
const KEEP_ALIVE_INTERVAL_MS = 20_000;

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
    transcodeTabByJobId.delete(message.jobId);
    stopTranscodeKeepAlive();
  }
}

async function registerTranscodeTab(jobId: string, senderTabId: number | undefined): Promise<void> {
  if (senderTabId !== undefined) {
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

export default defineBackground(() => {
  console.log('[Reddit Voice Notes] Background service worker started', {
    id: browser.runtime.id,
    offscreenApi: Boolean(getChromeOffscreen()?.createDocument),
  });

  // DISABLED: chrome.commands shortcut relay — see shortcut-handler.ts
  // browser.commands.onCommand.addListener((command) => { ... });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (isOffscreenTarget(message)) return;

    if (typeof message === 'object' && message !== null && 'type' in message) {
      const type = (message as { type: string }).type;
      if (type === MSG_TRANSCODE_PROGRESS || type === MSG_TRANSCODE_COMPLETE) {
        relayTranscodeBroadcast(
          message as TranscodeProgressMessage | TranscodeCompleteMessage,
        );
        return;
      }
    }

    const request = message as TranscodeStartRequest;
    if (request?.type !== MSG_TRANSCODE_START) return;

    void (async () => {
      try {
        if (!request.webmBase64 || request.webmByteLength <= 0) {
          throw new Error(
            `WebM payload missing at background relay (bytes=${request.webmByteLength}).`,
          );
        }

        await registerTranscodeTab(request.jobId, sender.tab?.id);
        startTranscodeKeepAlive();

        console.log('[Reddit Voice Notes] Relaying WebM to offscreen', {
          jobId: request.jobId,
          bytes: request.webmByteLength,
          base64Chars: request.webmBase64.length,
          tabId: transcodeTabByJobId.get(request.jobId),
        });

        // Ack immediately so the recorder UI leaves 0% while offscreen boots FFmpeg.
        const ack: TranscodeAckResponse = {
          type: MSG_TRANSCODE_ACK,
          jobId: request.jobId,
          ok: true,
        };
        sendResponse(ack);

        const offscreenRequest: TranscodeOffscreenRequest = {
          type: MSG_TRANSCODE_OFFSCREEN,
          target: 'offscreen',
          jobId: request.jobId,
          webmBase64: request.webmBase64,
          webmByteLength: request.webmByteLength,
        };

        await dispatchToOffscreen(offscreenRequest);
      } catch (error) {
        transcodeTabByJobId.delete(request.jobId);
        stopTranscodeKeepAlive();
        relayTranscodeFailure(request.jobId, error);
      }
    })();

    return true;
  });
});