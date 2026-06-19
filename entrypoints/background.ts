import {
  MSG_TRANSCODE,
  MSG_TRANSCODE_OFFSCREEN,
  type TranscodeOffscreenRequest,
  type TranscodeRequest,
  type TranscodeResponse,
} from '@/src/messaging/types';

const OFFSCREEN_PATH = 'offscreen.html';

type ChromeOffscreenApi = {
  hasDocument?: () => Promise<boolean>;
  createDocument?: (options: {
    url: string;
    reasons: string[];
    justification: string;
  }) => Promise<void>;
  Reason?: { WORKERS: string; BLOBS: string };
};

function getChromeOffscreen(): ChromeOffscreenApi | undefined {
  // chrome.offscreen is Chrome-only — not exposed on the browser polyfill.
  const chromeApi = (globalThis as { chrome?: { offscreen?: ChromeOffscreenApi } }).chrome;
  return chromeApi?.offscreen;
}

let creatingOffscreen: Promise<void> | null = null;

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
      'Offscreen documents are unavailable. Reload the extension after update — Chrome requires the "offscreen" manifest permission (Chrome 109+).',
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

export default defineBackground(() => {
  console.log('[Reddit Voice Notes] Background service worker started', {
    id: browser.runtime.id,
    offscreenApi: Boolean(getChromeOffscreen()?.createDocument),
  });

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const request = message as TranscodeRequest;
    if (request?.type !== MSG_TRANSCODE) return;

    (async () => {
      try {
        await ensureOffscreenDocument();

        const offscreenRequest: TranscodeOffscreenRequest = {
          type: MSG_TRANSCODE_OFFSCREEN,
          target: 'offscreen',
          webm: request.webm,
        };

        const response = (await browser.runtime.sendMessage(
          offscreenRequest,
        )) as TranscodeResponse;

        sendResponse(response);
      } catch (error) {
        const response: TranscodeResponse = {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
        sendResponse(response);
      }
    })();

    return true;
  });
});