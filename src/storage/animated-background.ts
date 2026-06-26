/**
 * Animated GIF background engine (animated branch, Phase 2).
 *
 * Decodes a GIF's frames once via WebCodecs `ImageDecoder`, converts each to an
 * `ImageBitmap` (so it slots into the existing `DrawableBackgroundImage` draw path
 * with zero changes), and exposes `frameAt(elapsedMs)` for the RAF loops to pick the
 * current frame. The canvas is captured by `MediaRecorder`, so animating here makes
 * the *recorder, the Studio preview, and the exported MP4* all loop in sync — the
 * project's single-canvas WYSIWYG contract. FFmpeg is never involved.
 *
 * See docs/gif-animation-design-implementation.md.
 */

/** Canvas is 640×360 (constants.ts); frames never need to exceed that to fill it. */
const MAX_FRAME_DIMENSION = 640;
/** Hard caps so a pathological GIF can't exhaust the page heap. Whichever hits first truncates the loop. */
const MAX_ANIMATED_FRAMES = 120;
const MAX_TOTAL_FRAME_BYTES = 128 * 1024 * 1024;

// ── Frame-timing policy (the one knob with real trade-offs) ──────────────────
// GIFs commonly encode a 0 ms or sub-tick delay that authoring tools never intended
// to play "as fast as possible"; browsers historically clamp such frames to ~100 ms.
// We mirror that so imported GIFs loop at the speed users see elsewhere. Tune here.
const GIF_MIN_FRAME_DELAY_MS = 20;
const GIF_DEFAULT_FRAME_DELAY_MS = 100;

/** A decoded GIF frame + its (clamped) display duration. */
interface AnimatedFrame {
  bitmap: ImageBitmap;
  /** Cumulative end time of this frame within one loop, in ms. */
  endMs: number;
}

export class AnimatedBackground {
  private readonly frames: readonly AnimatedFrame[];
  readonly totalDurationMs: number;
  readonly frameCount: number;
  /** True only when there's genuine motion (>1 frame); 1-frame GIFs collapse to static. */
  readonly isAnimated: boolean;
  private disposed = false;

  constructor(frames: readonly AnimatedFrame[], totalDurationMs: number) {
    this.frames = frames;
    this.totalDurationMs = totalDurationMs;
    this.frameCount = frames.length;
    this.isAnimated = frames.length > 1 && totalDurationMs > 0;
  }

  /**
   * Select the frame visible at `elapsedMs`. Loops seamlessly via modulo over the
   * total duration. `elapsedMs <= 0` (e.g. reduced-motion freeze) returns frame 0.
   */
  frameAt(elapsedMs: number): ImageBitmap {
    const frames = this.frames;
    if (this.disposed || frames.length === 0) {
      throw new Error('AnimatedBackground has no frames.');
    }
    if (!this.isAnimated || elapsedMs <= 0) return frames[0].bitmap;

    const t = elapsedMs % this.totalDurationMs;
    // Linear scan — frame counts are capped at 120, so this is trivially cheap at 24 fps.
    for (const frame of frames) {
      if (t < frame.endMs) return frame.bitmap;
    }
    return frames[frames.length - 1].bitmap;
  }

  /** First frame — the static fallback baseline shared with non-animated code paths. */
  firstFrame(): ImageBitmap {
    return this.frames[0].bitmap;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const frame of this.frames) frame.bitmap.close();
  }
}

/** WebCodecs `ImageDecoder` is the GIF frame source — feature-detect before use. */
export function animatedDecodeSupported(): boolean {
  return typeof ImageDecoder !== 'undefined';
}

/** MIME types we know how to animate. GIF only for now (APNG/animated WebP could join later). */
export function isAnimatableMime(mimeType: string): boolean {
  return mimeType.toLowerCase() === 'image/gif';
}

function clampFrameDelayMs(rawDurationUs: number | null): number {
  const ms = rawDurationUs != null ? rawDurationUs / 1000 : 0;
  return ms <= GIF_MIN_FRAME_DELAY_MS ? GIF_DEFAULT_FRAME_DELAY_MS : ms;
}

async function bitmapFromFrame(frame: VideoFrame): Promise<ImageBitmap> {
  const longest = Math.max(frame.displayWidth, frame.displayHeight);
  if (longest > MAX_FRAME_DIMENSION) {
    const scale = MAX_FRAME_DIMENSION / longest;
    return createImageBitmap(frame, {
      resizeWidth: Math.max(1, Math.round(frame.displayWidth * scale)),
      resizeHeight: Math.max(1, Math.round(frame.displayHeight * scale)),
      resizeQuality: 'medium',
    });
  }
  return createImageBitmap(frame);
}

/**
 * Decode GIF bytes into an `AnimatedBackground`. Returns `null` on unsupported env,
 * non-animatable MIME, or decode failure — callers fall back to a static first frame.
 */
export async function decodeAnimatedBackground(
  bytes: Uint8Array,
  mimeType: string,
): Promise<AnimatedBackground | null> {
  if (!animatedDecodeSupported() || !isAnimatableMime(mimeType)) return null;

  let decoder: ImageDecoder | null = null;
  try {
    // Copy into a fresh ArrayBuffer so the decoder owns a non-shared, non-detachable buffer.
    const data = new Uint8Array(bytes.byteLength);
    data.set(bytes);

    decoder = new ImageDecoder({ data, type: mimeType });
    await decoder.tracks.ready;
    await decoder.completed; // full buffer → frameCount is final after this resolves

    const track = decoder.tracks.selectedTrack;
    const frameCount = track?.frameCount ?? 1;

    const frames: AnimatedFrame[] = [];
    let cumulativeMs = 0;
    let totalBytes = 0;

    for (let i = 0; i < frameCount && i < MAX_ANIMATED_FRAMES; i += 1) {
      const result = await decoder.decode({ frameIndex: i, completeFramesOnly: true });
      const videoFrame = result.image;
      try {
        const bitmap = await bitmapFromFrame(videoFrame);
        cumulativeMs += clampFrameDelayMs(videoFrame.duration);
        frames.push({ bitmap, endMs: cumulativeMs });
        totalBytes += bitmap.width * bitmap.height * 4;
      } finally {
        videoFrame.close();
      }
      if (totalBytes >= MAX_TOTAL_FRAME_BYTES) break; // truncate oversized loops gracefully
    }

    if (frames.length === 0) return null;
    return new AnimatedBackground(frames, cumulativeMs);
  } catch (error) {
    console.warn('[Reddit Voice Notes] Animated GIF decode failed:', error);
    return null;
  } finally {
    decoder?.close();
  }
}
