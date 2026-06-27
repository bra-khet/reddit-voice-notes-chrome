import { packBinary } from '@/src/messaging/binary';
import { verifyWebmPackedBinary } from '@/src/messaging/binary-verify';
import {
  MSG_OFFSCREEN_PREWARM,
  MSG_TRANSCRIBE_ACK,
  MSG_TRANSCRIBE_CANCEL,
  MSG_TRANSCRIBE_COMPLETE,
  MSG_TRANSCRIBE_PROGRESS,
  MSG_TRANSCRIBE_START,
  type OffscreenPrewarmRequest,
  type TranscribeAckResponse,
  type TranscribeCancelRequest,
  type TranscribeCompleteMessage,
  type TranscribeProgressMessage,
  type TranscribeStartRequest,
} from '@/src/messaging/types';
import { EXTENSION_LOG_PREFIX } from '@/src/utils/constants';
import { TRANSCRIBE_TIMEOUT_MS } from './constants';
import type { TranscriptResult } from './types';

const ACK_TIMEOUT_MS = 45_000;

function isExtensionContextValid(): boolean {
  try {
    return Boolean(browser.runtime?.id);
  } catch {
    return false;
  }
}

// BUG FIX: BUG-034 cold-start offscreen dispatch race
// Fix: warm the offscreen document at record START (best-effort, fire-and-forget) so it
//      is loaded + stamp-matching by the time stopRecording dispatches transcribe AND
//      transcode together. A warm doc makes background ensureFreshOffscreenWorker() return
//      early instead of recycling a still-loading doc out from under the transcribe job.
// Sync: handled by MSG_OFFSCREEN_PREWARM in entrypoints/background.ts.
export function prewarmOffscreen(): void {
  if (!isExtensionContextValid()) return;
  const request: OffscreenPrewarmRequest = { type: MSG_OFFSCREEN_PREWARM };
  void browser.runtime.sendMessage(request).catch(() => {
    // Best-effort — the real dispatch still creates the doc on demand if this misses.
  });
}

function requestOffscreenCancel(jobId: string): void {
  const cancel: TranscribeCancelRequest = {
    type: MSG_TRANSCRIBE_CANCEL,
    jobId,
  };
  void browser.runtime.sendMessage(cancel).catch(() => {
    // Offscreen may already be gone.
  });
}

export interface TranscribeClientResult {
  jobId: string;
  result: TranscriptResult;
  applied: boolean;
  fallback: boolean;
  stage: string;
  elapsedMs: number;
}

export interface ForkTranscribeOptions {
  language?: string;
  signal?: AbortSignal;
  onProgress?: (ratio: number, stage: string) => void;
}

function parseTranscriptResult(json: string | undefined): TranscriptResult {
  if (!json) {
    return { text: '', segments: [], source: 'vosk' };
  }
  const parsed = JSON.parse(json) as TranscriptResult;
  return {
    text: typeof parsed.text === 'string' ? parsed.text : '',
    segments: Array.isArray(parsed.segments) ? parsed.segments : [],
    language: parsed.language,
    source: parsed.source === 'manual' ? 'manual' : 'vosk',
  };
}

/**
 * Non-blocking transcription fork (eloquent-1).
 * Dispatches MSG_TRANSCRIBE_* in parallel with transcode; failures resolve with fallback result.
 */
