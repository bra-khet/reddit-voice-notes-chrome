/**
 * v5.3.9 — Parallel chunked overlay render orchestrator.
 *
 * Why concurrency instead of Web Workers: the capture loop is wall-clock paced
 * (MediaRecorder ingests canvas frames in real time), so a serial render takes
 * ≥1× clip duration no matter how fast painting is — and the v5.3.5 cue cache
 * already made painting a bitmap blit. MediaRecorder/captureStream cannot run
 * inside a worker, and VP8 encoding happens on Chrome's media threads, not JS.
 * Running N paced capture loops concurrently on the Studio page multiplexes the
 * idle wait time for a ~N× render-stage speedup with zero cross-context plumbing.
 *
 * Pipeline: plan chunks (cue-gap boundaries, frame-aligned) → N staggered
 * concurrent captures → cheap FFmpeg stitch (stream-copy concat demuxer,
 * fallback to decode+re-encode only on failure) → existing normalize +
 * composite steps, unchanged and ALWAYS run (see v5.3.9.1 note below).
 *
 * v5.3.9.1 PERF FIX (2026-07-04): the concat step used to do a full
 * decode+re-encode of the whole clip and its output was treated as already
 * composite-ready, skipping normalizeOverlayWebmForComposite. Real QA timing
 * showed that re-encode cost 70-150s on 60s clips — worse than the entire
 * render-phase saving, and it made the parallel path slower end-to-end than
 * serial. Concat is now a cheap stream-copy stitch ONLY; normalize always
 * runs afterward, identically for both paths (see subtitle-canvas-bake.ts).
 *
 * Failure policy: user cancel / perf-guard abort rethrow; any other chunk or
 * concat failure falls back to the untouched serial render path.
 *
 * Sync: overlay-chunk-planner.ts (plan math), subtitle-overlay-renderer.ts
 *       captureOverlayChunkRaw/timeRange, overlay-chunk-concat.ts (stitch),
 *       subtitle-canvas-bake.ts (consumer — always normalizes after concat)
 */

import { concatOverlayChunksForComposite } from '@/src/ffmpeg/overlay-chunk-concat';
import {
  isCanvasRenderPerfExceeded,
  linkAbortSignals,
  throwIfRenderAborted,
} from '@/src/transcription/canvas-render-perf-guard';
import {
  aggregateChunkProgress,
  mergeCueCacheStats,
  PARALLEL_OVERLAY_MIN_CLIP_SECONDS,
  PARALLEL_OVERLAY_STAGGER_MS,
  parallelCueCacheMaxEntries,
  planOverlayChunks,
  resolveParallelChunkCount,
  type PlannedOverlayChunk,
} from '@/src/transcription/overlay-chunk-planner';
import {
  captureOverlayChunkRaw,
  normalizeOverlaySegments,
  renderSubtitleOverlay,
  type SubtitleOverlayRenderMetrics,
  type SubtitleOverlayRenderOptions,
  type SubtitleOverlayResult,
} from '@/src/transcription/subtitle-overlay-renderer';
import type { SubtitleStyleConfig, TranscriptSegment } from '@/src/transcription/types';
import { EXTENSION_LOG_PREFIX } from '@/src/utils/constants';

export interface ParallelOverlayRenderOptions extends SubtitleOverlayRenderOptions {
  /**
   * 'auto' (default): parallel when the clip/hardware qualify.
   * 'force': skip the min-clip-length + memory gates (Overlay Lab A/B) — the
   * planner's minimum-chunk floor still applies, so tiny clips stay serial.
   */
  parallel?: 'auto' | 'force';
  /** Cap concurrent chunk captures (default heuristic in overlay-chunk-planner). */
  maxChunks?: number;
}

export interface ParallelOverlayRenderHooks {
  /** Concat stage bracket — fires around the (now cheap) stitch call. */
  onConcatPhase?: (phase: 'start' | 'done') => void;
  /** Fired once when the plan is fixed (diagnostics / timing logs). */
  onPlan?: (plan: PlannedOverlayChunk[]) => void;
}

