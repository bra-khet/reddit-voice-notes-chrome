import { EXTENSION_LOG_PREFIX } from '@/src/utils/constants';

const WEBM_EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3] as const;
const PREFLIGHT_METADATA_TIMEOUT_MS = 10_000;

function hasWebmMagic(bytes: Uint8Array): boolean {
  return WEBM_EBML_MAGIC.every((value, index) => bytes[index] === value);
}

/**
 * Browser-side decode check before paying the FFmpeg relay cost.
 * Catches corrupt/truncated WebM from cap-stop races early with a clear error.
 */
export async function validateWebmRecording(blob: Blob): Promise<void> {
  if (blob.size < 256) {
    throw new Error('Recording is too small to transcode. Try recording for at least one second.');
  }

  const header = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  if (!hasWebmMagic(header)) {
    throw new Error('Recording is not a valid WebM file. Try recording again.');
  }

  const url = URL.createObjectURL(blob);

  try {
    await new Promise<void>((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';

      const timer = window.setTimeout(() => {
        cleanup();
        reject(
          new Error(
            'Recording could not be verified before transcoding (metadata timeout). Try recording again.',
          ),
        );
      }, PREFLIGHT_METADATA_TIMEOUT_MS);

      const cleanup = () => {
        window.clearTimeout(timer);
        video.removeAttribute('src');
        video.load();
      };

      video.onloadedmetadata = () => {
        cleanup();
        if (!Number.isFinite(video.duration) || video.duration <= 0) {
          reject(new Error('Recording has no playable duration. Try recording again.'));
          return;
        }
        console.log(`${EXTENSION_LOG_PREFIX} WebM preflight ok`, {
          bytes: blob.size,
          durationSec: Math.round(video.duration * 10) / 10,
        });
        resolve();
      };

      video.onerror = () => {
        cleanup();
        reject(
          new Error(
            'Recording could not be decoded by the browser. Try recording again before transcoding.',
          ),
        );
      };

      video.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}