export async function forkTranscribeWebm(
  webm: Blob,
  options?: ForkTranscribeOptions,
): Promise<TranscribeClientResult | null> {
  if (options?.signal?.aborted) {
    return null;
  }

  if (!isExtensionContextValid()) {
    console.warn(`${EXTENSION_LOG_PREFIX} Transcribe skipped — extension context invalid.`);
    return null;
  }

  const jobId = crypto.randomUUID();
  const startedAt = performance.now();
  const webmBytes = new Uint8Array(await webm.arrayBuffer());

  if (webmBytes.byteLength === 0) {
    console.warn(`${EXTENSION_LOG_PREFIX} Transcribe skipped — empty WebM clone.`);
    return null;
  }

  const webmPacked = packBinary(webmBytes);
  verifyWebmPackedBinary(webmPacked);

  console.log(`${EXTENSION_LOG_PREFIX} Sending WebM for transcribe`, {
    jobId,
    bytes: webmPacked.byteLength,
    base64Chars: webmPacked.dataBase64.length,
  });

  return new Promise<TranscribeClientResult | null>((resolve) => {
    let ackTimer: number | null = null;
    let absoluteTimer: number | null = null;
    let gotAck = false;

    const finish = (value: TranscribeClientResult | null) => {
      cleanup();
      resolve(value);
    };

    const cleanup = () => {
      options?.signal?.removeEventListener('abort', onAbort);
      if (ackTimer !== null) window.clearTimeout(ackTimer);
      if (absoluteTimer !== null) window.clearTimeout(absoluteTimer);
      ackTimer = null;
      absoluteTimer = null;
      browser.runtime.onMessage.removeListener(onBroadcast);
    };

    const onAbort = () => {
      requestOffscreenCancel(jobId);
      finish(null);
    };

    options?.signal?.addEventListener('abort', onAbort);

    absoluteTimer = window.setTimeout(() => {
      requestOffscreenCancel(jobId);
      finish({
        jobId,
        result: { text: '', segments: [], source: 'vosk', language: options?.language },
        applied: false,
        fallback: true,
        stage: `timeout-${Math.round(TRANSCRIBE_TIMEOUT_MS / 1000)}s`,
        elapsedMs: Math.round(performance.now() - startedAt),
      });
    }, TRANSCRIBE_TIMEOUT_MS);

    ackTimer = window.setTimeout(() => {
      if (!gotAck) {
        requestOffscreenCancel(jobId);
        finish({
          jobId,
          result: { text: '', segments: [], source: 'vosk', language: options?.language },
          applied: false,
          fallback: true,
          stage: 'ack-timeout',
          elapsedMs: Math.round(performance.now() - startedAt),
        });
      }
    }, ACK_TIMEOUT_MS);

    const onBroadcast = (message: unknown) => {
      if (!message || typeof message !== 'object' || !('type' in message) || !('jobId' in message)) {
        return;
      }
      if ((message as { jobId: string }).jobId !== jobId) return;

      if ((message as { type: string }).type === MSG_TRANSCRIBE_PROGRESS) {
        const progressMsg = message as TranscribeProgressMessage;
        options?.onProgress?.(progressMsg.progress / 100, progressMsg.stage ?? '');
        return;
      }

      if ((message as { type: string }).type === MSG_TRANSCRIBE_COMPLETE) {
        const completeMsg = message as TranscribeCompleteMessage;
        const result = parseTranscriptResult(completeMsg.transcriptJson);
        finish({
          jobId,
          result,
          applied: completeMsg.ok === true,
          fallback: !completeMsg.ok,
          stage: completeMsg.error ?? 'complete',
          elapsedMs: Math.round(performance.now() - startedAt),
        });
      }
    };

    browser.runtime.onMessage.addListener(onBroadcast);

    const request: TranscribeStartRequest = {
      type: MSG_TRANSCRIBE_START,
      jobId,
      webmBase64: webmPacked.dataBase64,
      webmByteLength: webmPacked.byteLength,
      language: options?.language,
    };

    if (options?.signal?.aborted) {
      onAbort();
      return;
    }

    browser.runtime
      .sendMessage(request)
      .then((ack) => {
        if (options?.signal?.aborted) {
          onAbort();
          return;
        }
        const response = ack as TranscribeAckResponse | undefined;
        if (!response?.ok) {
          finish({
            jobId,
            result: { text: '', segments: [], source: 'vosk', language: options?.language },
            applied: false,
            fallback: true,
            stage: response?.error ?? 'transcribe-start-failed',
            elapsedMs: Math.round(performance.now() - startedAt),
          });
          return;
        }
        if (response.jobId !== jobId) {
          finish({
            jobId,
            result: { text: '', segments: [], source: 'vosk', language: options?.language },
            applied: false,
            fallback: true,
            stage: 'transcribe-ack-mismatch',
            elapsedMs: Math.round(performance.now() - startedAt),
          });
          return;
        }
        gotAck = true;
        if (ackTimer !== null) window.clearTimeout(ackTimer);
        ackTimer = null;
        options?.onProgress?.(0.01, 'queued');
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        finish({
          jobId,
          result: { text: '', segments: [], source: 'vosk', language: options?.language },
          applied: false,
          fallback: true,
          stage: message,
          elapsedMs: Math.round(performance.now() - startedAt),
        });
      });
  });
}