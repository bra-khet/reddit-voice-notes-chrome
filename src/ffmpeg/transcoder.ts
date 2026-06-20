import { packBinary, unpackBinary } from '@/src/messaging/binary';
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

/** Backstop only — per-strategy timeouts in ffmpeg-runner.ts should fire first. */
const TRANSCODE_TIMEOUT_BASE_MS = 2 * 60 * 1000;
const TRANSCODE_TIMEOUT_PER_MB_MS = 10_000;
const TRANSCODE_TIMEOUT_MAX_MS = 4 * 60 * 1000;

function transcodeTimeoutMs(webmBytes: number): number {
  const megabytes = webmBytes / (1024 * 1024);
  return Math.min(
    TRANSCODE_TIMEOUT_MAX_MS,
    TRANSCODE_TIMEOUT_BASE_MS + Math.ceil(megabytes) * TRANSCODE_TIMEOUT_PER_MB_MS,
  );
}

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

  console.log(`${EXTENSION_LOG_PREFIX} Sending WebM for transcode`, {
    jobId,
    bytes: webmPacked.byteLength,
    base64Chars: webmPacked.dataBase64.length,
  });

  const timeoutMs = transcodeTimeoutMs(webmBytes.byteLength);

  return new Promise<Blob>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      browser.runtime.onMessage.removeListener(onBroadcast);
      reject(
        new Error(
          `FFmpeg transcoding timed out after ${Math.round(timeoutMs / 60_000)} minutes.`,
        ),
      );
    }, timeoutMs);

    const onBroadcast = (message: unknown) => {
      if (!message || typeof message !== 'object' || !('type' in message) || !('jobId' in message)) {
        return;
      }
      if ((message as { jobId: string }).jobId !== jobId) return;

      if ((message as { type: string }).type === MSG_TRANSCODE_PROGRESS) {
        const progressMsg = message as TranscodeProgressMessage;
        onProgress?.(progressMsg.progress / 100);
        return;
      }

      if ((message as { type: string }).type === MSG_TRANSCODE_COMPLETE) {
        const completeMsg = message as TranscodeCompleteMessage;
        window.clearTimeout(timeoutId);
        browser.runtime.onMessage.removeListener(onBroadcast);

        if (!completeMsg.ok) {
          reject(new Error(completeMsg.error ?? 'FFmpeg transcoding failed.'));
          return;
        }

        try {
          onProgress?.(1);
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

    browser.runtime
      .sendMessage(request)
      .then((ack) => {
        const response = ack as TranscodeAckResponse | undefined;
        if (!response?.ok) {
          window.clearTimeout(timeoutId);
          browser.runtime.onMessage.removeListener(onBroadcast);
          reject(new Error(response?.error ?? 'Failed to start FFmpeg transcoding.'));
          return;
        }
        onProgress?.(0.01);
      })
      .catch((error) => {
        window.clearTimeout(timeoutId);
        browser.runtime.onMessage.removeListener(onBroadcast);
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('Extension context invalidated')) {
          reject(
            new Error(
              'Extension context invalidated. Reload the extension, then refresh this Reddit tab.',
            ),
          );
          return;
        }
        reject(new Error(message));
      });
  });
}