/**
 * v5.3.10 — Per-chunk WebCodecs overlay encoder (dual VP8/VP9 stream).
 *
 * Replaces the MediaRecorder capture for one planned chunk. The decisive
 * difference: MediaRecorder ingests canvas frames at wall-clock rate (a 15 s
 * chunk takes ≥15 s no matter how fast paint is), while VideoEncoder accepts
 * frames as fast as we can paint them — encode throughput, not clip duration,
 * bounds the wall time.
 *
 * ALPHA: Chrome's VideoEncoder cannot encode an alpha plane, so each frame
 * becomes TWO encoded frames:
 * - COLOR: VideoFrame straight from the paint canvas with alpha:'discard'.
 *   Canvas backing stores are premultiplied, so discarding alpha yields color
 *   composited over black — premultiplied color. The composite graph undoes
 *   this (unpremultiply; see overlay-alphamerge-args.ts).
 * - ALPHA: the paint canvas's alpha channel rendered as opaque grayscale via
 *   three GPU compositing ops (white fill → destination-in overlay →
 *   destination-over black). Luma == alpha, no per-pixel readbacks.
 *
 * TIMESTAMPS: frames are stamped from the GLOBAL frame index — the same
 * (startFrame + i) / fps expression the serial and MediaRecorder-parallel
 * paths paint at — and the muxed IVF PTS is exactly that integer index
 * (timebase 1/fps). Chunk streams are frame-exact by construction: no warmup,
 * no tail-hold frames, no trim, structurally zero seam jitter.
 *
 * Sync: subtitle-overlay-renderer.ts createOverlayFramePainter (paint seam),
 *       webcodecs-support.ts (config + calibration), ivf.ts (container),
 *       subtitle-overlay-webcodecs.ts (orchestration),
 *       overlay-chunk-planner.ts PlannedOverlayChunk (chunk contract)
 */

import { throwIfRenderAborted } from '@/src/transcription/canvas-render-perf-guard';
import type { OverlayFramePainter } from '@/src/transcription/subtitle-overlay-renderer';
import type { PlannedOverlayChunk } from '@/src/transcription/overlay-chunk-planner';
import type { CueOverlayCacheStats } from '@/src/transcription/subtitle-overlay-cue-cache';
import {
  computeSegmentCueSpan,
  type EncodedOverlaySegmentMeta,
} from '@/src/encoding/encoded-segment';
import { buildIvf, type IvfFrame } from '@/src/encoding/ivf';
import {
  buildOverlayEncoderConfig,
  type OverlayWebCodecsSupport,
} from '@/src/encoding/webcodecs-support';

/**
 * Backpressure ceiling — pause painting while either encoder's queue exceeds
 * this, so a slow encoder bounds memory instead of accumulating VideoFrames.
 */
const MAX_ENCODE_QUEUE_DEPTH = 8;

/** Yield to the event loop every N painted frames so the Studio UI stays live. */
const YIELD_EVERY_FRAMES = 8;

interface CueLike {
  start: number;
  end: number;
}

export interface EncodeOverlayChunkInput {
  painter: OverlayFramePainter;
  chunk: PlannedOverlayChunk;
  fps: number;
  cues: CueLike[];
  support: OverlayWebCodecsSupport;
  signal?: AbortSignal;
  /** Fired after each painted+submitted frame with frames done so far. */
  onFrameDone?: (framesDone: number) => void;
}

export interface EncodedOverlayChunkResult {
  colorIvf: Uint8Array;
  alphaIvf: Uint8Array;
  meta: EncodedOverlaySegmentMeta;
  cueCache: CueOverlayCacheStats;
}

/** Cooperative yield — scheduler.yield when available, macrotask otherwise. */
async function yieldToEventLoop(): Promise<void> {
  const sched = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (sched?.yield) {
    await sched.yield();
    return;
  }
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function waitForQueueDrain(encoder: VideoEncoder): Promise<void> {
  return new Promise<void>((resolve) => {
    encoder.addEventListener('dequeue', () => resolve(), { once: true });
  });
}

interface ChunkCollector {
  frames: IvfFrame[];
  error: unknown;
}

function createEncoder(
  config: VideoEncoderConfig,
  fps: number,
  collector: ChunkCollector,
): VideoEncoder {
  const encoder = new VideoEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      // Recover the global frame index from the µs timestamp — exact for the
      // round(index * 1e6 / fps) stamping used below.
      collector.frames.push({
        data,
        ptsFrames: Math.round(((chunk.timestamp ?? 0) * fps) / 1_000_000),
      });
    },
    error: (error) => {
      collector.error = error;
    },
  });
  encoder.configure(config);
  return encoder;
}

function buildAlphaExtractor(width: number, height: number): {
  canvas: OffscreenCanvas;
  extractFrom(source: CanvasImageSource): void;
} {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Alpha extraction canvas 2D context unavailable.');
  return {
    canvas,
    extractFrom(source: CanvasImageSource): void {
      // 1. Replace everything with opaque white.
      ctx.globalCompositeOperation = 'copy';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      // 2. Keep white only where the overlay has coverage, scaled by its alpha.
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(source, 0, 0);
      // 3. Flatten over opaque black: gray value == overlay alpha.
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'source-over';
    },
  };
}

