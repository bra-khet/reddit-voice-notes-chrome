import { withTranscodeLock } from '@/src/ffmpeg/transcode-lock';
import { packBinary, unpackBinary } from '@/src/messaging/binary';
import { verifyMp4PackedBinary, verifyWebmPackedBinary } from '@/src/messaging/binary-verify';
import {
  MSG_TRANSCODE_ACK,
  MSG_TRANSCODE_CANCEL,
  MSG_TRANSCODE_COMPLETE,
  MSG_TRANSCODE_PROGRESS,
  MSG_TRANSCODE_START,
  type TranscodeAckResponse,
  type TranscodeCancelRequest,
  type TranscodeCompleteMessage,
  type TranscodeProgressMessage,
  type TranscodeStartRequest,
} from '@/src/messaging/types';
import { EXTENSION_LOG_PREFIX } from '@/src/utils/constants';
import { normalizeVoiceEffectConfig, type VoiceEffectConfig } from '@/src/voice/types';

/** Fail when meaningful FFmpeg progress stalls — heartbeats do not count. */
// CHANGED: 45s → 60s after BUG-007 dup-storm fix — larger WebM clips can transcode reliably (~45s observed).
// WHY: Hardened pipeline + timestamp repair accommodates bigger files; stall ceiling was too tight.
const STALL_TIMEOUT_MS = 60_000;
/** Background must ack (job accepted for relay) within this window. */
const ACK_TIMEOUT_MS = 45_000;
/** Hard ceiling for a single transcode job (includes WASM cold start + queue wait). */
const ABSOLUTE_MAX_MS = 90_000;

function isHeartbeatStage(stage: string | undefined): boolean {
  return Boolean(stage?.endsWith('-heartbeat'));
}

function isMeaningfulProgress(
  msg: TranscodeProgressMessage,
  lastRatio: number,
  lastStage: string,
): boolean {
  if (isHeartbeatStage(msg.stage)) return false;
  const ratio = msg.progress / 100;
  if (ratio > lastRatio + 0.005) return true;
  if (msg.stage && msg.stage !== lastStage && !isHeartbeatStage(msg.stage)) return true;
  return false;
}

function requestOffscreenCancel(jobId: string): void {
  const cancel: TranscodeCancelRequest = {
    type: MSG_TRANSCODE_CANCEL,
    jobId,
  };
  void browser.runtime.sendMessage(cancel).catch(() => {
    // Offscreen may already be gone.
  });
}

function isExtensionContextValid(): boolean {
  try {
    return Boolean(browser.runtime?.id);
  } catch {
    return false;
  }
}

export interface TranscodeResult {
  mp4: Blob;
  voiceEffectFallback?: boolean;
}

export async function transcodeWebmToMp4(
  webm: Blob,
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
  voiceEffect?: VoiceEffectConfig,
): Promise<TranscodeResult> {
  if (signal?.aborted) {
    throw new DOMException('Transcode cancelled.', 'AbortError');
  }

  return withTranscodeLock(async () => {
    if (signal?.aborted) {
      throw new DOMException('Transcode cancelled.', 'AbortError');
    }
    return transcodeWebmToMp4Inner(webm, onProgress, signal, voiceEffect);
  });
}

