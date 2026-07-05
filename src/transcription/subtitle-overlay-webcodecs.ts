/**
 * v5.3.10 — WebCodecs chunked overlay render orchestrator.
 *
 * The v5.3.9 orchestrator multiplexes N wall-clock-paced MediaRecorder
 * captures; this one drives N per-chunk VideoEncoder loops that run as fast
 * as paint + encode allow — the render stage stops being pacing-bound
 * entirely. It reuses the SAME chunk planner (cue-gap boundaries, frame-exact
 * partition) and the same global-frame paint expression, so every v5.3.9 seam
 * invariant carries over unchanged; the stitch step is a pure-TypeScript IVF
 * concatenation (integer global PTS by construction) instead of an FFmpeg
 * exec.
 *
 * OUTPUT SHAPE: dual color+alpha IVF streams plus per-segment metadata — NOT
 * a WebM blob. The composite consumes the streams directly via the alphamerge
 * tier family (no normalizeOverlayWebmForComposite pass: its two repair jobs,
 * CFR enforcement and explicit alpha, are guaranteed by construction here).
 * See docs/5.3.10-webcodecs-per-chunk-encoding.md §0 for why this is not the
 * v5.3.9.1 compositeReady mistake.
 *
 * FAILURE POLICY: deliberate aborts (user cancel, perf-guard) rethrow; every
 * other failure — unsupported WebCodecs, probe failure, encoder error, stitch
 * validation error — resolves null and the caller runs the untouched
 * MediaRecorder pipeline. This path never produces a "maybe broken" result.
 *
 * Sync: overlay-chunk-planner.ts (plan math), subtitle-overlay-renderer.ts
 *       createOverlayFramePainter (paint seam), overlay-webcodecs-encoder.ts
 *       (per-chunk encode), src/encoding/ivf.ts (stitch),
 *       subtitle-canvas-bake.ts (consumer + fallback owner)
 */

import {
  isCanvasRenderPerfExceeded,
  linkAbortSignals,
  throwIfRenderAborted,
} from '@/src/transcription/canvas-render-perf-guard';
import {
  aggregateChunkProgress,
  mergeCueCacheStats,
  PARALLEL_OVERLAY_MIN_CLIP_SECONDS,
  parallelCueCacheMaxEntries,
  planOverlayChunks,
  resolveParallelChunkCount,
  type PlannedOverlayChunk,
} from '@/src/transcription/overlay-chunk-planner';
import {
  createOverlayFramePainter,
  normalizeOverlaySegments,
  type SubtitleOverlayRenderMetrics,
} from '@/src/transcription/subtitle-overlay-renderer';
import type { ParallelOverlayRenderOptions } from '@/src/transcription/subtitle-overlay-parallel';
import type { SubtitleStyleConfig, TranscriptSegment } from '@/src/transcription/types';
import {
  summarizeEncodedSegments,
  type EncodedOverlaySegmentMeta,
} from '@/src/encoding/encoded-segment';
import { concatIvfSegments } from '@/src/encoding/ivf';
import {
  encodeOverlayChunkWithWebCodecs,
  type EncodedOverlayChunkResult,
} from '@/src/encoding/overlay-webcodecs-encoder';
import {
  probeOverlayWebCodecsSupport,
  type AlphaLumaCalibration,
} from '@/src/encoding/webcodecs-support';
import { EXTENSION_LOG_PREFIX } from '@/src/utils/constants';

/**
 * Progress-report stage label for the (pure-TS, ms-scale) IVF stitch — its own
 * label per the v5.3.9.1 rule: distinct work never shares a stage string, so
 * timing logs can always attribute cost to the operation that incurred it.
 */
export const WEBCODECS_STITCH_STAGE = 'webcodecs-overlay-stitch';

