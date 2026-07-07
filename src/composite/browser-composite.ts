/**
 * v5.5.0 — Browser-side full composite orchestrator (ADR-0003).
 *
 * Replaces the FFmpeg alphamerge + x264 composite for the primary WebCodecs
 * bake path: the ~43 s single-threaded WASM wall becomes a browser
 * decode→blend→encode loop bounded by VideoDecoder/VideoEncoder throughput.
 *
 * PIPELINE (all in the Design Studio page, no new execution context):
 *   mediabunny Input(BlobSource(baseMp4))
 *     → VideoSampleSink.samples()            (decode, presentation order,
 *                                             internally pipelined)
 *     → per frame: draw base sample → painter.paintFrameAt(sample.timestamp)
 *                  → drawImage(painter.canvas)  ← THE new blend surface
 *     → CanvasSource.add(t, d)               (encode; awaited = backpressure)
 *     → audio packets passthrough (no re-encode), interleaved with video
 *     → Output(Mp4OutputFormat{fastStart:'in-memory'}) → Blob
 *
 * BLEND SEMANTICS: the painter's RGBA canvas is composited with a single
 * source-over drawImage — straight-alpha blending handled natively by canvas
 * 2D. The entire alphamerge / unpremultiply / limited-range-luma machinery of
 * the legacy path exists only to carry alpha through VP8 into FFmpeg and is
 * structurally unnecessary here (R1/R2 remain scoped to fallback paths; the
 * new surface's own risk is R9 and is gated by the fidelity harness).
 *
 * TIMESTAMPS: the painter is evaluated at each decoded frame's EXACT output
 * PTS (base timeline, 24 fps for our transcodes) — the strongest form of the
 * global-frame contract: deterministic (PTS ≡ frameIndex/fps for pipeline
 * MP4s) and free of the legacy 30→24 fps overlay resampling stagger.
 *
 * FAILURE POLICY: deliberate aborts rethrow as AbortError; every other
 * failure throws a plain Error. The CALLER (subtitle-canvas-bake.ts) owns the
 * fallback chain — browser composite → WebCodecs-IVF+alphamerge →
 * MediaRecorder → drawtext. This module never returns partial results: the
 * output is validated (frame count, packet count, ≤1-frame duration drift)
 * before the Blob is handed back.
 *
 * Sync: composite-plan.ts (constants + progress model + validation),
 *       browser-composite-support.ts (probe), subtitle-canvas-bake.ts
 *       (consumer + fallback owner), subtitle-overlay-renderer.ts
 *       createOverlayFramePainter (paint seam),
 *       docs/v5.5.0-browser-composite-migration.md
 */

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSource,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  Input,
  Mp4OutputFormat,
  Output,
  VideoSampleSink,
  type EncodedPacket,
  type InputAudioTrack,
} from 'mediabunny';
import {
  BROWSER_COMPOSITE_KEYFRAME_INTERVAL_SECONDS,
  BROWSER_COMPOSITE_STAGES,
  BROWSER_COMPOSITE_VIDEO_BPS,
  compositeOutputMayExceedStoreCap,
  computeBrowserCompositeProgress,
  validateCompositeOutput,
  type BrowserCompositeStage,
} from '@/src/composite/composite-plan';
import {
  probeBrowserCompositeSupport,
  type BrowserCompositeSupport,
} from '@/src/composite/browser-composite-support';
import {
  createOverlayFramePainter,
  normalizeOverlaySegments,
} from '@/src/transcription/subtitle-overlay-renderer';
import type { SubtitleStyleConfig, TranscriptSegment } from '@/src/transcription/types';
import { EXTENSION_LOG_PREFIX } from '@/src/utils/constants';

/** Yield to the event loop every N frames so the Studio UI stays live. */
const YIELD_EVERY_FRAMES = 8;

/** Audio packets are muxed ahead of video no further than this (seconds). */
const AUDIO_INTERLEAVE_WINDOW_SECONDS = 1;

/** Progress band inside this module's [0,1] ratio space. */
const SETUP_RATIO_END = 0.03;
const LOOP_RATIO_END = 0.97;

export interface BrowserCompositeTiming {
  outputCodec: string;
  frameCount: number;
  /** Demux + probe + painter + muxer setup wall time. */
  setupMs: number;
  /** Decode+blend+encode loop wall time (the dominant stage). */
  loopMs: number;
  /** Painter paint time inside the loop (subset of loopMs). */
  paintMs: number;
  /** output.finalize() wall time. */
  finalizeMs: number;
  totalMs: number;
  outputBytes: number;
}

