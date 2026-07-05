import { runSubtitleBurnIn } from '@/src/ffmpeg/ffmpeg-runner';
import { normalizeOverlayWebmForComposite } from '@/src/ffmpeg/overlay-webm-finalize';
import { withTranscodeLock } from '@/src/ffmpeg/transcode-lock';
import { loadLastBaseMp4 } from '@/src/storage/last-base-mp4-db';
import {
  OVERLAY_CONCAT_STAGE,
  renderSubtitleOverlayParallel,
} from '@/src/transcription/subtitle-overlay-parallel';
import {
  renderSubtitleOverlay,
  type SubtitleOverlayRenderMetrics,
} from '@/src/transcription/subtitle-overlay-renderer';
import { prepareSegmentsForSubtitleBake } from '@/src/transcription/transcript-editing';
import type { SubtitleStyleConfig, TranscriptResult } from '@/src/transcription/types';
import { computeCreepRatio } from '@/src/ui/design-studio/bake-chronos';
import {
  CanvasRenderPerfExceededError,
  linkAbortSignals,
} from '@/src/transcription/canvas-render-perf-guard';
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '@/src/utils/constants';

const NORMALIZE_RATIO_START = 0.32;
const NORMALIZE_RATIO_END = 0.44;
const COMPOSITE_RATIO_START = 0.45;

function normalizeCreepExpectedMs(durationSeconds: number): number {
  return Math.min(20_000, Math.max(4_000, durationSeconds * 350));
}

/**
 * Manual start/stop creep over the normalize progress band. v5.3.9: the parallel
 * path's concat stage fires from inside the orchestrator via onConcatPhase, so
 * the creep needs bracket controls rather than a work-wrapping closure.
 */
function startNormalizeProgressCreep(
  report: (ratio: number, stage: string) => void,
  durationSeconds: number,
): () => void {
  const stage = 'canvas-overlay-alpha-normalize';
  const expectedMs = normalizeCreepExpectedMs(durationSeconds);
  const t0 = performance.now();
  report(NORMALIZE_RATIO_START, stage);

  const timer = window.setInterval(() => {
    const elapsed = performance.now() - t0;
    report(
      computeCreepRatio(NORMALIZE_RATIO_START, NORMALIZE_RATIO_END, elapsed, expectedMs),
      stage,
    );
  }, 200);

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    window.clearInterval(timer);
    report(NORMALIZE_RATIO_END, stage);
  };
}

async function withNormalizeProgressCreep<T>(
  work: () => Promise<T>,
  report: (ratio: number, stage: string) => void,
  durationSeconds: number,
): Promise<T> {
  const stop = startNormalizeProgressCreep(report, durationSeconds);
  try {
    return await work();
  } finally {
    stop();
  }
}

export interface CanvasOverlayBakeOptions {
  editedResult: TranscriptResult;
  style: SubtitleStyleConfig;
  durationSeconds: number;
  themeBarColor?: string;
  /** When provided, skips a second loadLastBaseMp4() (production bake path). */
  baseMp4?: Blob;
  onProgress?: (ratio: number, stage: string) => void;
  signal?: AbortSignal;
  /**
   * Production perf guard (Phase 5.3) — abort offline render and throw
   * CanvasRenderPerfExceededError when exceeded. Omit for dev harness (force canvas).
   */
  renderPerfBudgetMs?: number;
  /** v5.3.5 — capture canvas render metrics for Overlay Lab timing JSON. */
  onRenderMetrics?: (metrics: SubtitleOverlayRenderMetrics) => void;
  /**
   * v5.3.9 — allow the parallel chunked render (prefs experimental.parallelBake).
   * Default true; the orchestrator still auto-falls back to serial for short
   * clips, low-core/low-memory devices, or any chunk/concat failure.
   */
  parallelBake?: boolean;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException('Subtitle burn-in cancelled.', 'AbortError');
  }
}

/**
 * Dev / content-script path — render canvas overlay, then composite via FFmpeg (v5.3.4 Phase 4).
 * Must run in Design Studio (needs document + MediaRecorder); overlay bytes are passed to burn-in.
 */
