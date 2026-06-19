import {
  MSG_OFFSCREEN_PING,
  MSG_TRANSCODE_ACK,
  MSG_TRANSCODE_OFFSCREEN,
  MSG_TRANSCODE_START,
  type OffscreenPingRequest,
  type OffscreenPongResponse,
  type TranscodeAckResponse,
  type TranscodeOffscreenRequest,
  type TranscodeStartRequest,
} from '@/src/messaging/types';

const OFFSCREEN_PATH = 'offscreen.html';
const OFFSCREEN_READY_RETRIES = 30;
const OFFSCREEN_READY_DELAY_MS = 100;

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

export default defineBackground(() => {
  console.log('[Reddit Voice Notes] Background service worker started', {
    id: browser.runtime.id,
    offscreenApi: Boolean(getChromeOffscreen()?.createDocument),
  });

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (isOffscreenTarget(message)) return;

    const request = message as TranscodeStartRequest;
    if (request?.type !== MSG_TRANSCODE_START) return;

    (async () => {
      try {
        const offscreenRequest: TranscodeOffscreenRequest = {
          type: MSG_TRANSCODE_OFFSCREEN,
          target: 'offscreen',
          jobId: request.jobId,
          webm: request.webm,
        };

        await dispatchToOffscreen(offscreenRequest);

        const ack: TranscodeAckResponse = {
          type: MSG_TRANSCODE_ACK,
          jobId: request.jobId,
          ok: true,
        };
        sendResponse(ack);
      } catch (error) {
        const ack: TranscodeAckResponse = {
          type: MSG_TRANSCODE_ACK,
          jobId: request.jobId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
        sendResponse(ack);
      }
    })();

    return true;
  });
});