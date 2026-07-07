import { EXTENSION_LOG_PREFIX } from '@/src/utils/constants';

const WEBM_EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3] as const;
const PREFLIGHT_METADATA_TIMEOUT_MS = 10_000;
/** Background tabs throttle <video> metadata probes — allow more time before fallback. */
const PREFLIGHT_METADATA_TIMEOUT_HIDDEN_MS = 30_000;
/** Brief wait for durationchange when Chrome initially reports NaN on fresh MediaRecorder blobs. */
const DURATION_SETTLE_MS = 400;
/** ~50 KiB/s floor — a 2:00 cap-stop clip should be several MB. */
const STRUCTURAL_BYTES_PER_SECOND = 50_000;

export function hasWebmEbmlMagic(bytes: Uint8Array): boolean {
  return WEBM_EBML_MAGIC.every((value, index) => bytes[index] === value);
}

/**
 * Structural fallback when the <video> metadata probe is throttled (background
 * tab). FFmpeg transcode remains the real validator; this only avoids a false
 * reject on otherwise healthy MediaRecorder blobs.
 */
export function webmStructuralPreflightPasses(
  byteLength: number,
  expectedDurationSeconds?: number,
): boolean {
  if (byteLength < 256) return false;
  if (
    typeof expectedDurationSeconds === 'number' &&
    Number.isFinite(expectedDurationSeconds) &&
    expectedDurationSeconds > 0
  ) {
    const minBytes = Math.max(256, Math.floor(expectedDurationSeconds * STRUCTURAL_BYTES_PER_SECOND * 0.35));
    return byteLength >= minBytes;
  }
  // Long recordings without a duration hint — require at least ~1s of payload.
  return byteLength >= STRUCTURAL_BYTES_PER_SECOND;
}

function hasWebmMagic(bytes: Uint8Array): boolean {
  return hasWebmEbmlMagic(bytes);
}

function seekableEndSeconds(video: HTMLVideoElement): number | null {
  if (video.seekable.length === 0) return null;
  const end = video.seekable.end(video.seekable.length - 1);
  return Number.isFinite(end) && end > 0 ? end : null;
}

/**
 * MediaRecorder WebM in Chrome often reports duration=Infinity even when the file is valid.
 * FFmpeg transcodes these fine; only reject when metadata truly indicates an empty file.
 */
function hasPlayableDuration(video: HTMLVideoElement): boolean {
  const duration = video.duration;

  if (Number.isFinite(duration) && duration > 0) {
    return true;
  }

  // BUG FIX: WebM preflight false reject on MediaRecorder stop
  // Fix: Infinity duration is normal for live-recorded WebM without a Duration element.
  if (duration === Infinity) {
    return true;
  }

  const seekableEnd = seekableEndSeconds(video);
  if (seekableEnd !== null) {
    return true;
  }

  return false;
}

function waitForDurationSettle(video: HTMLVideoElement): Promise<void> {
  if (hasPlayableDuration(video)) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      if (hasPlayableDuration(video)) {
        resolve();
        return;
      }
      reject(new Error('Recording has no playable duration. Try recording again.'));
    }, DURATION_SETTLE_MS);

    const onDurationChange = () => {
      if (!hasPlayableDuration(video)) return;
      cleanup();
      resolve();
    };

    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener('durationchange', onDurationChange);
    };

    video.addEventListener('durationchange', onDurationChange);
  });
}

export interface ValidateWebmRecordingOptions {
  /** Recorder timer — enables structural fallback when metadata is slow. */
  expectedDurationSeconds?: number;
}

function resolveMetadataTimeoutMs(): number {
  return typeof document !== 'undefined' && document.hidden
    ? PREFLIGHT_METADATA_TIMEOUT_HIDDEN_MS
    : PREFLIGHT_METADATA_TIMEOUT_MS;
}

function tryStructuralPreflightFallback(
  blob: Blob,
  reason: string,
  expectedDurationSeconds?: number,
): void {
  if (!webmStructuralPreflightPasses(blob.size, expectedDurationSeconds)) {
    throw new Error(
      'Recording could not be verified before transcoding (metadata timeout). Try recording again.',
    );
  }
  console.warn(
    `${EXTENSION_LOG_PREFIX} WebM preflight: ${reason} — accepting structural checks only`,
    {
      bytes: blob.size,
      expectedDurationSeconds,
      hidden: typeof document !== 'undefined' ? document.hidden : undefined,
    },
  );
}

/**
 * Browser-side decode check before paying the FFmpeg relay cost.
 * Catches corrupt/truncated WebM from cap-stop races early with a clear error.
 */
export async function validateWebmRecording(
  blob: Blob,
  options?: ValidateWebmRecordingOptions,
): Promise<void> {
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
        try {
          tryStructuralPreflightFallback(
            blob,
            'metadata timeout',
            options?.expectedDurationSeconds,
          );
          resolve();
        } catch (error: unknown) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }, resolveMetadataTimeoutMs());

      const cleanup = () => {
        window.clearTimeout(timer);
        video.removeAttribute('src');
        video.load();
      };

      video.onloadedmetadata = () => {
        void waitForDurationSettle(video)
          .then(() => {
            cleanup();
            const duration = video.duration;
            const seekableEnd = seekableEndSeconds(video);
            console.log(`${EXTENSION_LOG_PREFIX} WebM preflight ok`, {
              bytes: blob.size,
              durationSec: Number.isFinite(duration)
                ? Math.round(duration * 10) / 10
                : duration === Infinity
                  ? 'Infinity (MediaRecorder)'
                  : 'unknown',
              seekableEndSec: seekableEnd !== null ? Math.round(seekableEnd * 10) / 10 : null,
            });
            resolve();
          })
          .catch((error: unknown) => {
            cleanup();
            reject(error instanceof Error ? error : new Error(String(error)));
          });
      };

      video.onerror = () => {
        cleanup();
        try {
          tryStructuralPreflightFallback(
            blob,
            'metadata decode error',
            options?.expectedDurationSeconds,
          );
          resolve();
        } catch (error: unknown) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };

      video.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}