export interface WebCodecsOverlayRenderHooks {
  /** Fired once when the plan is fixed (diagnostics / timing logs). */
  onPlan?: (plan: PlannedOverlayChunk[]) => void;
  /** Fired per finished segment (timing logs). */
  onSegmentEncoded?: (meta: EncodedOverlaySegmentMeta) => void;
}

export interface WebCodecsOverlayRenderResult {
  kind: 'webcodecs-dual-ivf';
  colorIvf: Uint8Array;
  alphaIvf: Uint8Array;
  calibration: AlphaLumaCalibration;
  codec: string;
  durationSeconds: number;
  fps: number;
  chunkCount: number;
  segments: EncodedOverlaySegmentMeta[];
  /** Pure-TS IVF stitch wall time — expected single-digit milliseconds. */
  stitchMs: number;
  renderMetrics: SubtitleOverlayRenderMetrics;
}

/** Rethrow-worthy: user cancel or perf-guard budget — never fallback these. */
function isDeliberateAbort(error: unknown, userSignal: AbortSignal | undefined): boolean {
  if (isCanvasRenderPerfExceeded(error)) return true;
  if (userSignal?.aborted) return true;
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * Render the overlay via chunked WebCodecs encoding. Resolves null whenever
 * this path cannot proceed safely — the caller must then run the
 * MediaRecorder pipeline (renderSubtitleOverlayParallel / renderSubtitleOverlay).
 */
export async function renderSubtitleOverlayWebCodecs(
  segments: TranscriptSegment[],
  style: SubtitleStyleConfig,
  durationSeconds: number,
  options: ParallelOverlayRenderOptions,
  hooks?: WebCodecsOverlayRenderHooks,
): Promise<WebCodecsOverlayRenderResult | null> {
  // Single-frame debug is a MediaRecorder-path stepping tool.
  if (options.singleFrameDebug === true) return null;

  const fps = Math.max(1, options.fps);
  const duration = Math.max(0.5, durationSeconds);

  const support = await probeOverlayWebCodecsSupport({
    width: options.width,
    height: options.height,
    fps,
  });
  if (!support) {
    console.warn(
      `${EXTENSION_LOG_PREFIX} WebCodecs overlay path unavailable — using MediaRecorder pipeline`,
    );
    return null;
  }

  const cues = normalizeOverlaySegments(segments, duration);
  if (cues.length === 0) {
    throw new Error('No usable subtitle cues to render in canvas overlay.');
  }

  // Unlike the MediaRecorder path there is no "stay serial" gate: encoding is
  // compute-bound, so even a single-chunk clip goes through this path — the
  // planner's chunk count only decides how much encoder-thread parallelism we
  // get. 'force' skips the memory gate exactly like the parallel orchestrator.
  const force = options.parallel === 'force';
  const env = typeof navigator !== 'undefined' ? navigator : undefined;
  const chunkTarget = Math.max(
    1,
    resolveParallelChunkCount({
      durationSeconds: force ? Math.max(duration, PARALLEL_OVERLAY_MIN_CLIP_SECONDS) : duration,
      hardwareConcurrency: env?.hardwareConcurrency,
      deviceMemoryGb: force
        ? undefined
        : (env as { deviceMemory?: number } | undefined)?.deviceMemory,
      maxChunks: options.maxChunks,
    }),
  );

  const plan = planOverlayChunks({
    cues,
    durationSeconds: duration,
    fps,
    targetChunkCount: chunkTarget,
  });
  hooks?.onPlan?.(plan);

  const totalFrames = plan.reduce((sum, chunk) => sum + chunk.frameCount, 0);
  const cacheBudget = parallelCueCacheMaxEntries(plan.length);
  const framesDone = plan.map(() => 0);
  let lastEmittedFrames = 0;

  const linked = linkAbortSignals(options.signal);
  const renderStartedAt = performance.now();

  const runChunk = async (chunk: PlannedOverlayChunk): Promise<EncodedOverlayChunkResult> => {
    throwIfRenderAborted(linked.signal);
    const painter = await createOverlayFramePainter({
      cues,
      style,
      globalDurationSeconds: duration,
      width: options.width,
      height: options.height,
      background: options.background,
      themeBarColor: options.themeBarColor,
      enableCueCache: options.enableCueCache,
      cueCacheMaxEntries: cacheBudget,
    });
    try {
      const result = await encodeOverlayChunkWithWebCodecs({
        painter,
        chunk,
        fps,
        cues,
        support,
        signal: linked.signal,
        onFrameDone: (done) => {
          framesDone[chunk.index] = done;
          const aggregate = aggregateChunkProgress(framesDone, totalFrames);
          // Emit at ~serial cadence (one event per global frame-count step).
          if (aggregate.frameIndex - lastEmittedFrames >= plan.length) {
            lastEmittedFrames = aggregate.frameIndex;
            options.onRenderProgress?.(aggregate);
          }
        },
      });
      hooks?.onSegmentEncoded?.(result.meta);
      return result;
    } finally {
      painter.dispose();
    }
  };

  let results: EncodedOverlayChunkResult[];
  try {
    const settled = await Promise.allSettled(
      plan.map((chunk) =>
        runChunk(chunk).catch((error: unknown) => {
          // First failure aborts siblings so they stop encoding promptly.
          linked.abort(error);
          throw error;
        }),
      ),
    );
    const failures = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected');
    if (failures.length > 0) throw failures[0].reason;
    results = settled.map((s) => (s as PromiseFulfilledResult<EncodedOverlayChunkResult>).value);
  } catch (error: unknown) {
    if (isDeliberateAbort(error, options.signal)) throw error;
    console.warn(
      `${EXTENSION_LOG_PREFIX} WebCodecs overlay encode failed — using MediaRecorder pipeline`,
      error,
    );
    return null;
  }

  options.onRenderProgress?.(aggregateChunkProgress(plan.map((c) => c.frameCount), totalFrames));
  const renderWallMs = Math.round(performance.now() - renderStartedAt);

  let colorIvf: Uint8Array;
  let alphaIvf: Uint8Array;
  const stitchStartedAt = performance.now();
  try {
    colorIvf = concatIvfSegments(results.map((r) => r.colorIvf));
    alphaIvf = concatIvfSegments(results.map((r) => r.alphaIvf));
  } catch (error: unknown) {
    console.warn(
      `${EXTENSION_LOG_PREFIX} WebCodecs IVF stitch failed — using MediaRecorder pipeline`,
      error,
    );
    return null;
  }
  const stitchMs = Math.round(performance.now() - stitchStartedAt);

  const segmentMetas = results.map((r) => r.meta);
  const summary = summarizeEncodedSegments(segmentMetas);
  const renderMetrics: SubtitleOverlayRenderMetrics = {
    totalFrames,
    fps,
    renderWallMs,
    msPerFrame: totalFrames > 0 ? renderWallMs / totalFrames : 0,
    realtimeFactor: duration > 0 ? renderWallMs / (duration * 1000) : 0,
    cueCache: mergeCueCacheStats(results.map((r) => r.cueCache)),
    encoderType: 'webcodecs',
    encodeSegments: segmentMetas,
  };

  console.log(
    `${EXTENSION_LOG_PREFIX} WebCodecs overlay render: ${plan.length} segments, ` +
      `${renderWallMs}ms (${renderMetrics.realtimeFactor.toFixed(2)}× realtime, ` +
      `codec ${support.candidate.codec}, stitch ${stitchMs}ms, ` +
      `${Math.round((summary.totalColorBytes + summary.totalAlphaBytes) / 1024)} KiB)`,
  );

  return {
    kind: 'webcodecs-dual-ivf',
    colorIvf,
    alphaIvf,
    calibration: support.calibration,
    codec: support.candidate.codec,
    durationSeconds: duration,
    fps,
    chunkCount: plan.length,
    segments: segmentMetas,
    stitchMs,
    renderMetrics,
  };
}
