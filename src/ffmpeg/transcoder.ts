import { withTranscodeLock } from '@/src/ffmpeg/transcode-lock';
import { packBinary, unpackBinary } from '@/src/messaging/binary';
import { verifyMp4PackedBinary, verifyWebmPackedBinary } from '@/src/messaging/binary-verify';
import {
  MSG_TRANSCODE_ACK,
  MSG_TRANSCODE_COMPLETE,
  MSG_TRANSCODE_PROGRESS,
  MSG_TRANSCODE_START,
  type TranscodeAckResponse,
  type TranscodeCompleteMessage,
  type TranscodeProgressMessage,
  type TranscodeStartRequest,
} from '@/src/messaging/types';
import { EXTENSION_LOG_PREFIX } from '@/src/utils/constants';

/** Fail only when progress truly stalls — not on slow but healthy jobs. */
const STALL_TIMEOUT_MS = 45_000;
/** Background must ack (job accepted for relay) within this window. */
const ACK_TIMEOUT_MS = 45_000;
/** Hard ceiling for a single transcode job (includes WASM cold start + queue wait). */
const ABSOLUTE_MAX_MS = 6 * 60 * 1000;

function isExtensionContextValid(): boolean {
  try {
    return Boolean(browser.runtime?.id);
  } catch {
    return false;
  }
}

export async function transcodeWebmToMp4(
  webm: Blob,
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  if (signal?.aborted) {
    throw new DOMException('Transcode cancelled.', 'AbortError');
  }

  return withTranscodeLock(async () => {
    if (signal?.aborted) {
      throw new DOMException('Transcode cancelled.', 'AbortError');
    }
    return transcodeWebmToMp4Inner(webm, onProgress, signal);
  });
}

async function transcodeWebmToMp4Inner(
  webm: Blob,
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
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

  return new Promise<Blob>((resolve, reject) => {
    let stallTimer: number | null = null;
    let absoluteTimer: number | null = null;
    let ackTimer: number | null = null;
    let gotAck = false;
    let lastProgressAt = Date.now();
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
      lastProgressAt = Date.now();
      if (stallTimer !== null) window.clearTimeout(stallTimer);
      stallTimer = window.setTimeout(() => {
        const stalledFor = Math.round((Date.now() - lastProgressAt) / 1000);
        fail(
          `Transcode stalled (no progress for ${stalledFor}s). Reload the extension if this keeps happening.`,
        );
      }, STALL_TIMEOUT_MS);
    };

    absoluteTimer = window.setTimeout(() => {
      fail(`FFmpeg transcoding exceeded the ${Math.round(ABSOLUTE_MAX_MS / 60_000)}-minute safety limit.`);
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
        resetStallTimer();
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
          resolve(new Blob([Uint8Array.from(mp4Bytes)], { type: 'video/mp4' }));
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