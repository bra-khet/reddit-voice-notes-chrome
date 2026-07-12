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
import { verifyMp4PackedBinary } from '@/src/messaging/binary-verify';
import {
  clearAllRelayTabs,
  forgetRelayTab,
  lookupRelayTab,
  rememberRelayTab,
  resolveActiveRedditTabId,
} from '@/src/messaging/relay-registry';
import { getBackgroundAsset } from '@/src/storage/image-db';
import { saveLastRecording } from '@/src/storage/last-recording-db';
import { loadLastBaseMp4, saveLastBaseMp4 } from '@/src/storage/last-base-mp4-db';
import { loadLastBakedMp4 } from '@/src/storage/last-baked-mp4-db';
import {
  BAKED_MP4_CHUNK_BYTES,
  MSG_GET_BAKED_MP4_CHUNK,
  MSG_GET_BAKED_MP4_META,
  type BakedMp4ChunkPayload,
  type BakedMp4MetaPayload,
  type GetBakedMp4ChunkRequest,
  type GetBakedMp4MetaRequest,
  type TakeMp4Store,
} from '@/src/messaging/baked-mp4-blob';
import {
  LAST_RECORDING_READY_KEY,
  SESSION_TRANSCRIPT_READY_KEY,
} from '@/src/settings/user-preferences';
import { saveSessionTranscript } from '@/src/storage/session-transcript-db';
import { getTakeManager } from '@/src/session/take-manager';
import { prepareTranscribeCompletionForPersistence } from '@/src/transcription/transcribe-completion';
import { TRANSCRIBE_TIMEOUT_MS } from '@/src/transcription/constants';
import type { TranscriptFailureReason, TranscriptResult } from '@/src/transcription/types';
import { designStudioExtensionUrl } from '@/src/ui/design-studio/open-design-studio';
import { BURNIN_PIPELINE_STAMP, OFFSCREEN_WORKER_STAMP } from '@/src/utils/constants';
import {
  MSG_OFFSCREEN_PING,
  MSG_OFFSCREEN_PREWARM,
  MSG_OPEN_DESIGN_STUDIO,
  MSG_SAVE_LAST_RECORDING,
  MSG_SAVE_LAST_BASE_MP4,
  MSG_SAVE_SESSION_TRANSCRIPT,
  MSG_TRANSCODE_ACK,
  MSG_TRANSCODE_CANCEL,
  MSG_TRANSCODE_COMPLETE,
  MSG_TRANSCODE_OFFSCREEN,
  MSG_TRANSCODE_PROGRESS,
  MSG_QUERY_TRANSCODE_INFLIGHT,
  MSG_TRANSCODE_START,
  type QueryTranscodeInflightResponse,
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
// BUG FIX: tab-close transcription had no surviving terminal timeout (BUG-038)
// Fix: allow the offscreen 120s timeout to emit first, then have background publish
//      a terminal timeout if no COMPLETE crossed the context boundary within 5s.
// Sync: transcribe-client.ts CLIENT_COMPLETION_TIMEOUT_MS.
const TRANSCRIBE_COMPLETION_WATCHDOG_MS = TRANSCRIBE_TIMEOUT_MS + 5_000;

type ChromeOffscreenApi = {
  hasDocument?: () => Promise<boolean>;
  closeDocument?: () => Promise<void>;
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
/** Offscreen jobs still running — Studio recovery queries this set. */
const inflightTranscodeJobIds = new Set<string>();
const transcribeTabByJobId = new Map<string, number>();
const activeTranscribeJobByTabId = new Map<number, string>();
const burnInTabByJobId = new Map<string, number>();
const activeBurnInJobByTabId = new Map<number, string>();
/** Design Studio uses runtime.onMessage — skip tabs.sendMessage relay (no content script). */
const burnInSkipTabRelayByJobId = new Map<string, boolean>();
const transcodeSkipTabRelayByJobId = new Map<string, boolean>();
const transcribeSkipTabRelayByJobId = new Map<string, boolean>();

interface TranscribeJobContext {
  durationSeconds: number;
  language?: string;
  watchdog: ReturnType<typeof setTimeout>;
}

// BUG FIX: tab-close transcript completion was owned by a disposable page (BUG-038)
// Fix: background retains the minimum terminal-persistence context and watchdog for
//      each active job; taking/deleting this entry also deduplicates late completions.
// Sync: TranscribeStartRequest.durationSeconds; prepareTranscribeCompletionForPersistence.
const transcribeContextByJobId = new Map<string, TranscribeJobContext>();

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

function normalizeTranscribeDuration(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function clearTranscribeJobContext(jobId: string): void {
  const context = transcribeContextByJobId.get(jobId);
  if (context) clearTimeout(context.watchdog);
  transcribeContextByJobId.delete(jobId);
}

function takeTranscribeJobContext(jobId: string): Omit<TranscribeJobContext, 'watchdog'> | null {
  const context = transcribeContextByJobId.get(jobId);
  if (!context) return null;
  clearTimeout(context.watchdog);
  transcribeContextByJobId.delete(jobId);
  return { durationSeconds: context.durationSeconds, language: context.language };
}

function startTranscribeJobContext(request: TranscribeStartRequest): void {
  clearTranscribeJobContext(request.jobId);
  const watchdog = setTimeout(() => {
    if (!transcribeContextByJobId.has(request.jobId)) return;
    void relayTranscribeBroadcast({
      type: MSG_TRANSCRIBE_COMPLETE,
      jobId: request.jobId,
      ok: false,
      error: `Transcription timed out after ${Math.round(TRANSCRIBE_TIMEOUT_MS / 1000)}s`,
    });
    void cancelOffscreenTranscribeJob(request.jobId);
  }, TRANSCRIBE_COMPLETION_WATCHDOG_MS);

  transcribeContextByJobId.set(request.jobId, {
    durationSeconds: normalizeTranscribeDuration(request.durationSeconds),
    language: request.language,
    watchdog,
  });
}

async function resolveRelayTabId(
  jobId: string,
  memoryMap: Map<string, number>,
  pipeline: string,
): Promise<number | undefined> {
  let tabId = memoryMap.get(jobId);
  if (tabId !== undefined) return tabId;

  tabId = await lookupRelayTab(jobId);
  if (tabId !== undefined) {
    memoryMap.set(jobId, tabId);
    return tabId;
  }

  tabId = await resolveActiveRedditTabId();
  if (tabId !== undefined) {
    memoryMap.set(jobId, tabId);
    await rememberRelayTab(jobId, tabId);
    console.warn(
      `[Reddit Voice Notes] Late-bound ${pipeline} relay tab`,
      { jobId, tabId },
    );
    return tabId;
  }

  console.warn(`[Reddit Voice Notes] No tab registered for ${pipeline} relay`, jobId);
  return undefined;
}

/**
 * Design Studio extension pages listen on runtime.onMessage for offscreen
 * broadcasts. When the Studio tab is torn down mid-transcode, persist the MP4
 * and promote the take so reopen shows draft/ready instead of a phantom live
 * 'processing' state.
 */
async function persistOrphanStudioTranscodeResult(
  message: TranscodeCompleteMessage,
): Promise<void> {
  if (!message.ok || !message.mp4Base64 || !message.mp4ByteLength) return;

  try {
    verifyMp4PackedBinary({
      dataBase64: message.mp4Base64,
      byteLength: message.mp4ByteLength,
    });
    const mp4Bytes = unpackBinary(message.mp4Base64, message.mp4ByteLength);
    const blob = new Blob([Uint8Array.from(mp4Bytes)], { type: 'video/mp4' });

    const take = await getTakeManager().getCurrentTake();
    const durationSeconds = take?.meta.durationSeconds ?? take?.artifacts.baseRecording?.durationSeconds;
    // BUG FIX: H13 false-success artifact publication
    // Fix: stamp from the store's returned persisted meta instead of
    //      manufacturing Date.now() — saveLastBaseMp4 now throws on size
    //      rejection/IDB failure, so a failed write falls to the catch below
    //      and the take is never stamped/promoted for unwritten bytes.
    // Sync: MSG_SAVE_LAST_BASE_MP4 / MSG_SAVE_LAST_RECORDING handlers,
    //       src/storage/last-base-mp4-db.ts (contract).
    const savedMeta = await saveLastBaseMp4(blob, durationSeconds ?? Number.NaN);
    await getTakeManager().recordArtifact('baseMp4', {
      savedAt: savedMeta.savedAt,
      byteLength: savedMeta.byteLength,
      durationSeconds,
    });

    if (take && (take.status === 'processing' || take.status === 'draft')) {
      await getTakeManager().updateCurrentTake({ status: 'ready' });
    }
  } catch (error) {
    console.warn('[Reddit Voice Notes] Orphan studio transcode persist failed', {
      jobId: message.jobId,
      error,
    });
  }
}

function relayTranscodeBroadcast(message: TranscodeProgressMessage | TranscodeCompleteMessage): void {
  const jobId = message.jobId;
  const skipTabRelay = transcodeSkipTabRelayByJobId.get(jobId) === true;

  if (!skipTabRelay) {
    void (async () => {
      const tabId = await resolveRelayTabId(jobId, transcodeTabByJobId, 'transcode');
      if (tabId === undefined) return;

      void browser.tabs.sendMessage(tabId, message).catch((error) => {
        const msg = error instanceof Error ? error.message : String(error);
        // CHANGED: detect dead-tab connection errors and clean up relay mapping
        // WHY: "Receiving end does not exist" means the content script is gone; stale entry would
        //      block resolveRelayTabId fallback from finding a valid tab on future sends
        if (msg.includes('Receiving end does not exist') || msg.includes('Could not establish connection')) {
          transcodeTabByJobId.delete(jobId);
          if (tabId !== undefined) activeTranscodeJobByTabId.delete(tabId);
          void forgetRelayTab(jobId);
          console.warn('[Reddit Voice Notes] Transcode relay target gone — cleaned up', { jobId, tabId });
        } else {
          console.warn('[Reddit Voice Notes] Tab relay failed:', error);
        }
      });
    })();
  }

  if (message.type === MSG_TRANSCODE_COMPLETE) {
    const completeMsg = message;
    void (async () => {
      if (skipTabRelay && completeMsg.ok) {
        await persistOrphanStudioTranscodeResult(completeMsg);
      }

      const tabId = transcodeTabByJobId.get(jobId);
      if (tabId !== undefined && activeTranscodeJobByTabId.get(tabId) === jobId) {
        activeTranscodeJobByTabId.delete(tabId);
      }
      transcodeTabByJobId.delete(jobId);
      transcodeSkipTabRelayByJobId.delete(jobId);
      inflightTranscodeJobIds.delete(jobId);
      await forgetRelayTab(jobId);
      stopRelayKeepAlive();
    })();
  }
}

function isExtensionPageTabUrl(url: string | undefined): boolean {
  return Boolean(url?.startsWith('chrome-extension://') || url?.startsWith('moz-extension://'));
}

function relayBurnInBroadcast(message: BurnInProgressMessage | BurnInCompleteMessage): void {
  const jobId = message.jobId;
  const skipTabRelay = burnInSkipTabRelayByJobId.get(jobId) === true;

  if (!skipTabRelay) {
    void (async () => {
      const tabId = await resolveRelayTabId(jobId, burnInTabByJobId, 'burn-in');
      if (tabId === undefined) return;
      void browser.tabs.sendMessage(tabId, message).catch((error) => {
        const msg = error instanceof Error ? error.message : String(error);
        // CHANGED: detect dead-tab connection errors and clean up relay mapping
        // WHY: mirrors transcode relay cleanup — stale entry would block resolveRelayTabId fallback
        if (msg.includes('Receiving end does not exist') || msg.includes('Could not establish connection')) {
          burnInTabByJobId.delete(jobId);
          if (tabId !== undefined) activeBurnInJobByTabId.delete(tabId);
          void forgetRelayTab(jobId);
          console.warn('[Reddit Voice Notes] Burn-in relay target gone — cleaned up', { jobId, tabId });
        } else {
          console.warn('[Reddit Voice Notes] Burn-in tab relay failed:', error);
        }
      });
    })();
  }

  if (message.type === MSG_BURNIN_COMPLETE) {
    void (async () => {
      const tabId = burnInTabByJobId.get(jobId);
      if (tabId !== undefined && activeBurnInJobByTabId.get(tabId) === jobId) {
        activeBurnInJobByTabId.delete(tabId);
      }
      burnInTabByJobId.delete(jobId);
      burnInSkipTabRelayByJobId.delete(jobId);
      await forgetRelayTab(jobId);
      stopRelayKeepAlive();
    })();
  }
}

async function persistTranscribeCompletion(
  message: TranscribeCompleteMessage,
  context: Omit<TranscribeJobContext, 'watchdog'>,
): Promise<void> {
  // BUG FIX: successful Vosk result vanished when its initiating tab closed (BUG-038)
  // Fix: background is the terminal owner: normalize and commit the result/scaffold,
  //      then publish SESSION_TRANSCRIPT_READY_KEY only after the IDB write resolves.
  // Sync: transcribe-completion.ts; session-transcript-db.ts; voice-recorder.ts.
  const prepared = prepareTranscribeCompletionForPersistence(
    message,
    context.durationSeconds,
    context.language,
  );
  if (!prepared) return;

  await saveSessionTranscript(prepared.result, message.jobId, prepared.meta);
  await browser.storage.local.set({ [SESSION_TRANSCRIPT_READY_KEY]: Date.now() });
}

async function relayTranscribeBroadcast(
  message: TranscribeProgressMessage | TranscribeCompleteMessage,
): Promise<void> {
  const jobId = message.jobId;
  const isComplete = message.type === MSG_TRANSCRIBE_COMPLETE;
  const context = isComplete ? takeTranscribeJobContext(jobId) : null;
  // BUG FIX: a new same-tab job could mutate relay maps while terminal persistence awaited (BUG-038)
  // Fix: snapshot the completed job's delivery route before the first await so a late
  //      completion can never be rebound to the newer job's tab or relay mode.
  // Sync: registerTranscribeTab supersession cleanup below.
  const skipTabRelay = transcribeSkipTabRelayByJobId.get(jobId) === true;
  const registeredTabId = transcribeTabByJobId.get(jobId);

  if (isComplete && !context) {
    console.warn('[Reddit Voice Notes] Ignoring stale transcribe completion', { jobId });
    return;
  }
  if (!isComplete && !transcribeContextByJobId.has(jobId)) return;

  if (isComplete && context) {
    try {
      await persistTranscribeCompletion(message, context);
    } catch (error) {
      console.warn('[Reddit Voice Notes] Terminal transcript persist failed', { jobId, error });
    }
  }

  if (!skipTabRelay) {
    const tabId = registeredTabId ?? await resolveRelayTabId(jobId, transcribeTabByJobId, 'transcribe');
    if (tabId !== undefined) {
      await browser.tabs.sendMessage(tabId, message).catch((error) => {
        const msg = error instanceof Error ? error.message : String(error);
        // CHANGED: detect dead-tab connection errors and clean up relay mapping
        // WHY: mirrors transcode relay cleanup — stale entry would block resolveRelayTabId fallback
        if (msg.includes('Receiving end does not exist') || msg.includes('Could not establish connection')) {
          transcribeTabByJobId.delete(jobId);
          if (tabId !== undefined) activeTranscribeJobByTabId.delete(tabId);
          void forgetRelayTab(jobId);
          console.warn('[Reddit Voice Notes] Transcribe relay target gone — cleaned up', { jobId, tabId });
        } else {
          console.warn('[Reddit Voice Notes] Transcribe tab relay failed:', error);
        }
      });
    }
  }

  if (isComplete) {
    const tabId = transcribeTabByJobId.get(jobId);
    if (tabId !== undefined && activeTranscribeJobByTabId.get(tabId) === jobId) {
      activeTranscribeJobByTabId.delete(tabId);
    }
    transcribeTabByJobId.delete(jobId);
    transcribeSkipTabRelayByJobId.delete(jobId);
    await forgetRelayTab(jobId);
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

async function registerTranscodeTab(
  jobId: string,
  sender: Browser.runtime.MessageSender,
): Promise<void> {
  const senderTabId = sender.tab?.id;
  const skipTabRelay =
    isExtensionPageTabUrl(sender.url) || isExtensionPageTabUrl(sender.tab?.url);
  transcodeSkipTabRelayByJobId.set(jobId, skipTabRelay);

  if (senderTabId !== undefined) {
    const previousJobId = activeTranscodeJobByTabId.get(senderTabId);
    if (previousJobId && previousJobId !== jobId) {
      console.warn('[Reddit Voice Notes] Superseding in-flight transcode', {
        tabId: senderTabId,
        previousJobId,
        jobId,
      });
      transcodeTabByJobId.delete(previousJobId);
      transcodeSkipTabRelayByJobId.delete(previousJobId);
      void forgetRelayTab(previousJobId);
      void cancelOffscreenJob(previousJobId);
    }
    activeTranscodeJobByTabId.set(senderTabId, jobId);
    transcodeTabByJobId.set(jobId, senderTabId);
    inflightTranscodeJobIds.add(jobId);
    if (!skipTabRelay) await rememberRelayTab(jobId, senderTabId);
    return;
  }

  const tabId = await resolveActiveRedditTabId();
  if (tabId !== undefined) {
    transcodeTabByJobId.set(jobId, tabId);
    inflightTranscodeJobIds.add(jobId);
    await rememberRelayTab(jobId, tabId);
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

async function registerBurnInTab(
  jobId: string,
  sender: Browser.runtime.MessageSender,
): Promise<void> {
  const senderTabId = sender.tab?.id;
  const skipTabRelay =
    isExtensionPageTabUrl(sender.url) || isExtensionPageTabUrl(sender.tab?.url);
  burnInSkipTabRelayByJobId.set(jobId, skipTabRelay);

  if (senderTabId !== undefined) {
    const previousJobId = activeBurnInJobByTabId.get(senderTabId);
    if (previousJobId && previousJobId !== jobId) {
      console.warn('[Reddit Voice Notes] Superseding in-flight burn-in', {
        tabId: senderTabId,
        previousJobId,
        jobId,
      });
      burnInTabByJobId.delete(previousJobId);
      burnInSkipTabRelayByJobId.delete(previousJobId);
      void forgetRelayTab(previousJobId);
      void cancelOffscreenJob(previousJobId);
    }
    activeBurnInJobByTabId.set(senderTabId, jobId);
    burnInTabByJobId.set(jobId, senderTabId);
    if (!skipTabRelay) await rememberRelayTab(jobId, senderTabId);
    return;
  }

  const tabId = await resolveActiveRedditTabId();
  if (tabId !== undefined) {
    burnInTabByJobId.set(jobId, tabId);
    if (!skipTabRelay) await rememberRelayTab(jobId, tabId);
    return;
  }

  console.warn('[Reddit Voice Notes] Could not resolve Reddit tab for burn-in relay', jobId);
}

async function registerTranscribeTab(
  jobId: string,
  sender: Browser.runtime.MessageSender,
): Promise<void> {
  const senderTabId = sender.tab?.id;
  const skipTabRelay =
    isExtensionPageTabUrl(sender.url) || isExtensionPageTabUrl(sender.tab?.url);
  transcribeSkipTabRelayByJobId.set(jobId, skipTabRelay);

  if (senderTabId !== undefined) {
    const previousJobId = activeTranscribeJobByTabId.get(senderTabId);
    if (previousJobId && previousJobId !== jobId) {
      console.warn('[Reddit Voice Notes] Superseding in-flight transcribe', {
        tabId: senderTabId,
        previousJobId,
        jobId,
      });
      transcribeTabByJobId.delete(previousJobId);
      transcribeSkipTabRelayByJobId.delete(previousJobId);
      // BUG FIX: a superseded transcribe could later overwrite the newer take (BUG-038)
      // Fix: retire its background terminal context before cancelling; late COMPLETE
      //      is then ignored and the keep-alive reference is released exactly once.
      // Sync: relayTranscribeBroadcast context guard.
      const previousWasActive = transcribeContextByJobId.has(previousJobId);
      clearTranscribeJobContext(previousJobId);
      if (previousWasActive) stopRelayKeepAlive();
      void forgetRelayTab(previousJobId);
      if (previousWasActive) void cancelOffscreenTranscribeJob(previousJobId);
    }
    activeTranscribeJobByTabId.set(senderTabId, jobId);
    transcribeTabByJobId.set(jobId, senderTabId);
    if (!skipTabRelay) await rememberRelayTab(jobId, senderTabId);
    return;
  }

  const tabId = await resolveActiveRedditTabId();
  if (tabId !== undefined) {
    transcribeTabByJobId.set(jobId, tabId);
    await rememberRelayTab(jobId, tabId);
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

async function closeOffscreenDocumentIfPresent(): Promise<void> {
  const offscreen = getChromeOffscreen();
  if (!offscreen?.closeDocument || !(await hasOffscreenDocument())) return;
  try {
    await offscreen.closeDocument();
  } catch {
    // Offscreen may already be closing.
  }
}

async function pingOffscreenWorker(): Promise<OffscreenPongResponse | null> {
  const ping: OffscreenPingRequest = { type: MSG_OFFSCREEN_PING, target: 'offscreen' };
  try {
    const response = (await browser.runtime.sendMessage(ping)) as OffscreenPongResponse | undefined;
    return response?.ready ? response : null;
  } catch {
    return null;
  }
}

function expectedOffscreenCodeStamp(): string {
  return `${OFFSCREEN_WORKER_STAMP}|${BURNIN_PIPELINE_STAMP}`;
}

function offscreenStampMatches(response: OffscreenPongResponse | null): boolean {
  return response?.codeStamp === expectedOffscreenCodeStamp();
}

// BUG FIX: stale offscreen bundle after extension reload (BUG-030 loop)
// Fix: surviving offscreen docs lack current codeStamp — close and recreate before dispatch.
// BUG FIX: BUG-034 cold-start offscreen dispatch race
// Fix: a doc that is merely mid-load answers the ping with `null` (no receiver yet).
//      The old code recycled on any non-matching pong, so a concurrent dispatch would
//      CLOSE a freshly-created doc the first dispatch was still loading — silently killing
//      its job (the cold-start "inference-error"). Only recycle when the worker IS alive
//      but stale (a non-null pong with a mismatched stamp). A null pong means "still
//      loading" — leave it for waitForOffscreenReady to poll. Stale bundles are still
//      recycled there (it recycles on a ready pong with a mismatched stamp).
// Sync: waitForOffscreenReady() retains the ready-but-stale recycle path; dispatch mutex
//       in dispatchToOffscreen() serializes concurrent setup.
async function ensureFreshOffscreenWorker(): Promise<void> {
  if (!(await hasOffscreenDocument())) return;
  const pong = await pingOffscreenWorker();
  if (pong === null) return;
  if (offscreenStampMatches(pong)) return;
  await recycleOffscreenDocument();
}

async function recycleOffscreenDocument(): Promise<void> {
  await closeOffscreenDocumentIfPresent();
  creatingOffscreen = null;
}

function offscreenDocumentUrl(): string {
  const base = browser.runtime.getURL(OFFSCREEN_PATH as never);
  return `${base}?rvn=${encodeURIComponent(expectedOffscreenCodeStamp())}`;
}

async function ensureOffscreenDocument(): Promise<void> {
  await ensureFreshOffscreenWorker();
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
      url: offscreenDocumentUrl(),
      reasons: [workersReason],
      justification: 'FFmpeg WASM transcoding for voice note MP4 export',
    })
    .finally(() => {
      creatingOffscreen = null;
    });

  await creatingOffscreen;
}

async function waitForOffscreenReady(): Promise<void> {
  for (let attempt = 0; attempt < OFFSCREEN_READY_RETRIES; attempt += 1) {
    const response = await pingOffscreenWorker();
    if (offscreenStampMatches(response)) return;
    if (response?.ready && !offscreenStampMatches(response)) {
      await recycleOffscreenDocument();
      await ensureOffscreenDocument();
    }
    await new Promise((resolve) => setTimeout(resolve, OFFSCREEN_READY_DELAY_MS));
  }

  throw new Error('FFmpeg offscreen worker failed to start.');
}

// BUG FIX: BUG-034 cold-start offscreen dispatch race
// Fix: the first recording dispatches transcribe + transcode CONCURRENTLY; on a cold
//      offscreen they interleaved through ensure/recycle and one job's doc was closed by
//      the other's freshness check. Serialize all offscreen dispatches so each completes
//      its ensure → wait-ready → send (fast; returns on ACK, not job completion) before
//      the next begins. Jobs still run concurrently inside the offscreen (own queues).
// Sync: ensureFreshOffscreenWorker() null-ping guard handles the same race defensively.
let offscreenDispatchChain: Promise<unknown> = Promise.resolve();

async function dispatchToOffscreen(
  request: TranscodeOffscreenRequest | TranscribeOffscreenRequest | BurnInOffscreenRequest,
): Promise<void> {
  // Chain onto the previous dispatch regardless of whether it resolved or rejected,
  // so one failed dispatch never wedges the queue. The caller still sees this dispatch's
  // own outcome via `run`.
  const run = offscreenDispatchChain.then(
    () => dispatchToOffscreenLocked(request),
    () => dispatchToOffscreenLocked(request),
  );
  offscreenDispatchChain = run.catch(() => {});
  return run;
}

async function dispatchToOffscreenLocked(
  request: TranscodeOffscreenRequest | TranscribeOffscreenRequest | BurnInOffscreenRequest,
): Promise<void> {
  // BUG FIX: partial WXT HMR leaves stale subtitle-burnin chunk (BUG-030 loop)
  // Fix: full offscreen recycle before burn-in so all JS chunks reload together.
  // BUG FIX: BUG-033 split-view transcription kill
  // Fix: unconditional recycle kills any in-flight Vosk job silently; skip when a
  //      transcription relay is registered — ensureFreshOffscreenWorker() handles
  //      stale-stamp recycling, so BUG-030 protection is not lost.
  // Sync: offscreen/main.ts burn-in job awaits whenTranscribeQueueIdle() for same race.
  if (request.type === MSG_BURNIN_OFFSCREEN && transcribeTabByJobId.size === 0) {
    await recycleOffscreenDocument();
  }

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
  void relayTranscribeBroadcast(completeMsg);
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

// v5.4.0 Phase 3: relay serves 'baked' AND 'base' MP4 stores (per-store cache)
// so the Reddit panel can attach never-baked Studio takes.
interface Mp4RelayCacheEntry {
  bytes: Uint8Array | null;
  mime: string;
  savedAt: number;
}

const mp4RelayCache: Record<TakeMp4Store, Mp4RelayCacheEntry> = {
  baked: { bytes: null, mime: 'video/mp4', savedAt: 0 },
  base: { bytes: null, mime: 'video/mp4', savedAt: 0 },
};

async function loadTakeMp4Bytes(store: TakeMp4Store): Promise<Uint8Array | null> {
  const snapshot = store === 'base' ? await loadLastBaseMp4() : await loadLastBakedMp4();
  if (!snapshot?.blob) return null;
  const cache = mp4RelayCache[store];
  if (cache.savedAt === snapshot.meta.savedAt && cache.bytes) {
    return cache.bytes;
  }
  cache.bytes = new Uint8Array(await snapshot.blob.arrayBuffer());
  cache.mime = snapshot.meta.mimeType || 'video/mp4';
  cache.savedAt = snapshot.meta.savedAt;
  return cache.bytes;
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

// BUG FIX: tsc TS2833 "Cannot find namespace 'browser'" (TS 5.7 + WXT types)
// Fix: `browser` is a value global, not a type namespace; use WXT's `Browser` namespace for the Port type.
async function relayBackgroundBlobViaPort(port: Browser.runtime.Port, id: string): Promise<void> {
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
  // BUG FIX: stale offscreen WASM survives MV3 service worker reload (BUG-030 loop)
  // Fix: close any surviving offscreen document when the service worker boots.
  void closeOffscreenDocumentIfPresent();
  // CHANGED: purge session-storage relay entries on every SW boot
  // WHY: closeOffscreenDocumentIfPresent above kills any in-flight offscreen job, so all relay
  //      entries from the previous SW lifetime are stale — clearing prevents misrouted broadcasts
  //      to wrong tabs on the next job's resolveRelayTabId fallback path
  void clearAllRelayTabs();

  console.log('[Reddit Voice Notes] Background service worker started', {
    id: browser.runtime.id,
    offscreenApi: Boolean(getChromeOffscreen()?.createDocument),
    offscreenStamp: expectedOffscreenCodeStamp(),
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

      if (type === MSG_QUERY_TRANSCODE_INFLIGHT) {
        const response: QueryTranscodeInflightResponse = {
          ok: true,
          inflight: inflightTranscodeJobIds.size > 0,
        };
        sendResponse(response);
        return false;
      }

      if (type === MSG_OFFSCREEN_PREWARM) {
        // BUG FIX: BUG-034 cold-start offscreen dispatch race
        // Fix: eagerly create the offscreen doc at record START so it is loaded +
        //      stamp-matching by stop time. Best-effort, fire-and-forget (no response).
        //      Routed through the SAME dispatch chain so the warm-up create serializes
        //      with the later transcribe/transcode dispatches (no double-create race).
        offscreenDispatchChain = offscreenDispatchChain
          .then(() => ensureOffscreenDocument())
          .catch((error) => {
            console.warn('[Reddit Voice Notes] Offscreen prewarm failed (non-blocking):', error);
          });
        return false;
      }

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
            // CHANGED: thread graceful-failure metadata into the snapshot (v5.3 Phase 2).
            // WHY: a failed/empty Vosk run now relays a scaffold result + error reason
            //      so Design Studio unsticks from "pending" and opens a usable template.
            let failureReason: TranscriptFailureReason | undefined;
            if (request.errorJson) {
              try {
                failureReason = JSON.parse(request.errorJson) as TranscriptFailureReason;
              } catch {
                failureReason = undefined;
              }
            }
            await saveSessionTranscript(parsed, request.jobId, {
              error: failureReason,
              isScaffolded: request.isScaffolded === true,
            });
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
            const request = message as GetBakedMp4MetaRequest;
            const store: TakeMp4Store = request.store === 'base' ? 'base' : 'baked';
            const bytes = await loadTakeMp4Bytes(store);
            if (!bytes) {
              response.error = `No ${store} MP4 available.`;
              sendResponse(response);
              return;
            }
            const cache = mp4RelayCache[store];
            sendResponse(bakedMp4Meta(bytes, cache.mime, cache.savedAt));
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
            const store: TakeMp4Store = request.store === 'base' ? 'base' : 'baked';
            const bytes = await loadTakeMp4Bytes(store);
            if (!bytes) {
              response.error = `No ${store} MP4 available.`;
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
            // BUG FIX: H13 false-success artifact publication
            // Fix: saveLastBaseMp4 now throws on size rejection/IDB failure
            //      (it used to no-op silently) — a failed write reaches the
            //      catch below, so ok:false is honest and no stamp lands.
            //      The stamp uses the store's returned persisted meta, not a
            //      manufactured Date.now().
            // Sync: persistOrphanStudioTranscodeResult, MSG_SAVE_LAST_RECORDING,
            //       src/storage/last-base-mp4-db.ts (contract).
            const savedMeta = await saveLastBaseMp4(blob, request.durationSeconds);
            // v5.4.0: stamp the artifact into the current take AFTER the IDB
            // write succeeds — the snapshot must never claim blobs it lacks.
            void getTakeManager().recordArtifact('baseMp4', {
              savedAt: savedMeta.savedAt,
              byteLength: savedMeta.byteLength,
              durationSeconds: savedMeta.durationSeconds,
            });
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
            // BUG FIX: H13 false-success artifact publication
            // Fix: saveLastRecording now throws on size rejection/IDB failure
            //      (it used to no-op silently) — a failed write reaches the
            //      catch below, so LAST_RECORDING_READY never fires and no
            //      stamp lands for unwritten bytes. Stamp uses the store's
            //      returned persisted meta, not a manufactured Date.now().
            // Sync: MSG_SAVE_LAST_BASE_MP4 handler above,
            //       src/storage/last-recording-db.ts (contract).
            const savedMeta = await saveLastRecording(blob, request.durationSeconds);
            // CHANGED: signal Design Studio to reload voice preview without tab visibility flip.
            // WHY: recording completes on Reddit while studio may stay open (eloquent-2 UX).
            await browser.storage.local.set({ [LAST_RECORDING_READY_KEY]: Date.now() });
            // v5.4.0: stamp the artifact into the current take AFTER the IDB
            // write succeeds — the snapshot must never claim blobs it lacks.
            void getTakeManager().recordArtifact('baseRecording', {
              savedAt: savedMeta.savedAt,
              byteLength: savedMeta.byteLength,
              durationSeconds: savedMeta.durationSeconds,
            });
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
        if (sender.url?.includes('offscreen.html')) {
          relayTranscodeBroadcast(
            message as TranscodeProgressMessage | TranscodeCompleteMessage,
          );
        }
        return;
      }
      if (type === MSG_TRANSCRIBE_PROGRESS) {
        // Content scripts cannot rely on offscreen runtime broadcasts — relay from offscreen only.
        if (sender.url?.includes('offscreen.html')) {
          void relayTranscribeBroadcast(message as TranscribeProgressMessage);
        }
        return;
      }
      if (type === MSG_TRANSCRIBE_COMPLETE) {
        if (!sender.url?.includes('offscreen.html')) return;

        // BUG FIX: tab-close transcript persistence could outlive the message event (BUG-038)
        // Fix: hold the MV3 message channel open until terminal IDB persistence, ready
        //      publication, relay, and cleanup finish in the background service worker.
        // Sync: relayTranscribeBroadcast; offscreen/main.ts broadcastTranscribe.
        void relayTranscribeBroadcast(message as TranscribeCompleteMessage)
          .then(() => sendResponse({ ok: true }))
          .catch((error) => sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }));
        return true;
      }
      if (type === MSG_BURNIN_PROGRESS || type === MSG_BURNIN_COMPLETE) {
        // Offscreen broadcasts reach Design Studio via runtime; tab relay is Reddit-only.
        if (sender.url?.includes('offscreen.html')) {
          relayBurnInBroadcast(message as BurnInProgressMessage | BurnInCompleteMessage);
        }
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
          await registerTranscribeTab(transcribeRequest.jobId, sender);
          startRelayKeepAlive();
          // BUG FIX: tab-close transcript completion was owned by a disposable page (BUG-038)
          // Fix: start the background-owned terminal context before ACK so every accepted
          //      job has a surviving duration, dedupe guard, and completion watchdog.
          // Sync: TranscribeStartRequest.durationSeconds; relayTranscribeBroadcast.
          startTranscribeJobContext(transcribeRequest);

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
            // BUG FIX: transcribe relay dropped on dispatch failure (BUG-032)
            // Fix: do not delete tab map before relayTranscribeFailure — relay needs jobId→tabId.
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
          await registerBurnInTab(burnInRequest.jobId, sender);
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
        await registerTranscodeTab(request.jobId, sender);
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
          relayTranscodeFailure(request.jobId, error);
        }
      }
    })();

    return true;
  });
});