export interface BrowserCompositeOptions {
  baseMp4: Blob;
  /** Prepared cues (prepareSegmentsForSubtitleBake output). */
  segments: TranscriptSegment[];
  style: SubtitleStyleConfig;
  durationSeconds: number;
  themeBarColor?: string;
  signal?: AbortSignal;
  /** ratio is module-local [0,1]; the caller maps it into the bake band. */
  onProgress?: (ratio: number, stage: BrowserCompositeStage) => void;
  /** Overlay Lab timing JSON hook. */
  onTiming?: (timing: BrowserCompositeTiming) => void;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException('Browser composite cancelled.', 'AbortError');
  }
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

/**
 * Pull-based audio passthrough that the video loop drains in step with its own
 * timestamps — mediabunny applies cross-track interleaving backpressure, so
 * pumping the whole audio track up front could stall against the video source.
 */
interface AudioPassthrough {
  /** Mux all audio packets with timestamp ≤ upToSeconds. */
  drainUpTo(upToSeconds: number): Promise<void>;
  /** Mux everything that remains, then close the source (end of video loop). */
  drainAll(): Promise<void>;
}

async function setupAudioPassthrough(
  audioTrack: InputAudioTrack | null,
  output: Output,
): Promise<AudioPassthrough | null> {
  if (!audioTrack) return null;
  const codec = await audioTrack.getCodec();
  if (!codec) {
    throw new Error('Base MP4 audio codec unrecognized — cannot passthrough.');
  }
  const decoderConfig = await audioTrack.getDecoderConfig();
  if (!decoderConfig) {
    throw new Error('Base MP4 audio decoder config unavailable — cannot passthrough.');
  }
  const source = new EncodedAudioPacketSource(codec);
  output.addAudioTrack(source);

  const packets = new EncodedPacketSink(audioTrack).packets();
  let pending: EncodedPacket | null = null;
  let first = true;
  let done = false;

  const muxPacket = async (packet: EncodedPacket): Promise<void> => {
    await source.add(packet, first ? { decoderConfig } : undefined);
    first = false;
  };

  const pull = async (): Promise<EncodedPacket | null> => {
    const next = await packets.next();
    if (next.done) {
      done = true;
      return null;
    }
    return next.value;
  };

  return {
    async drainUpTo(upToSeconds: number): Promise<void> {
      while (!done) {
        if (!pending) pending = await pull();
        if (!pending) return;
        if (pending.timestamp > upToSeconds) return;
        const packet = pending;
        pending = null;
        await muxPacket(packet);
      }
    },
    async drainAll(): Promise<void> {
      if (pending) {
        const packet = pending;
        pending = null;
        await muxPacket(packet);
      }
      while (!done) {
        const packet = await pull();
        if (packet) await muxPacket(packet);
      }
      source.close();
    },
  };
}

function createCompositeCanvas(
  width: number,
  height: number,
): { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D } {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Composite canvas 2D context unavailable.');
  return { canvas, ctx };
}

/**
 * Run the full browser composite. Returns the final MP4 Blob (validated), or
 * throws — AbortError for deliberate cancels, plain Error otherwise. Resolves
 * null only when the capability probe rejects the path (caller falls back
 * without treating it as an error, mirroring renderSubtitleOverlayWebCodecs).
 */