/**
 * Progress-report stage label for the concat/stitch bracket — distinct from
 * the real normalize stage so Overlay Lab timing JSON can tell them apart.
 * (v5.3.9.1: before this fix both used the same label, which is exactly how
 * the 70-150s regression hid inside "normalizeMs" in bake timing summaries.)
 */
export const OVERLAY_CONCAT_STAGE = 'canvas-overlay-concat-stitch';

export interface ParallelOverlayRenderResult extends SubtitleOverlayResult {
  wasParallel: boolean;
  chunkCount: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function readEnvironmentConcurrency(): { hardwareConcurrency?: number; deviceMemoryGb?: number } {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  return {
    hardwareConcurrency: nav?.hardwareConcurrency,
    deviceMemoryGb: (nav as { deviceMemory?: number } | undefined)?.deviceMemory,
  };
}

/** Rethrow-worthy: user cancel or perf-guard budget — never serial-fallback these. */
function isDeliberateAbort(error: unknown, userSignal: AbortSignal | undefined): boolean {
  if (isCanvasRenderPerfExceeded(error)) return true;
  if (userSignal?.aborted) return true;
  return error instanceof DOMException && error.name === 'AbortError';
}

async function runSerial(
  segments: TranscriptSegment[],
  style: SubtitleStyleConfig,
  durationSeconds: number,
  options: SubtitleOverlayRenderOptions,
): Promise<ParallelOverlayRenderResult> {
  const result = await renderSubtitleOverlay(segments, style, durationSeconds, options);
  return { ...result, wasParallel: false, chunkCount: 1 };
}

/**
 * Main v5.3.9 entry point. Renders the overlay in parallel chunks when eligible,
 * otherwise (or on non-abort failure) via the untouched serial path.
 */
export async function renderSubtitleOverlayParallel(
  segments: TranscriptSegment[],
  style: SubtitleStyleConfig,
  durationSeconds: number,
  options: ParallelOverlayRenderOptions,
  hooks?: ParallelOverlayRenderHooks,
): Promise<ParallelOverlayRenderResult> {
  const { parallel: parallelMode, maxChunks, timeRange: _ignored, ...baseOptions } = options;
  const fps = Math.max(1, options.fps);
  const duration = Math.max(0.5, durationSeconds);

  // Single-frame debug is a stepping tool — chunk interleaving would garble it.
  if (options.singleFrameDebug === true) {
    return runSerial(segments, style, durationSeconds, baseOptions);
  }

  const env = readEnvironmentConcurrency();
  const force = parallelMode === 'force';
  const chunkTarget = resolveParallelChunkCount({
    durationSeconds: force ? Math.max(duration, PARALLEL_OVERLAY_MIN_CLIP_SECONDS) : duration,
    hardwareConcurrency: env.hardwareConcurrency,
    deviceMemoryGb: force ? undefined : env.deviceMemoryGb,
    maxChunks,
  });
  if (chunkTarget < 2) {
    return runSerial(segments, style, durationSeconds, baseOptions);
  }

  const cues = normalizeOverlaySegments(segments, duration);
  if (cues.length === 0) {
    throw new Error('No usable subtitle cues to render in canvas overlay.');
  }

  const plan = planOverlayChunks({
    cues,
    durationSeconds: duration,
    fps,
    targetChunkCount: chunkTarget,
  });
  if (plan.length < 2) {
    return runSerial(segments, style, durationSeconds, baseOptions);
  }
  hooks?.onPlan?.(plan);

  const totalFrames = plan.reduce((sum, chunk) => sum + chunk.frameCount, 0);
  const cacheBudget = parallelCueCacheMaxEntries(plan.length);
  const framesDone = plan.map(() => 0);
  let lastEmittedFrames = 0;
  const chunkStats: SubtitleOverlayRenderMetrics[] = [];

  const linked = linkAbortSignals(options.signal);
  const captureStartedAt = performance.now();

  const runChunk = async (chunk: PlannedOverlayChunk): Promise<Blob> => {
    // Stagger starts so cold-cache paint misses don't pile into one frame tick.
    if (chunk.index > 0) {
      await sleep(chunk.index * PARALLEL_OVERLAY_STAGGER_MS);
    }
    throwIfRenderAborted(linked.signal);

    const { overlayBlob, renderMetrics } = await captureOverlayChunkRaw({
      cues,
      style,
      globalDurationSeconds: duration,
      options: {
        ...baseOptions,
        fps,
        signal: linked.signal,
        timeRange: { startFrame: chunk.startFrame, frameCount: chunk.frameCount },
        cueCacheMaxEntries: cacheBudget,
        finalizeWebm: false,
        onRenderProgress: ({ frameIndex }) => {
          framesDone[chunk.index] = frameIndex;
          const aggregate = aggregateChunkProgress(framesDone, totalFrames);
          // Emit at ~serial cadence (one event per global frame-count step).
          if (aggregate.frameIndex - lastEmittedFrames >= plan.length) {
            lastEmittedFrames = aggregate.frameIndex;
            baseOptions.onRenderProgress?.(aggregate);
          }
        },
        debug: undefined,
      },
    });
    chunkStats.push(renderMetrics);
    return overlayBlob;
  };

  const settled = await Promise.allSettled(
    plan.map((chunk) =>
      runChunk(chunk).catch((error: unknown) => {
        // First failure aborts siblings so they stop their recorders promptly.
        linked.abort(error);
        throw error;
      }),
    ),
  );

  const failures = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected');
  if (failures.length > 0) {
    const error = failures[0].reason as unknown;
    if (isDeliberateAbort(error, options.signal)) {
      throw error;
    }
    console.warn(
      `${EXTENSION_LOG_PREFIX} Parallel overlay chunk capture failed — falling back to serial render`,
      error,
    );
    return runSerial(segments, style, durationSeconds, baseOptions);
  }

  const chunkBlobs = settled.map((s) => (s as PromiseFulfilledResult<Blob>).value);
  baseOptions.onRenderProgress?.(aggregateChunkProgress(plan.map((c) => c.frameCount), totalFrames));
  const captureWallMs = Math.round(performance.now() - captureStartedAt);

  let overlayBlob: Blob;
  hooks?.onConcatPhase?.('start');
  try {
    overlayBlob = await concatOverlayChunksForComposite({
      chunkBlobs,
      chunkDurationsSeconds: plan.map((chunk) => chunk.durationSeconds),
      fps,
    });
  } catch (error: unknown) {
    hooks?.onConcatPhase?.('done');
    if (isDeliberateAbort(error, options.signal)) throw error;
    console.warn(
      `${EXTENSION_LOG_PREFIX} Parallel overlay concat failed — falling back to serial render`,
      error,
    );
    return runSerial(segments, style, durationSeconds, baseOptions);
  }
  hooks?.onConcatPhase?.('done');

  const renderMetrics: SubtitleOverlayRenderMetrics = {
    totalFrames,
    fps,
    // Capture-stage wall time (first chunk start → last chunk end); the whole
    // point of v5.3.9 is realtimeFactor dropping ~1.1 → ~1/chunkCount here.
    renderWallMs: captureWallMs,
    msPerFrame: totalFrames > 0 ? captureWallMs / totalFrames : 0,
    realtimeFactor: duration > 0 ? captureWallMs / (duration * 1000) : 0,
    cueCache: mergeCueCacheStats(chunkStats.map((stats) => stats.cueCache)),
  };

  console.log(
    `${EXTENSION_LOG_PREFIX} Parallel overlay render: ${plan.length} chunks, ` +
      `${captureWallMs}ms capture (${renderMetrics.realtimeFactor.toFixed(2)}× realtime)`,
  );

  return {
    overlayBlob,
    durationSeconds: duration,
    fps,
    renderMetrics,
    wasParallel: true,
    chunkCount: plan.length,
  };
}
