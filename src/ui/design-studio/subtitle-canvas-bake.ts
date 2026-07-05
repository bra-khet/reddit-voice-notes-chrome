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
  isCanvasRenderPerfExceeded,
  linkAbortSignals,
} from '@/src/transcription/canvas-render-perf-guard';
import {
  renderSubtitleOverlayWebCodecs,
  WEBCODECS_STITCH_STAGE,
} from '@/src/transcription/subtitle-overlay-webcodecs';
import { CANVAS_HEIGHT, CANVAS_WIDTH, EXTENSION_LOG_PREFIX } from '@/src/utils/constants';

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
  /**
   * v5.3.10 — capture/encode strategy (prefs experimental.webCodecsBake).
   * 'auto': WebCodecs when the probe passes, MediaRecorder otherwise.
   * 'webcodecs': WebCodecs with the chunk-count memory gate skipped (Lab A/B)
   *   — still falls back to MediaRecorder if the probe or encode fails.
   * 'mediarecorder' (DEFAULT when omitted): the proven v5.3.9 pipeline.
   * Every call site must pass this explicitly (v5.3.9.1 lesson: a silent
   * default at one Lab call site made A/B toggle QA runs meaningless).
   */
  encoder?: OverlayBakeEncoderPreference;
}

export type OverlayBakeEncoderPreference = 'auto' | 'webcodecs' | 'mediarecorder';

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException('Subtitle burn-in cancelled.', 'AbortError');
  }
}

/** Rethrow-worthy at the bake layer: user cancel / perf budget — never retried. */
function isDeliberateBakeAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  if (isCanvasRenderPerfExceeded(error)) return true;
  if (signal?.aborted) return true;
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * Arm the render perf-guard budget around one render attempt. Extracted
 * (v5.3.10) so the WebCodecs attempt and the MediaRecorder retry each get a
 * fresh budget window instead of sharing one timer across both.
 */
async function withRenderPerfGuard<T>(
  budgetMs: number | undefined,
  userSignal: AbortSignal | undefined,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const renderAbort = linkAbortSignals(userSignal);
  const startedAt = performance.now();
  let timer: ReturnType<typeof window.setTimeout> | undefined;
  if (budgetMs != null && budgetMs > 0) {
    timer = window.setTimeout(() => {
      renderAbort.abort(
        new CanvasRenderPerfExceededError(
          budgetMs,
          Math.round(performance.now() - startedAt),
        ),
      );
    }, budgetMs);
  }
  try {
    return await work(renderAbort.signal);
  } finally {
    if (timer != null) window.clearTimeout(timer);
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

  const makeRenderOptions = (signal: AbortSignal) => ({
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    fps: 30,
    background: 'transparent' as const,
    offline: true,
    themeBarColor: options.themeBarColor,
    signal,
    onRenderProgress: ({ ratio }: { ratio: number }) => {
      report(
        RENDER_RATIO_START + ratio * (RENDER_RATIO_END - RENDER_RATIO_START),
        'canvas-overlay-render',
      );
    },
  });

  const runComposite = async (burnIn: Parameters<typeof runSubtitleBurnIn>[1]): Promise<Blob> => {
    const baseBytes = new Uint8Array(await baseBlob.arrayBuffer());
    report(COMPOSITE_RATIO_START, 'canvas-overlay-composite');
    throwIfAborted(options.signal);
    const burnedBytes = await withTranscodeLock(async () =>
      runSubtitleBurnIn(baseBytes, burnIn, (ratio, stage) => {
        report(COMPOSITE_RATIO_START + ratio * (1 - COMPOSITE_RATIO_START), stage);
      }),
    );
    report(1, 'canvas-overlay-done');
    return new Blob([burnedBytes.slice()], { type: 'video/mp4' });
  };

  // ---- v5.3.10 WebCodecs path -------------------------------------------
  // Dual color+alpha IVF streams, composite-ready by construction: no
  // normalize pass exists here — its two repair jobs (CFR enforcement,
  // explicit alpha plane) can't be needed for constructed streams, and the
  // alphamerge composite builds the alpha overlay inside the graph itself.
  // Any non-abort failure (probe, encode, stitch, composite) retries the
  // whole bake through the proven MediaRecorder pipeline below.
  const encoderPreference = options.encoder ?? 'mediarecorder';
  if (encoderPreference !== 'mediarecorder') {
    report(RENDER_RATIO_START, 'canvas-overlay-render');
    throwIfAborted(options.signal);
    try {
      const webCodecsResult = await withRenderPerfGuard(
        options.renderPerfBudgetMs,
        options.signal,
        (signal) =>
          renderSubtitleOverlayWebCodecs(segments, options.style, options.durationSeconds, {
            ...makeRenderOptions(signal),
            parallel: encoderPreference === 'webcodecs' ? 'force' : 'auto',
          }),
      );
      if (webCodecsResult) {
        options.onRenderMetrics?.(webCodecsResult.renderMetrics);
        throwIfAborted(options.signal);
        // Stitch already happened (pure-TS, ms-scale) — single marker tick on
        // its own stage label so timing logs can attribute it (v5.3.9.1 rule:
        // distinct work gets distinct stage strings).
        report(NORMALIZE_RATIO_END, WEBCODECS_STITCH_STAGE);
        report(0.445, 'canvas-overlay-buffer');
        return await runComposite({
          segments,
          style: options.style,
          videoDurationSeconds: options.durationSeconds ?? durationFromMeta,
          themeBarColor: options.themeBarColor,
          overlayColorIvfBytes: webCodecsResult.colorIvf,
          overlayAlphaIvfBytes: webCodecsResult.alphaIvf,
          overlayAlphaLimitedRange: webCodecsResult.calibration.limitedRange,
        });
      }
      // null → WebCodecs unavailable on this machine; MediaRecorder path below.
    } catch (error: unknown) {
      if (isDeliberateBakeAbort(error, options.signal)) throw error;
      console.warn(
        `${EXTENSION_LOG_PREFIX} WebCodecs bake path failed — retrying via MediaRecorder pipeline`,
        error,
      );
    }
  }

  // ---- MediaRecorder path (the proven v5.3.9 pipeline, unchanged) --------
  report(RENDER_RATIO_START, 'canvas-overlay-render');
  throwIfAborted(options.signal);

  // CHANGED: v5.3.9.1 — parallel chunked render when allowed. Concat is now a
  //          cheap stitch-only step (stream-copy demuxer); normalize ALWAYS
  //          runs afterward for both paths, exactly like the serial pipeline
  //          always did. Skipping normalize for "compositeReady" concat output
  //          was the root cause of a 70-150s regression (see design doc §0.5) —
  //          that re-encode-to-skip-normalize trick is gone.
  // WHY: capture is real-time paced; N concurrent chunks cut the render stage ~N×.
  const overlayResult = await withRenderPerfGuard(
    options.renderPerfBudgetMs,
    options.signal,
    async (signal) => {
      const renderOptions = makeRenderOptions(signal);
      return options.parallelBake !== false
        ? renderSubtitleOverlayParallel(
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
    },
  );

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

  return runComposite({
    segments,
    style: options.style,
    videoDurationSeconds: options.durationSeconds ?? durationFromMeta,
    themeBarColor: options.themeBarColor,
    useCanvasOverlay: true,
    canvasOverlayBytes: overlayBytes,
  });
}