export async function renderBrowserComposite(
  options: BrowserCompositeOptions,
): Promise<Blob | null> {
  const startedAt = performance.now();
  throwIfAborted(options.signal);

  const report = (ratio: number, stage: BrowserCompositeStage): void => {
    options.onProgress?.(ratio, stage);
  };
  report(0, BROWSER_COMPOSITE_STAGES.decode);

  if (compositeOutputMayExceedStoreCap(options.durationSeconds)) {
    // R13 — the store would silently drop the artifact after all the work.
    console.warn(
      `${EXTENSION_LOG_PREFIX} Browser composite: estimated output size may exceed the ` +
        `30 MB baked-MP4 store cap (${Math.round(options.durationSeconds)}s clip).`,
    );
  }

  const cues = normalizeOverlaySegments(options.segments, options.durationSeconds);
  if (cues.length === 0) {
    throw new Error('No usable subtitle cues for browser composite.');
  }

  const input = new Input({ source: new BlobSource(options.baseMp4), formats: ALL_FORMATS });
  let output: Output<Mp4OutputFormat, BufferTarget> | null = null;
  let painter: Awaited<ReturnType<typeof createOverlayFramePainter>> | null = null;

  try {
    const support: BrowserCompositeSupport | null = await probeBrowserCompositeSupport(input);
    if (!support) {
      console.warn(
        `${EXTENSION_LOG_PREFIX} Browser composite unavailable — using legacy composite`,
      );
      return null;
    }
    throwIfAborted(options.signal);

    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) throw new Error('Base MP4 video track disappeared between probe and run.');
    const audioTrack = await input.getPrimaryAudioTrack();
    const baseDurationSeconds = await videoTrack.computeDuration();

    painter = await createOverlayFramePainter({
      cues,
      style: options.style,
      globalDurationSeconds: options.durationSeconds,
      width: support.width,
      height: support.height,
      background: 'transparent',
      themeBarColor: options.themeBarColor,
    });

    const { canvas, ctx } = createCompositeCanvas(support.width, support.height);

    let packetsEncoded = 0;
    let framesComposited = 0;
    const totalFrames = support.frameCount;

    const emitLoopProgress = (stage: BrowserCompositeStage): void => {
      const loopRatio = computeBrowserCompositeProgress(
        framesComposited,
        packetsEncoded,
        totalFrames,
      );
      report(SETUP_RATIO_END + loopRatio * (LOOP_RATIO_END - SETUP_RATIO_END), stage);
    };

    output = new Output({
      format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target: new BufferTarget(),
    });
    const videoSource = new CanvasSource(canvas, {
      codec: support.outputCodec,
      bitrate: BROWSER_COMPOSITE_VIDEO_BPS,
      keyFrameInterval: BROWSER_COMPOSITE_KEYFRAME_INTERVAL_SECONDS,
      onEncodedPacket: () => {
        packetsEncoded += 1;
        // Encoder output trails the paint loop; attribute its advances honestly.
        emitLoopProgress(BROWSER_COMPOSITE_STAGES.encode);
      },
    });
    output.addVideoTrack(videoSource, { frameRate: support.averageFps });
    const audio = await setupAudioPassthrough(audioTrack, output);
    await output.start();

    const setupMs = Math.round(performance.now() - startedAt);
    report(SETUP_RATIO_END, BROWSER_COMPOSITE_STAGES.decode);

    // ---- decode → blend → encode loop (the stage that replaces the wall) ----
    const loopStartedAt = performance.now();
    let paintMs = 0;
    let lastFrameEndSeconds = 0;
    const sink = new VideoSampleSink(videoTrack);
    for await (const sample of sink.samples()) {
      try {
        throwIfAborted(options.signal);

        const paintStartedAt = performance.now();
        sample.draw(ctx, 0, 0);
        // THE blend: painter at the frame's exact output PTS, straight-alpha
        // source-over — no premultiply round trip on this path.
        painter.paintFrameAt(sample.timestamp);
        ctx.drawImage(painter.canvas, 0, 0);
        paintMs += performance.now() - paintStartedAt;

        // Awaited add = encoder + muxer backpressure (bounds memory).
        await videoSource.add(sample.timestamp, sample.duration);
        lastFrameEndSeconds = sample.timestamp + sample.duration;
      } finally {
        sample.close();
      }

      framesComposited += 1;
      emitLoopProgress(BROWSER_COMPOSITE_STAGES.paint);
      await audio?.drainUpTo(lastFrameEndSeconds + AUDIO_INTERLEAVE_WINDOW_SECONDS);
      if (framesComposited % YIELD_EVERY_FRAMES === 0) {
        await yieldToEventLoop();
      }
    }
    videoSource.close();
    await audio?.drainAll();
    const loopMs = Math.round(performance.now() - loopStartedAt);

    throwIfAborted(options.signal);
    report(LOOP_RATIO_END, BROWSER_COMPOSITE_STAGES.mux);
    const finalizeStartedAt = performance.now();
    await output.finalize();
    const finalizeMs = Math.round(performance.now() - finalizeStartedAt);

    const failure = validateCompositeOutput({
      framesComposited,
      packetsEncoded,
      expectedFrames: totalFrames,
      baseDurationSeconds,
      outputDurationSeconds: lastFrameEndSeconds,
      fps: support.averageFps,
    });
    if (failure) throw new Error(`Browser composite output rejected: ${failure}`);

    const buffer = output.target.buffer;
    if (!buffer || buffer.byteLength < 256) {
      throw new Error('Browser composite produced an empty MP4 buffer.');
    }

    const totalMs = Math.round(performance.now() - startedAt);
    const timing: BrowserCompositeTiming = {
      outputCodec: support.outputCodec,
      frameCount: framesComposited,
      setupMs,
      loopMs,
      paintMs: Math.round(paintMs),
      finalizeMs,
      totalMs,
      outputBytes: buffer.byteLength,
    };
    options.onTiming?.(timing);
    console.log(
      `${EXTENSION_LOG_PREFIX} Browser composite: ${framesComposited} frames in ${totalMs}ms ` +
        `(loop ${loopMs}ms, paint ${timing.paintMs}ms, finalize ${finalizeMs}ms, ` +
        `${support.outputCodec}, ${Math.round(buffer.byteLength / 1024)} KiB)`,
    );

    report(1, BROWSER_COMPOSITE_STAGES.mux);
    return new Blob([buffer], { type: 'video/mp4' });
  } catch (error: unknown) {
    // Release muxer resources; the Blob was never produced.
    if (output) {
      try {
        await output.cancel();
      } catch {
        // Already finalized or errored — nothing to release.
      }
    }
    throw error;
  } finally {
    painter?.dispose();
    input.dispose();
  }
}