async function transcodeWebmToMp4Inner(
  webm: Blob,
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
  voiceEffect?: VoiceEffectConfig,
): Promise<TranscodeResult> {
  if (!isExtensionContextValid()) {
    throw new Error(
      'Extension context invalidated. Reload the extension, then refresh this Reddit tab.',
    );
  }

  const jobId = crypto.randomUUID();
  const webmBytes = new Uint8Array(await webm.arrayBuffer());

  if (webmBytes.byteLength === 0) {
    throw new Error('Recorded WebM is empty before transcoding. Try recording again.');
  }

  const webmPacked = packBinary(webmBytes);
  verifyWebmPackedBinary(webmPacked);

  console.log(`${EXTENSION_LOG_PREFIX} Sending WebM for transcode`, {
    jobId,
    bytes: webmPacked.byteLength,
    base64Chars: webmPacked.dataBase64.length,
  });

  return new Promise<TranscodeResult>((resolve, reject) => {
    let stallTimer: number | null = null;
    let absoluteTimer: number | null = null;
    let ackTimer: number | null = null;
    let gotAck = false;
    let lastMeaningfulProgressAt = Date.now();
    let lastMeaningfulRatio = 0;
    let lastMeaningfulStage = '';
    let lastReportedRatio = 0;

    const reportProgress = (ratio: number) => {
      const clamped = Math.min(1, Math.max(lastReportedRatio, ratio));
      lastReportedRatio = clamped;
      onProgress?.(clamped);
    };

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
      if (stallTimer !== null) window.clearTimeout(stallTimer);
      if (absoluteTimer !== null) window.clearTimeout(absoluteTimer);
      if (ackTimer !== null) window.clearTimeout(ackTimer);
      stallTimer = null;
      absoluteTimer = null;
      ackTimer = null;
      browser.runtime.onMessage.removeListener(onBroadcast);
    };

    const fail = (message: string, asAbort = false) => {
      requestOffscreenCancel(jobId);
      cleanup();
      if (asAbort) {
        reject(new DOMException(message, 'AbortError'));
        return;
      }
      reject(new Error(message));
    };

    const onAbort = () => {
      fail('Transcode cancelled.', true);
    };

    signal?.addEventListener('abort', onAbort);

    const resetStallTimer = () => {
      lastMeaningfulProgressAt = Date.now();
      if (stallTimer !== null) window.clearTimeout(stallTimer);
      stallTimer = window.setTimeout(() => {
        const stalledFor = Math.round((Date.now() - lastMeaningfulProgressAt) / 1000);
        requestOffscreenCancel(jobId);
        fail(
          `Transcode stalled (no real progress for ${stalledFor}s). Reload the extension if this keeps happening.`,
        );
      }, STALL_TIMEOUT_MS);
    };

    absoluteTimer = window.setTimeout(() => {
      requestOffscreenCancel(jobId);
      fail(
        `FFmpeg transcoding exceeded the ${Math.round(ABSOLUTE_MAX_MS / 1000)}s safety limit. Reload the extension and try again.`,
      );
    }, ABSOLUTE_MAX_MS);

    ackTimer = window.setTimeout(() => {
      if (!gotAck) {
        fail('Transcode did not start (background relay timeout). Reload the extension and try again.');
      }
    }, ACK_TIMEOUT_MS);

    const onBroadcast = (message: unknown) => {
      if (!message || typeof message !== 'object' || !('type' in message) || !('jobId' in message)) {
        return;
      }
      if ((message as { jobId: string }).jobId !== jobId) return;

      if ((message as { type: string }).type === MSG_TRANSCODE_PROGRESS) {
        const progressMsg = message as TranscodeProgressMessage;
        if (isMeaningfulProgress(progressMsg, lastMeaningfulRatio, lastMeaningfulStage)) {
          lastMeaningfulRatio = Math.max(lastMeaningfulRatio, progressMsg.progress / 100);
          lastMeaningfulStage = progressMsg.stage ?? lastMeaningfulStage;
          resetStallTimer();
        }
        reportProgress(progressMsg.progress / 100);
        return;
      }

      if ((message as { type: string }).type === MSG_TRANSCODE_COMPLETE) {
        const completeMsg = message as TranscodeCompleteMessage;
        cleanup();

        if (!completeMsg.ok) {
          reject(new Error(completeMsg.error ?? 'FFmpeg transcoding failed.'));
          return;
        }

        if (!completeMsg.mp4Base64 || !completeMsg.mp4ByteLength) {
          reject(new Error('MP4 result missing from offscreen worker.'));
          return;
        }

        try {
          verifyMp4PackedBinary({
            dataBase64: completeMsg.mp4Base64,
            byteLength: completeMsg.mp4ByteLength,
          });
          reportProgress(1);
          const mp4Bytes = unpackBinary(completeMsg.mp4Base64, completeMsg.mp4ByteLength);
          resolve({
            mp4: new Blob([Uint8Array.from(mp4Bytes)], { type: 'video/mp4' }),
            voiceEffectFallback: completeMsg.voiceEffectFallback,
          });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          reject(new Error(`MP4 result could not be decoded: ${detail}`));
        }
      }
    };

    browser.runtime.onMessage.addListener(onBroadcast);

    const request: TranscodeStartRequest = {
      type: MSG_TRANSCODE_START,
      jobId,
      webmBase64: webmPacked.dataBase64,
      webmByteLength: webmPacked.byteLength,
      voiceEffect: voiceEffect ? normalizeVoiceEffectConfig(voiceEffect) : undefined,
    };

    if (signal?.aborted) {
      fail('Transcode cancelled.', true);
      return;
    }

    browser.runtime
      .sendMessage(request)
      .then((ack) => {
        if (signal?.aborted) {
          fail('Transcode cancelled.', true);
          return;
        }
        const response = ack as TranscodeAckResponse | undefined;
        if (!response?.ok) {
          fail(response?.error ?? 'Failed to start FFmpeg transcoding.');
          return;
        }
        if (response.jobId !== jobId) {
          fail('Transcode ack jobId mismatch from background relay.');
          return;
        }
        gotAck = true;
        if (ackTimer !== null) window.clearTimeout(ackTimer);
        ackTimer = null;
        resetStallTimer();
        reportProgress(0.01);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('Extension context invalidated')) {
          fail('Extension context invalidated. Reload the extension, then refresh this Reddit tab.');
          return;
        }
        fail(message);
      });
  });
}