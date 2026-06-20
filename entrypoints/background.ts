import { MSG_OPEN_RECORDER } from '@/src/messaging/types';
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

function relayTranscodeBroadcast(message: TranscodeProgressMessage | TranscodeCompleteMessage): void {
  const tabId = transcodeTabByJobId.get(message.jobId);
  if (tabId === undefined) return;

  void browser.tabs.sendMessage(tabId, message).catch((error) => {
    console.warn('[Reddit Voice Notes] Tab relay failed:', error);
  });

  if (message.type === MSG_TRANSCODE_COMPLETE) {
    transcodeTabByJobId.delete(message.jobId);
  }
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

const COMMAND_OPEN_RECORDER = 'open-voice-recorder';

async function relayOpenRecorderToActiveTab(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    console.warn('[Reddit Voice Notes] Shortcut: no active tab');
    return;
  }

  const url = tab.url ?? '';
  if (!url.includes('reddit.com')) {
    console.warn('[Reddit Voice Notes] Shortcut: active tab is not Reddit', url);
    return;
  }

  try {
    await browser.tabs.sendMessage(tab.id, { type: MSG_OPEN_RECORDER });
  } catch (error) {
    console.error(
      '[Reddit Voice Notes] Shortcut relay failed — hard-refresh the Reddit tab after loading the extension.',
      error,
    );
  }
}

export default defineBackground(() => {
  console.log('[Reddit Voice Notes] Background service worker started', {
    id: browser.runtime.id,
    offscreenApi: Boolean(getChromeOffscreen()?.createDocument),
  });

  browser.commands.onCommand.addListener((command) => {
    if (command !== COMMAND_OPEN_RECORDER) return;
    void relayOpenRecorderToActiveTab();
  });

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

    const tabId = sender.tab?.id;
    if (tabId !== undefined) {
      transcodeTabByJobId.set(request.jobId, tabId);
    }

    (async () => {
      try {
        if (!request.webmBase64 || request.webmByteLength <= 0) {
          throw new Error(
            `WebM payload missing at background relay (bytes=${request.webmByteLength}).`,
          );
        }

        console.log('[Reddit Voice Notes] Relaying WebM to offscreen', {
          jobId: request.jobId,
          bytes: request.webmByteLength,
          base64Chars: request.webmBase64.length,
        });

        const offscreenRequest: TranscodeOffscreenRequest = {
          type: MSG_TRANSCODE_OFFSCREEN,
          target: 'offscreen',
          jobId: request.jobId,
          webmBase64: request.webmBase64,
          webmByteLength: request.webmByteLength,
        };

        await dispatchToOffscreen(offscreenRequest);

        const ack: TranscodeAckResponse = {
          type: MSG_TRANSCODE_ACK,
          jobId: request.jobId,
          ok: true,
        };
        sendResponse(ack);
      } catch (error) {
        transcodeTabByJobId.delete(request.jobId);
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