function rethrowCollectorError(collector: ChunkCollector, label: string): void {
  if (collector.error) {
    throw collector.error instanceof Error
      ? collector.error
      : new Error(`${label} encoder failed: ${String(collector.error)}`);
  }
}

/**
 * Encode one planned chunk into color + alpha IVF segments. Throws on any
 * failure (including aborts) — the orchestrator decides whether that means
 * rethrow (deliberate abort) or MediaRecorder fallback.
 */
export async function encodeOverlayChunkWithWebCodecs(
  input: EncodeOverlayChunkInput,
): Promise<EncodedOverlayChunkResult> {
  const { painter, chunk, fps, support } = input;
  const startedAt = performance.now();
  const encoderInput = { width: painter.width, height: painter.height, fps };

  const colorCollector: ChunkCollector = { frames: [], error: null };
  const alphaCollector: ChunkCollector = { frames: [], error: null };
  const colorEncoder = createEncoder(
    buildOverlayEncoderConfig(support.candidate, encoderInput, 'color'),
    fps,
    colorCollector,
  );
  const alphaEncoder = createEncoder(
    buildOverlayEncoderConfig(support.candidate, encoderInput, 'alpha'),
    fps,
    alphaCollector,
  );
  const alphaExtractor = buildAlphaExtractor(painter.width, painter.height);

  let paintMs = 0;
  try {
    for (let i = 0; i < chunk.frameCount; i += 1) {
      throwIfRenderAborted(input.signal);
      rethrowCollectorError(colorCollector, 'Color');
      rethrowCollectorError(alphaCollector, 'Alpha');

      while (
        colorEncoder.encodeQueueSize > MAX_ENCODE_QUEUE_DEPTH ||
        alphaEncoder.encodeQueueSize > MAX_ENCODE_QUEUE_DEPTH
      ) {
        await waitForQueueDrain(
          colorEncoder.encodeQueueSize > alphaEncoder.encodeQueueSize
            ? colorEncoder
            : alphaEncoder,
        );
        throwIfRenderAborted(input.signal);
      }

      const globalFrame = chunk.startFrame + i;
      const paintStartedAt = performance.now();
      // Global timestamp: identical expression to the serial render for the
      // same global frame — keeps animation phase + cache keys chunk-invariant.
      painter.paintFrameAt(globalFrame / fps);
      alphaExtractor.extractFrom(painter.canvas);
      paintMs += performance.now() - paintStartedAt;

      const timestamp = Math.round((globalFrame * 1_000_000) / fps);
      const duration = Math.round(1_000_000 / fps);
      // Segment-start keyframe on both streams: every segment must decode
      // independently (concat correctness now, selective re-encode later).
      const keyFrame = i === 0;

      const colorFrame = new VideoFrame(painter.canvas, {
        timestamp,
        duration,
        alpha: 'discard',
      });
      colorEncoder.encode(colorFrame, { keyFrame });
      colorFrame.close();

      const alphaFrame = new VideoFrame(alphaExtractor.canvas, {
        timestamp,
        duration,
        alpha: 'discard',
      });
      alphaEncoder.encode(alphaFrame, { keyFrame });
      alphaFrame.close();

      input.onFrameDone?.(i + 1);
      if ((i + 1) % YIELD_EVERY_FRAMES === 0) {
        await yieldToEventLoop();
      }
    }

    await Promise.all([colorEncoder.flush(), alphaEncoder.flush()]);
    rethrowCollectorError(colorCollector, 'Color');
    rethrowCollectorError(alphaCollector, 'Alpha');
  } finally {
    for (const encoder of [colorEncoder, alphaEncoder]) {
      try {
        encoder.close();
      } catch {
        // Already closed by an encoder error.
      }
    }
  }

  for (const [label, collector] of [
    ['Color', colorCollector],
    ['Alpha', alphaCollector],
  ] as const) {
    if (collector.frames.length !== chunk.frameCount) {
      throw new Error(
        `${label} encoder emitted ${collector.frames.length} frames ` +
          `for a ${chunk.frameCount}-frame chunk.`,
      );
    }
  }

  const streamParams = {
    fourcc: support.candidate.ivfFourcc,
    width: painter.width,
    height: painter.height,
    timebaseRate: fps,
    timebaseScale: 1,
  } as const;
  const colorIvf = buildIvf(streamParams, colorCollector.frames);
  const alphaIvf = buildIvf(streamParams, alphaCollector.frames);
  const encodeMs = Math.round(performance.now() - startedAt);

  const meta: EncodedOverlaySegmentMeta = {
    index: chunk.index,
    startFrame: chunk.startFrame,
    frameCount: chunk.frameCount,
    fps,
    startSeconds: chunk.startSeconds,
    durationSeconds: chunk.durationSeconds,
    cutQuality: chunk.cutQuality,
    encoderType: 'webcodecs',
    codec: support.candidate.codec,
    cueSpan: computeSegmentCueSpan(input.cues, chunk.startFrame, chunk.frameCount, fps),
    paintMs: Math.round(paintMs),
    encodeMs,
    colorBytes: colorIvf.byteLength,
    alphaBytes: alphaIvf.byteLength,
  };

  return { colorIvf, alphaIvf, meta, cueCache: painter.cacheStats() };
}
