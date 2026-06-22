import { withTranscodeLock } from '@/src/ffmpeg/transcode-lock';
import { packBinary, unpackBinary } from '@/src/messaging/binary';
import { verifyMp4PackedBinary } from '@/src/messaging/binary-verify';
import {
  MSG_BURNIN_ACK,
  MSG_BURNIN_CANCEL,
  MSG_BURNIN_COMPLETE,
  MSG_BURNIN_PROGRESS,
  MSG_BURNIN_START,
  type BurnInAckResponse,
  type BurnInCancelRequest,
  type BurnInCompleteMessage,
  type BurnInProgressMessage,
  type BurnInStartRequest,
} from '@/src/messaging/types';
import { EXTENSION_LOG_PREFIX } from '@/src/utils/constants';
import type { SubtitleStyleConfig, TranscriptSegment } from '@/src/transcription/types';
import { normalizeSubtitleStyle } from '@/src/transcription/types';

const STALL_TIMEOUT_MS = 60_000;
const ACK_TIMEOUT_MS = 45_000;
const ABSOLUTE_MAX_MS = 90_000;

function isHeartbeatStage(stage: string | undefined): boolean {
  return Boolean(stage?.endsWith('-heartbeat'));
}

function isMeaningfulProgress(
  msg: BurnInProgressMessage,
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
  const cancel: BurnInCancelRequest = {
    type: MSG_BURNIN_CANCEL,
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

export interface BurnInClientOptions {
  segments: TranscriptSegment[];
  style: SubtitleStyleConfig;
  signal?: AbortSignal;
  onProgress?: (ratio: number) => void;
}

export async function burnInSubtitlesToMp4(
  baseMp4: Blob,
  options: BurnInClientOptions,
): Promise<Blob> {
  if (options.signal?.aborted) {
    throw new DOMException('Subtitle burn-in cancelled.', 'AbortError');
  }

  return withTranscodeLock(async () => {
    if (options.signal?.aborted) {
      throw new DOMException('Subtitle burn-in cancelled.', 'AbortError');
    }
    return burnInSubtitlesToMp4Inner(baseMp4, options);
  });
}

async function burnInSubtitlesToMp4Inner(
  baseMp4: Blob,
  options: BurnInClientOptions,
): Promise<Blob> {
  if (!isExtensionContextValid()) {
    throw new Error(
      'Extension context invalidated. Reload the extension, then refresh this Reddit tab.',
    );
  }

  const jobId = crypto.randomUUID();
  const mp4Bytes = new Uint8Array(await baseMp4.arrayBuffer());
  if (mp4Bytes.byteLength === 0) {
    throw new Error('Base MP4 is empty before subtitle burn-in.');
  }

  const mp4Packed = packBinary(mp4Bytes);
  verifyMp4PackedBinary(mp4Packed);

  const segments = options.segments.filter((segment) => segment.text.trim().length > 0);
  if (segments.length === 0) {
    throw new Error('No subtitle segments available for burn-in.');
  }

  console.log(`${EXTENSION_LOG_PREFIX} Sending MP4 for subtitle burn-in`, {
    jobId,
    bytes: mp4Packed.byteLength,
    segments: segments.length,
  });

  return new Promise<Blob>((resolve, reject) => {
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
      options.onProgress?.(clamped);
    };

    const cleanup = () => {
      options.signal?.removeEventListener('abort', onAbort);
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
      fail('Subtitle burn-in cancelled.', true);
    };

    options.signal?.addEventListener('abort', onAbort);

    const resetStallTimer = () => {
      lastMeaningfulProgressAt = Date.now();
      if (stallTimer !== null) window.clearTimeout(stallTimer);
      stallTimer = window.setTimeout(() => {
        const stalledFor = Math.round((Date.now() - lastMeaningfulProgressAt) / 1000);
        requestOffscreenCancel(jobId);
        fail(
          `Subtitle burn-in stalled (no real progress for ${stalledFor}s). Reload the extension if this keeps happening.`,
        );
      }, STALL_TIMEOUT_MS);
    };

    absoluteTimer = window.setTimeout(() => {
      requestOffscreenCancel(jobId);
      fail(
        `Subtitle burn-in exceeded the ${Math.round(ABSOLUTE_MAX_MS / 1000)}s safety limit. Reload the extension and try again.`,
      );
    }, ABSOLUTE_MAX_MS);

    ackTimer = window.setTimeout(() => {
      if (!gotAck) {
        fail('Subtitle burn-in did not start (background relay timeout). Reload the extension and try again.');
      }
    }, ACK_TIMEOUT_MS);

    const onBroadcast = (message: unknown) => {
      if (!message || typeof message !== 'object' || !('type' in message) || !('jobId' in message)) {
        return;
      }
      if ((message as { jobId: string }).jobId !== jobId) return;

      if ((message as { type: string }).type === MSG_BURNIN_PROGRESS) {
        const progressMsg = message as BurnInProgressMessage;
        if (isMeaningfulProgress(progressMsg, lastMeaningfulRatio, lastMeaningfulStage)) {
          lastMeaningfulRatio = Math.max(lastMeaningfulRatio, progressMsg.progress / 100);
          lastMeaningfulStage = progressMsg.stage ?? lastMeaningfulStage;
          resetStallTimer();
        }
        reportProgress(progressMsg.progress / 100);
        return;
      }

      if ((message as { type: string }).type === MSG_BURNIN_COMPLETE) {
        const completeMsg = message as BurnInCompleteMessage;
        cleanup();

        if (!completeMsg.ok) {
          reject(new Error(completeMsg.error ?? 'Subtitle burn-in failed.'));
          return;
        }

        if (!completeMsg.mp4Base64 || !completeMsg.mp4ByteLength) {
          reject(new Error('Burned MP4 result missing from offscreen worker.'));
          return;
        }

        try {
          verifyMp4PackedBinary({
            dataBase64: completeMsg.mp4Base64,
            byteLength: completeMsg.mp4ByteLength,
          });
          reportProgress(1);
          const outBytes = unpackBinary(completeMsg.mp4Base64, completeMsg.mp4ByteLength);
          resolve(new Blob([Uint8Array.from(outBytes)], { type: 'video/mp4' }));
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          reject(new Error(`Burned MP4 could not be decoded: ${detail}`));
        }
      }
    };

    browser.runtime.onMessage.addListener(onBroadcast);

    const request: BurnInStartRequest = {
      type: MSG_BURNIN_START,
      jobId,
      mp4Base64: mp4Packed.dataBase64,
      mp4ByteLength: mp4Packed.byteLength,
      segmentsJson: JSON.stringify(segments),
      styleJson: JSON.stringify(normalizeSubtitleStyle(options.style)),
    };

    if (options.signal?.aborted) {
      fail('Subtitle burn-in cancelled.', true);
      return;
    }

    browser.runtime
      .sendMessage(request)
      .then((ack) => {
        if (options.signal?.aborted) {
          fail('Subtitle burn-in cancelled.', true);
          return;
        }
        const response = ack as BurnInAckResponse | undefined;
        if (!response?.ok) {
          fail(response?.error ?? 'Failed to start subtitle burn-in.');
          return;
        }
        if (response.jobId !== jobId) {
          fail('Burn-in ack jobId mismatch from background relay.');
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