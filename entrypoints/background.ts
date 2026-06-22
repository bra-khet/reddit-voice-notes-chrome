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
import { packBinary, unpackBinary } from '@/src/messaging/binary';
import { getBackgroundAsset } from '@/src/storage/image-db';
import { saveLastRecording } from '@/src/storage/last-recording-db';
import { saveLastBaseMp4 } from '@/src/storage/last-base-mp4-db';
import { loadLastBakedMp4 } from '@/src/storage/last-baked-mp4-db';
import {
  BAKED_MP4_CHUNK_BYTES,
  MSG_GET_BAKED_MP4_CHUNK,
  MSG_GET_BAKED_MP4_META,
  type BakedMp4ChunkPayload,
  type BakedMp4MetaPayload,
  type GetBakedMp4ChunkRequest,
  type GetBakedMp4MetaRequest,
} from '@/src/messaging/baked-mp4-blob';
import {
  LAST_RECORDING_READY_KEY,
  SESSION_TRANSCRIPT_READY_KEY,
} from '@/src/settings/user-preferences';
import { saveSessionTranscript } from '@/src/storage/session-transcript-db';
import type { TranscriptResult } from '@/src/transcription/types';
import { designStudioExtensionUrl } from '@/src/ui/design-studio/open-design-studio';
import {
  MSG_OFFSCREEN_PING,
  MSG_OPEN_DESIGN_STUDIO,
  MSG_SAVE_LAST_RECORDING,
  MSG_SAVE_LAST_BASE_MP4,
  MSG_SAVE_SESSION_TRANSCRIPT,
  MSG_TRANSCODE_ACK,
  MSG_TRANSCODE_CANCEL,
  MSG_TRANSCODE_COMPLETE,
  MSG_TRANSCODE_OFFSCREEN,
  MSG_TRANSCODE_PROGRESS,
  MSG_TRANSCODE_START,
  MSG_TRANSCRIBE_ACK,
  MSG_TRANSCRIBE_CANCEL,
  MSG_TRANSCRIBE_COMPLETE,
  MSG_TRANSCRIBE_OFFSCREEN,
  MSG_TRANSCRIBE_PROGRESS,
  MSG_TRANSCRIBE_START,
  MSG_BURNIN_ACK,
  MSG_BURNIN_CANCEL,
  MSG_BURNIN_COMPLETE,
  MSG_BURNIN_OFFSCREEN,
  MSG_BURNIN_PROGRESS,
  MSG_BURNIN_START,
  type BurnInAckResponse,
  type BurnInCancelRequest,
  type BurnInCompleteMessage,
  type BurnInOffscreenRequest,
  type BurnInProgressMessage,
  type BurnInStartRequest,
  type OffscreenPingRequest,
  type OffscreenPongResponse,
  type SaveLastRecordingRequest,
  type SaveLastRecordingResponse,
  type SaveLastBaseMp4Request,
  type SaveLastBaseMp4Response,
  type SaveSessionTranscriptRequest,
  type SaveSessionTranscriptResponse,
  type TranscodeAckResponse,
  type TranscodeCancelRequest,
  type TranscodeCompleteMessage,
  type TranscodeOffscreenRequest,
  type TranscodeProgressMessage,
  type TranscodeStartRequest,
  type TranscribeAckResponse,
  type TranscribeCancelRequest,
  type TranscribeCompleteMessage,
  type TranscribeOffscreenRequest,
  type TranscribeProgressMessage,
  type TranscribeStartRequest,
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
const activeTranscodeJobByTabId = new Map<number, string>();
const transcribeTabByJobId = new Map<string, number>();
const activeTranscribeJobByTabId = new Map<number, string>();
const burnInTabByJobId = new Map<string, number>();
const activeBurnInJobByTabId = new Map<number, string>();

let activeRelayJobs = 0;
let keepAliveInterval: ReturnType<typeof setInterval> | null = null;

function startRelayKeepAlive(): void {
  activeRelayJobs += 1;
  if (keepAliveInterval) return;

  // BUG FIX: FFmpeg stuck at 0% in production zip/build loads
  // Fix: MV3 service worker sleeps after relay; poll runtime while offscreen jobs run (WXT dev does this automatically).
  keepAliveInterval = setInterval(() => {
    void browser.runtime.getPlatformInfo().catch(() => {
      // Service worker may be shutting down.
    });
  }, KEEP_ALIVE_INTERVAL_MS);
}

function stopRelayKeepAlive(): void {
  activeRelayJobs = Math.max(0, activeRelayJobs - 1);
  if (activeRelayJobs === 0 && keepAliveInterval) {
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
    if (tabId !== undefined && activeTranscodeJobByTabId.get(tabId) === message.jobId) {
      activeTranscodeJobByTabId.delete(tabId);
    }
    transcodeTabByJobId.delete(message.jobId);
    stopRelayKeepAlive();
  }
}

function isExtensionPageTabUrl(url: string | undefined): boolean {
  return Boolean(url?.startsWith('chrome-extension://') || url?.startsWith('moz-extension://'));
}

function relayBurnInBroadcast(message: BurnInProgressMessage | BurnInCompleteMessage): void {
  const tabId = burnInTabByJobId.get(message.jobId);
  if (tabId === undefined) {
    console.warn('[Reddit Voice Notes] No tab registered for burn-in relay', message.jobId);
    return;
  }

  // Design Studio extension pages receive offscreen runtime broadcasts directly (no content script).
  void browser.tabs.get(tabId).then((tab) => {
    if (isExtensionPageTabUrl(tab.url)) return;
    void browser.tabs.sendMessage(tabId, message).catch((error) => {
      console.warn('[Reddit Voice Notes] Burn-in tab relay failed:', error);
    });
  });

  if (message.type === MSG_BURNIN_COMPLETE) {
    const tabId = burnInTabByJobId.get(message.jobId);
    if (tabId !== undefined && activeBurnInJobByTabId.get(tabId) === message.jobId) {
      activeBurnInJobByTabId.delete(tabId);
    }
    burnInTabByJobId.delete(message.jobId);
    stopRelayKeepAlive();
  }
}

function relayTranscribeBroadcast(message: TranscribeProgressMessage | TranscribeCompleteMessage): void {
  const tabId = transcribeTabByJobId.get(message.jobId);
  if (tabId === undefined) {
    console.warn('[Reddit Voice Notes] No tab registered for transcribe relay', message.jobId);
    return;
  }

  void browser.tabs.sendMessage(tabId, message).catch((error) => {
    console.warn('[Reddit Voice Notes] Transcribe tab relay failed:', error);
  });

  if (message.type === MSG_TRANSCRIBE_COMPLETE) {
    const tabId = transcribeTabByJobId.get(message.jobId);
    if (tabId !== undefined && activeTranscribeJobByTabId.get(tabId) === message.jobId) {
      activeTranscribeJobByTabId.delete(tabId);
    }
    transcribeTabByJobId.delete(message.jobId);
    stopRelayKeepAlive();
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

async function cancelOffscreenTranscribeJob(jobId: string): Promise<void> {
  const cancel: TranscribeCancelRequest = {
    type: MSG_TRANSCRIBE_CANCEL,
    target: 'offscreen',
    jobId,
  };
  try {
    await ensureOffscreenDocument();
    await browser.runtime.sendMessage(cancel);
  } catch (error) {
    console.warn('[Reddit Voice Notes] Offscreen transcribe cancel failed:', jobId, error);
  }
}

async function registerTranscodeTab(jobId: string, senderTabId: number | undefined): Promise<void> {
  if (senderTabId !== undefined) {
    const previousJobId = activeTranscodeJobByTabId.get(senderTabId);
    if (previousJobId && previousJobId !== jobId) {
      console.warn('[Reddit Voice Notes] Superseding in-flight transcode', {
        tabId: senderTabId,
        previousJobId,
        jobId,
      });
      transcodeTabByJobId.delete(previousJobId);
      void cancelOffscreenJob(previousJobId);
    }
    activeTranscodeJobByTabId.set(senderTabId, jobId);
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

async function registerBurnInTab(jobId: string, senderTabId: number | undefined): Promise<void> {
  if (senderTabId !== undefined) {
    const previousJobId = activeBurnInJobByTabId.get(senderTabId);
    if (previousJobId && previousJobId !== jobId) {
      console.warn('[Reddit Voice Notes] Superseding in-flight burn-in', {
        tabId: senderTabId,
        previousJobId,
        jobId,
      });
      burnInTabByJobId.delete(previousJobId);
      void cancelOffscreenJob(previousJobId);
    }
    activeBurnInJobByTabId.set(senderTabId, jobId);
    burnInTabByJobId.set(jobId, senderTabId);
    return;
  }

  const tabs = await browser.tabs.query({ url: [...REDDIT_TAB_URLS] });
  const target = tabs.find((tab) => tab.active) ?? tabs[0];
  if (target?.id !== undefined) {
    burnInTabByJobId.set(jobId, target.id);
    return;
  }

  console.warn('[Reddit Voice Notes] Could not resolve Reddit tab for burn-in relay', jobId);
}

async function registerTranscribeTab(jobId: string, senderTabId: number | undefined): Promise<void> {
  if (senderTabId !== undefined) {
    const previousJobId = activeTranscribeJobByTabId.get(senderTabId);
    if (previousJobId && previousJobId !== jobId) {
      console.warn('[Reddit Voice Notes] Superseding in-flight transcribe', {
        tabId: senderTabId,
        previousJobId,
        jobId,
      });
      transcribeTabByJobId.delete(previousJobId);
      void cancelOffscreenTranscribeJob(previousJobId);
    }
    activeTranscribeJobByTabId.set(senderTabId, jobId);
    transcribeTabByJobId.set(jobId, senderTabId);
    return;
  }

  const tabs = await browser.tabs.query({ url: [...REDDIT_TAB_URLS] });
  const target = tabs.find((tab) => tab.active) ?? tabs[0];
  if (target?.id !== undefined) {
    transcribeTabByJobId.set(jobId, target.id);
    return;
  }

  console.warn('[Reddit Voice Notes] Could not resolve Reddit tab for transcribe relay', jobId);
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

function validateBurnInStartRequest(request: BurnInStartRequest): void {
  if (!request.jobId) {
    throw new Error('Burn-in request missing jobId.');
  }
  if (!request.mp4Base64 || request.mp4ByteLength <= 0) {
    throw new Error(`MP4 payload missing at burn-in relay (bytes=${request.mp4ByteLength}).`);
  }
  if (!request.segmentsJson?.trim()) {
    throw new Error('Subtitle segments JSON missing at burn-in relay.');
  }
  if (!request.styleJson?.trim()) {
    throw new Error('Subtitle style JSON missing at burn-in relay.');
  }

  const expectedChars = expectedBase64CharLength(request.mp4ByteLength);
  if (Math.abs(request.mp4Base64.length - expectedChars) > 4) {
    throw new Error(
      `MP4 base64 length mismatch at burn-in relay (bytes=${request.mp4ByteLength}, chars=${request.mp4Base64.length}, expected≈${expectedChars}).`,
    );
  }
}

function validateTranscribeStartRequest(request: TranscribeStartRequest): void {
  if (!request.jobId) {
    throw new Error('Transcribe request missing jobId.');
  }
  if (!request.webmBase64 || request.webmByteLength <= 0) {
    throw new Error(`WebM payload missing at transcribe relay (bytes=${request.webmByteLength}).`);
  }

  const expectedChars = expectedBase64CharLength(request.webmByteLength);
  if (Math.abs(request.webmBase64.length - expectedChars) > 4) {
    throw new Error(
      `WebM base64 length mismatch at transcribe relay (bytes=${request.webmByteLength}, chars=${request.webmBase64.length}, expected≈${expectedChars}).`,
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

async function dispatchToOffscreen(
  request: TranscodeOffscreenRequest | TranscribeOffscreenRequest | BurnInOffscreenRequest,
): Promise<void> {
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

function relayBurnInFailure(jobId: string, error: unknown): void {
  const completeMsg: BurnInCompleteMessage = {
    type: MSG_BURNIN_COMPLETE,
    jobId,
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
  relayBurnInBroadcast(completeMsg);
}

function relayTranscribeFailure(jobId: string, error: unknown): void {
  const completeMsg: TranscribeCompleteMessage = {
    type: MSG_TRANSCRIBE_COMPLETE,
    jobId,
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
  relayTranscribeBroadcast(completeMsg);
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

let cachedBakedMp4Bytes: Uint8Array | null = null;
let cachedBakedMp4Mime = 'video/mp4';
let cachedBakedMp4SavedAt = 0;

async function loadBakedMp4Bytes(): Promise<Uint8Array | null> {
  const snapshot = await loadLastBakedMp4();
  if (!snapshot?.blob) return null;
  if (cachedBakedMp4SavedAt === snapshot.meta.savedAt && cachedBakedMp4Bytes) {
    return cachedBakedMp4Bytes;
  }
  cachedBakedMp4Bytes = new Uint8Array(await snapshot.blob.arrayBuffer());
  cachedBakedMp4Mime = snapshot.meta.mimeType || 'video/mp4';
  cachedBakedMp4SavedAt = snapshot.meta.savedAt;
  return cachedBakedMp4Bytes;
}

function bakedMp4Meta(bytes: Uint8Array, mimeType: string, savedAt: number): BakedMp4MetaPayload {
  const chunkCount = Math.max(1, Math.ceil(bytes.length / BAKED_MP4_CHUNK_BYTES));
  return {
    ok: true,
    mimeType,
    totalByteLength: bytes.length,
    chunkCount,
    savedAt,
  };
}

function bakedMp4Chunk(bytes: Uint8Array, chunkIndex: number): BakedMp4ChunkPayload {
  const start = chunkIndex * BAKED_MP4_CHUNK_BYTES;
  if (start >= bytes.length) {
    return { ok: false, chunkIndex, error: 'Chunk index out of range.' };
  }
  const slice = bytes.subarray(start, Math.min(start + BAKED_MP4_CHUNK_BYTES, bytes.length));
  const packed = packBinary(slice);
  return {
    ok: true,
    chunkIndex,
    dataBase64: packed.dataBase64,
    byteLength: packed.byteLength,
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

      if (type === MSG_OPEN_DESIGN_STUDIO) {
        void browser.tabs
          .create({ url: designStudioExtensionUrl(), active: true })
          .then(() => sendResponse({ ok: true }))
          .catch(() => sendResponse({ ok: false }));
        return true;
      }

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

      if (type === MSG_SAVE_SESSION_TRANSCRIPT) {
        void (async () => {
          const response: SaveSessionTranscriptResponse = { ok: false };
          try {
            const request = message as SaveSessionTranscriptRequest;
            if (!request.transcriptJson?.trim()) {
              response.error = 'Transcript JSON missing for session save.';
              sendResponse(response);
              return;
            }
            const parsed = JSON.parse(request.transcriptJson) as TranscriptResult;
            if (typeof parsed.text !== 'string' || !Array.isArray(parsed.segments)) {
              response.error = 'Transcript JSON shape invalid.';
              sendResponse(response);
              return;
            }
            await saveSessionTranscript(parsed, request.jobId);
            await browser.storage.local.set({ [SESSION_TRANSCRIPT_READY_KEY]: Date.now() });
            response.ok = true;
            sendResponse(response);
          } catch (error) {
            response.error = error instanceof Error ? error.message : String(error);
            sendResponse(response);
          }
        })();
        return true;
      }

      if (type === MSG_GET_BAKED_MP4_META) {
        void (async () => {
          const response: BakedMp4MetaPayload = { ok: false };
          try {
            const bytes = await loadBakedMp4Bytes();
            if (!bytes) {
              response.error = 'No baked MP4 available.';
              sendResponse(response);
              return;
            }
            sendResponse(bakedMp4Meta(bytes, cachedBakedMp4Mime, cachedBakedMp4SavedAt));
          } catch (error) {
            response.error = error instanceof Error ? error.message : String(error);
            sendResponse(response);
          }
        })();
        return true;
      }

      if (type === MSG_GET_BAKED_MP4_CHUNK) {
        void (async () => {
          const response: BakedMp4ChunkPayload = { ok: false };
          try {
            const request = message as GetBakedMp4ChunkRequest;
            const bytes = await loadBakedMp4Bytes();
            if (!bytes) {
              response.error = 'No baked MP4 available.';
              sendResponse(response);
              return;
            }
            sendResponse(bakedMp4Chunk(bytes, request.chunkIndex));
          } catch (error) {
            response.error = error instanceof Error ? error.message : String(error);
            sendResponse(response);
          }
        })();
        return true;
      }

      if (type === MSG_SAVE_LAST_BASE_MP4) {
        void (async () => {
          const response: SaveLastBaseMp4Response = { ok: false };
          try {
            const request = message as SaveLastBaseMp4Request;
            if (!request.mp4Base64 || request.mp4ByteLength <= 0) {
              response.error = 'MP4 payload missing for base export save.';
              sendResponse(response);
              return;
            }
            const bytes = unpackBinary(request.mp4Base64, request.mp4ByteLength);
            const blob = new Blob([Uint8Array.from(bytes)], { type: 'video/mp4' });
            await saveLastBaseMp4(blob, request.durationSeconds);
            response.ok = true;
            sendResponse(response);
          } catch (error) {
            response.error = error instanceof Error ? error.message : String(error);
            sendResponse(response);
          }
        })();
        return true;
      }

      if (type === MSG_SAVE_LAST_RECORDING) {
        void (async () => {
          const response: SaveLastRecordingResponse = { ok: false };
          try {
            const request = message as SaveLastRecordingRequest;
            if (!request.webmBase64 || request.webmByteLength <= 0) {
              response.error = 'WebM payload missing for last recording save.';
              sendResponse(response);
              return;
            }
            const bytes = unpackBinary(request.webmBase64, request.webmByteLength);
            const blob = new Blob([Uint8Array.from(bytes)], { type: 'video/webm' });
            await saveLastRecording(blob, request.durationSeconds);
            // CHANGED: signal Design Studio to reload voice preview without tab visibility flip.
            // WHY: recording completes on Reddit while studio may stay open (eloquent-2 UX).
            await browser.storage.local.set({ [LAST_RECORDING_READY_KEY]: Date.now() });
            response.ok = true;
            sendResponse(response);
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
      if (type === MSG_TRANSCRIBE_CANCEL) {
        const jobId = (message as TranscribeCancelRequest).jobId;
        if (jobId) void cancelOffscreenTranscribeJob(jobId);
        return;
      }
      if (type === MSG_BURNIN_CANCEL) {
        const jobId = (message as BurnInCancelRequest).jobId;
        if (jobId) void cancelOffscreenJob(jobId);
        return;
      }
      if (type === MSG_TRANSCODE_PROGRESS || type === MSG_TRANSCODE_COMPLETE) {
        relayTranscodeBroadcast(
          message as TranscodeProgressMessage | TranscodeCompleteMessage,
        );
        return;
      }
      if (type === MSG_TRANSCRIBE_PROGRESS || type === MSG_TRANSCRIBE_COMPLETE) {
        relayTranscribeBroadcast(
          message as TranscribeProgressMessage | TranscribeCompleteMessage,
        );
        return;
      }
      if (type === MSG_BURNIN_PROGRESS || type === MSG_BURNIN_COMPLETE) {
        relayBurnInBroadcast(message as BurnInProgressMessage | BurnInCompleteMessage);
        return;
      }
    }

    if (isOffscreenTarget(message)) return;

    const transcribeRequest = message as TranscribeStartRequest;
    if (transcribeRequest?.type === MSG_TRANSCRIBE_START) {
      void (async () => {
        let ackSent = false;

        try {
          validateTranscribeStartRequest(transcribeRequest);
          await registerTranscribeTab(transcribeRequest.jobId, sender.tab?.id);
          startRelayKeepAlive();

          const ack: TranscribeAckResponse = {
            type: MSG_TRANSCRIBE_ACK,
            jobId: transcribeRequest.jobId,
            ok: true,
          };
          sendResponse(ack);
          ackSent = true;

          console.log('[Reddit Voice Notes] Relaying WebM to offscreen transcribe', {
            jobId: transcribeRequest.jobId,
            bytes: transcribeRequest.webmByteLength,
            base64Chars: transcribeRequest.webmBase64.length,
            tabId: transcribeTabByJobId.get(transcribeRequest.jobId),
          });

          const offscreenRequest: TranscribeOffscreenRequest = {
            type: MSG_TRANSCRIBE_OFFSCREEN,
            target: 'offscreen',
            jobId: transcribeRequest.jobId,
            webmBase64: transcribeRequest.webmBase64,
            webmByteLength: transcribeRequest.webmByteLength,
            language: transcribeRequest.language,
          };

          await dispatchToOffscreen(offscreenRequest);
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);

          if (!ackSent) {
            const failAck: TranscribeAckResponse = {
              type: MSG_TRANSCRIBE_ACK,
              jobId: transcribeRequest.jobId,
              ok: false,
              error: errMsg,
            };
            sendResponse(failAck);
          } else {
            transcribeTabByJobId.delete(transcribeRequest.jobId);
            stopRelayKeepAlive();
            relayTranscribeFailure(transcribeRequest.jobId, error);
          }
        }
      })();

      return true;
    }

    const burnInRequest = message as BurnInStartRequest;
    if (burnInRequest?.type === MSG_BURNIN_START) {
      void (async () => {
        let ackSent = false;

        try {
          validateBurnInStartRequest(burnInRequest);
          await registerBurnInTab(burnInRequest.jobId, sender.tab?.id);
          startRelayKeepAlive();

          const ack: BurnInAckResponse = {
            type: MSG_BURNIN_ACK,
            jobId: burnInRequest.jobId,
            ok: true,
          };
          sendResponse(ack);
          ackSent = true;

          console.log('[Reddit Voice Notes] Relaying MP4 to offscreen burn-in', {
            jobId: burnInRequest.jobId,
            bytes: burnInRequest.mp4ByteLength,
            base64Chars: burnInRequest.mp4Base64.length,
            tabId: burnInTabByJobId.get(burnInRequest.jobId),
          });

          const offscreenRequest: BurnInOffscreenRequest = {
            type: MSG_BURNIN_OFFSCREEN,
            target: 'offscreen',
            jobId: burnInRequest.jobId,
            mp4Base64: burnInRequest.mp4Base64,
            mp4ByteLength: burnInRequest.mp4ByteLength,
            segmentsJson: burnInRequest.segmentsJson,
            styleJson: burnInRequest.styleJson,
            videoDurationSeconds: burnInRequest.videoDurationSeconds,
            themeBarColor: burnInRequest.themeBarColor,
          };

          await dispatchToOffscreen(offscreenRequest);
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);

          if (!ackSent) {
            const failAck: BurnInAckResponse = {
              type: MSG_BURNIN_ACK,
              jobId: burnInRequest.jobId,
              ok: false,
              error: errMsg,
            };
            sendResponse(failAck);
          } else {
            burnInTabByJobId.delete(burnInRequest.jobId);
            stopRelayKeepAlive();
            relayBurnInFailure(burnInRequest.jobId, error);
          }
        }
      })();

      return true;
    }

    const request = message as TranscodeStartRequest;
    if (request?.type !== MSG_TRANSCODE_START) return;

    void (async () => {
      let ackSent = false;

      try {
        validateTranscodeStartRequest(request);
        await registerTranscodeTab(request.jobId, sender.tab?.id);
        startRelayKeepAlive();

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
          voiceEffect: request.voiceEffect,
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
          stopRelayKeepAlive();
          relayTranscodeFailure(request.jobId, error);
        }
      }
    })();

    return true;
  });
});