export async function bakeWithCanvasOverlay(options: CanvasOverlayBakeOptions): Promise<Blob> {
  throwIfAborted(options.signal);

  const segments = prepareSegmentsForSubtitleBake(
    options.editedResult.segments,
    options.durationSeconds,
  );
  if (segments.length === 0) {
    throw new Error('No usable subtitle cues for canvas overlay bake.');
  }

  let baseBlob = options.baseMp4;
  let durationFromMeta: number | undefined;
  if (!baseBlob) {
    const base = await loadLastBaseMp4();
    if (!base?.blob) {
      throw new Error('No base MP4 found — record a clip on Reddit first.');
    }
    baseBlob = base.blob;
    durationFromMeta = base.meta.durationSeconds;
  }

  const report = (ratio: number, stage: string): void => {
    options.onProgress?.(ratio, stage);
  };

  const RENDER_RATIO_START = 0.05;
  const RENDER_RATIO_END = 0.32;

  report(RENDER_RATIO_START, 'canvas-overlay-render');
  throwIfAborted(options.signal);

  const renderAbort = linkAbortSignals(options.signal);
  const renderStartedAt = performance.now();
  let renderPerfTimer: ReturnType<typeof window.setTimeout> | undefined;
  if (options.renderPerfBudgetMs != null && options.renderPerfBudgetMs > 0) {
    renderPerfTimer = window.setTimeout(() => {
      renderAbort.abort(
        new CanvasRenderPerfExceededError(
          options.renderPerfBudgetMs!,
          Math.round(performance.now() - renderStartedAt),
        ),
      );
    }, options.renderPerfBudgetMs);
  }

  const renderOptions = {
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    fps: 30,
    background: 'transparent' as const,
    offline: true,
    themeBarColor: options.themeBarColor,
    signal: renderAbort.signal,
    onRenderProgress: ({ ratio }: { ratio: number }) => {
      report(
        RENDER_RATIO_START + ratio * (RENDER_RATIO_END - RENDER_RATIO_START),
        'canvas-overlay-render',
      );
    },
  };

  // CHANGED: v5.3.9.1 — parallel chunked render when allowed. Concat is now a
  //          cheap stitch-only step (stream-copy demuxer); normalize ALWAYS
  //          runs afterward for both paths, exactly like the serial pipeline
  //          always did. Skipping normalize for "compositeReady" concat output
  //          was the root cause of a 70-150s regression (see design doc §0.5) —
  //          that re-encode-to-skip-normalize trick is gone.
  // WHY: capture is real-time paced; N concurrent chunks cut the render stage ~N×.
  let overlayResult;
  try {
    overlayResult = options.parallelBake !== false
      ? await renderSubtitleOverlayParallel(
          segments,
          options.style,
          options.durationSeconds,
          renderOptions,
          {
            // Concat is now sub-second — two discrete ticks, no creep timer;
            // both 'start' and 'done' report the same ratio (start/end of a
            // near-instant stitch, distinct from normalize's own stage below).
            onConcatPhase: () => report(NORMALIZE_RATIO_START, OVERLAY_CONCAT_STAGE),
          },
        )
      : {
          ...(await renderSubtitleOverlay(
            segments,
            options.style,
            options.durationSeconds,
            renderOptions,
          )),
          wasParallel: false,
          chunkCount: 1,
        };
  } finally {
    if (renderPerfTimer != null) {
      window.clearTimeout(renderPerfTimer);
    }
  }

  if (overlayResult.renderMetrics) {
    options.onRenderMetrics?.(overlayResult.renderMetrics);
  }

  throwIfAborted(options.signal);
  // Always normalize — concat's job is stitching only, never encoding.
  const compositeOverlay = await withNormalizeProgressCreep(
    () => normalizeOverlayWebmForComposite(overlayResult.overlayBlob, overlayResult.fps),
    report,
    options.durationSeconds,
  );
  report(0.445, 'canvas-overlay-buffer');
  const overlayBytes = new Uint8Array(await compositeOverlay.arrayBuffer());
  const baseBytes = new Uint8Array(await baseBlob.arrayBuffer());

  report(COMPOSITE_RATIO_START, 'canvas-overlay-composite');
  throwIfAborted(options.signal);
  const burnedBytes = await withTranscodeLock(async () =>
    runSubtitleBurnIn(
      baseBytes,
      {
        segments,
        style: options.style,
        videoDurationSeconds: options.durationSeconds ?? durationFromMeta,
        themeBarColor: options.themeBarColor,
        useCanvasOverlay: true,
        canvasOverlayBytes: overlayBytes,
      },
      (ratio, stage) => {
        report(COMPOSITE_RATIO_START + ratio * (1 - COMPOSITE_RATIO_START), stage);
      },
    ),
  );

  report(1, 'canvas-overlay-done');
  return new Blob([burnedBytes.slice()], { type: 'video/mp4' });
}