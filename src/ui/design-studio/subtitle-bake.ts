import { burnInSubtitlesToMp4 } from '@/src/ffmpeg/burnin-client';
import { shouldPreferCanvasOverlay } from '@/src/ffmpeg/subtitle-burnin';
import {
  BAKED_MP4_READY_KEY,
  loadUserPreferences,
  resolveOverlayBakeEncoder,
  resolveOverlayCompositeStrategy,
  resolveParallelBakeEnabled,
  resolvePartialRebakeSpliceEnabled,
} from '@/src/settings/user-preferences';
import { loadLastBakedMp4, saveLastBakedMp4 } from '@/src/storage/last-baked-mp4-db';
import { loadLastBaseMp4 } from '@/src/storage/last-base-mp4-db';
import { resolveAppearanceTheme } from '@/src/theme/design-overrides';
import { prepareSegmentsForSubtitleBake } from '@/src/transcription/transcript-editing';
import type {
  SubtitleStyleConfig,
  TranscriptResult,
} from '@/src/transcription/types';
import { snapshotBakeChronos } from '@/src/ui/design-studio/bake-chronos';
import {
  canvasRenderPerfBudgetMs,
  isCanvasRenderPerfExceeded,
} from '@/src/transcription/canvas-render-perf-guard';
import { bakeWithCanvasOverlay } from '@/src/ui/design-studio/subtitle-canvas-bake';
import { getTakeManager } from '@/src/session/take-manager';
import { EXTENSION_LOG_PREFIX, WAVEFORM_TARGET_FPS } from '@/src/utils/constants';
// CHANGED: v5.6.0 — partial re-bake PLAN telemetry (audio decoupling §4.2).
// WHY: validates dirty-window/span selection on real edits before Phase 2b
//      turns splice execution on. Zero behavior change — the bake still runs
//      the full pipeline; only the plan is computed and logged.
import { computeDirtySegments } from '@/src/editing/segment-dirty-tracker';
import {
  PARTIAL_REBAKE_PLAN_STAGE,
  coordinateRebake,
  planPartialRebake,
  type PartialRebakePlan,
} from '@/src/editing/partial-rebake-coordinator';
import { renderCompositeSplice } from '@/src/composite/composite-splice';
import { createTimeline, uniformSegments } from '@/src/timeline/timeline';
import { BROWSER_COMPOSITE_KEYFRAME_INTERVAL_SECONDS } from '@/src/composite/composite-plan';
import type { TranscriptSegment } from '@/src/transcription/types';

export interface SubtitleBakeProgress {
  ratio: number;
  stage: 'loading' | 'burning' | 'saving' | 'done' | 'error';
  message?: string;
  /** Wall time since bake started (Phase 5.1 chronos meter). */
  elapsedMs?: number;
  /** ETA from monotonic ratio; null when too early to estimate. */
  estimatedRemainingMs?: number | null;
}

export interface SubtitleBakeOptions {
  editedResult: TranscriptResult;
  style: SubtitleStyleConfig;
  videoDurationSeconds?: number;
  onProgress?: (progress: SubtitleBakeProgress) => void;
  signal?: AbortSignal;
}

function canvasStageMessage(stage: string, ratio: number): string {
  const pct = Math.round(ratio * 100);
  // v5.5.0 browser composite stages (ADR-0003) — checked before the generic
  // 'composite' needle below so each distinct stage keeps its own honest copy.
  if (stage === 'browser-composite-decode') {
    return `Reading base video… ${pct}%`;
  }
  if (stage === 'browser-composite-paint') {
    return `Compositing subtitles… ${pct}%`;
  }
  if (stage === 'browser-composite-encode') {
    return `Encoding video… ${pct}%`;
  }
  if (stage === 'browser-composite-mux') {
    return `Finalizing MP4… ${pct}%`;
  }
  // v5.7.0 Phase 2b partial re-bake splice stages.
  if (stage === 'partial-splice-scan') {
    return `Reading previous bake… ${pct}%`;
  }
  if (stage === 'partial-splice-reencode') {
    return `Re-compositing edited parts… ${pct}%`;
  }
  if (stage === 'partial-splice-assemble') {
    return `Splicing video… ${pct}%`;
  }
  if (stage.startsWith('canvas-overlay-render') || stage.includes('overlay-render')) {
    return `Rendering subtitles… ${pct}%`;
  }
  if (stage.includes('alpha-normalize')) {
    return `Preparing overlay… ${pct}%`;
  }
  if (
    stage.startsWith('burnin-canvas-overlay') ||
    stage.includes('composite') ||
    stage.startsWith('burnin-')
  ) {
    return `Compositing subtitles… ${pct}%`;
  }
  return `Burning subtitles… ${pct}%`;
}

/**
 * v5.6.0 — previous bake's inputs, kept only to diff against the next bake for
 * partial-rebake PLAN telemetry. Session-local by design: a cold Studio has no
 * prior bake to splice against anyway.
 */
let lastBakeInputs: {
  segments: TranscriptSegment[];
  styleKey: string;
  durationSeconds: number;
} | null = null;

/**
 * Diff this bake's cues/style against the previous bake (session-local) and
 * return the partial re-bake plan, logging it as telemetry. Returns null when
 * there is no comparable previous bake (cold Studio or duration change) or the
 * diff fails — the caller then always does a full composite. Never throws: a
 * plan miss must never gate the bake.
 */
function computePartialRebakePlan(
  segments: TranscriptSegment[],
  style: SubtitleStyleConfig,
  durationSeconds: number,
): PartialRebakePlan | null {
  const styleKey = JSON.stringify(style);
  const previous = lastBakeInputs;
  lastBakeInputs = { segments: segments.map((s) => ({ ...s })), styleKey, durationSeconds };
  if (!previous || previous.durationSeconds !== durationSeconds) return null;

  try {
    const timeline = createTimeline(durationSeconds, WAVEFORM_TARGET_FPS);
    const dirty = computeDirtySegments(
      {
        before: previous.segments,
        after: segments,
        styleChanged: previous.styleKey !== styleKey,
      },
      uniformSegments(timeline, BROWSER_COMPOSITE_KEYFRAME_INTERVAL_SECONDS),
      durationSeconds,
    );
    const plan = planPartialRebake({
      windows: dirty.windows,
      durationSeconds,
      fps: WAVEFORM_TARGET_FPS,
    });
    console.log(`${EXTENSION_LOG_PREFIX} ${PARTIAL_REBAKE_PLAN_STAGE}:`, {
      strategy: plan.strategy,
      spans: plan.spans.length,
      coverageRatio: Number(plan.coverageRatio.toFixed(3)),
      dirtySegments: dirty.dirtySegmentIndices.length,
      allDirty: dirty.allDirty,
      reason: plan.reason,
    });
    return plan;
  } catch (error) {
    // Telemetry / planning must never gate the bake.
    console.warn(`${EXTENSION_LOG_PREFIX} Partial-rebake plan telemetry failed`, error);
    return null;
  }
}

type BakeReport = (
  progress: Omit<SubtitleBakeProgress, 'elapsedMs' | 'estimatedRemainingMs'>,
) => void;

interface OptionalSpliceArgs {
  partialPlan: PartialRebakePlan | null;
  spliceEnabled: boolean;
  /** Clean base MP4 — dirty regions re-composite from here (never the baked frames). */
  baseMp4: Blob;
  segments: TranscriptSegment[];
  style: SubtitleStyleConfig;
  durationSeconds: number;
  themeBarColor: string;
  signal?: AbortSignal;
  report: BakeReport;
  runFullComposite: () => Promise<Blob>;
}

/**
 * v5.7.0 Phase 2b — attempt a partial re-bake splice, else full composite. The
 * splice runs ONLY when: the flag is on, the plan is 'partial', and a previous
 * baked MP4 exists to splice into. `coordinateRebake` reports 'partial' only on a
 * real, fidelity-verified splice; every miss (null / throw / fidelity reject)
 * delegates to `runFullComposite`, preserving invariant I1's fallback chain.
 */
async function bakeWithOptionalSplice(args: OptionalSpliceArgs): Promise<Blob> {
  const { partialPlan, spliceEnabled, runFullComposite } = args;
  if (!spliceEnabled || !partialPlan || partialPlan.strategy !== 'partial') {
    return runFullComposite();
  }

  const prevBaked = await loadLastBakedMp4();
  if (!prevBaked?.blob) {
    // No prior bake this session to splice into — full composite from clean base.
    return runFullComposite();
  }

  const execution = await coordinateRebake(partialPlan, runFullComposite, () =>
    renderCompositeSplice({
      bakedMp4: prevBaked.blob,
      baseMp4: args.baseMp4,
      segments: args.segments,
      style: args.style,
      durationSeconds: args.durationSeconds,
      spans: partialPlan.spans,
      themeBarColor: args.themeBarColor,
      signal: args.signal,
      onProgress: (ratio, stage) => {
        const overallRatio = 0.1 + ratio * 0.82;
        args.report({
          ratio: overallRatio,
          stage: 'burning',
          message: canvasStageMessage(stage, overallRatio),
        });
      },
    }),
  );

  if (!execution.blob) {
    // Unreachable for a 'partial' plan (the full executor always returns a Blob);
    // defensive so a null can never masquerade as a successful bake.
    throw new Error('Re-bake produced no output.');
  }
  if (execution.executed === 'partial') {
    console.log(
      `${EXTENSION_LOG_PREFIX} Partial re-bake splice applied — ${partialPlan.spans.length} span(s), ` +
        `${(partialPlan.coverageRatio * 100).toFixed(0)}% of the timeline.`,
    );
  }
  return execution.blob;
}

export async function bakeSubtitlesInStudio(options: SubtitleBakeOptions): Promise<Blob> {
  const startedAt = performance.now();
  const report = (progress: Omit<SubtitleBakeProgress, 'elapsedMs' | 'estimatedRemainingMs'>): void => {
    const chronos = snapshotBakeChronos(startedAt, progress.ratio);
    options.onProgress?.({ ...progress, ...chronos });
  };

  report({ ratio: 0.02, stage: 'loading', message: 'Loading base MP4…' });

  const base = await loadLastBaseMp4();
  if (!base?.blob) {
    // CHANGED: drop "on Reddit" from the capture prerequisite.
    // WHY: the Studio records natively (v5.4+), so naming Reddit here reads as a hard requirement.
    throw new Error('No base MP4 found — record a clip first.');
  }
  // Capture the narrowed Blob once — TS widens `base.blob` back to nullable
  // inside the nested bake closures below.
  const baseBlob = base.blob;

  const videoDurationSeconds = options.videoDurationSeconds ?? base.meta.durationSeconds;
  const segments = prepareSegmentsForSubtitleBake(
    options.editedResult.segments,
    videoDurationSeconds,
  );
  if (segments.length === 0) {
    throw new Error('Transcript has no subtitle cues to burn in.');
  }

  // v5.6.0 §4.2 — diff vs the previous bake → partial re-bake plan (telemetry
  // always; drives the v5.7.0 splice below only when the flag is on).
  const partialPlan = computePartialRebakePlan(segments, options.style, videoDurationSeconds);

  const prefs = await loadUserPreferences();
  const themeBarColor = resolveAppearanceTheme(prefs.appearance).colors.bar;

  const preferCanvas = shouldPreferCanvasOverlay({
    segments,
    style: options.style,
    videoDurationSeconds,
    themeBarColor,
  });

  report({
    ratio: 0.08,
    stage: 'burning',
    message: preferCanvas ? 'Rendering subtitles (canvas)…' : 'Burning subtitles…',
  });

  async function burnWithDrawtext(): Promise<Blob> {
    return burnInSubtitlesToMp4(baseBlob, {
      segments,
      style: options.style,
      videoDurationSeconds,
      themeBarColor,
      signal: options.signal,
      onProgress: (ratio) => {
        report({
          ratio: 0.1 + ratio * 0.82,
          stage: 'burning',
          message: `Burning subtitles… ${Math.round(ratio * 100)}%`,
        });
      },
    });
  }

  // The full composite over the CLEAN base — the invariant-I1 fallback chain
  // (browser composite → WebCodecs+alphamerge → MediaRecorder → drawtext). The
  // partial splice below either succeeds or delegates back to this.
  async function runFullComposite(): Promise<Blob> {
    if (!preferCanvas) {
      return burnWithDrawtext();
    }
    try {
      return await bakeWithCanvasOverlay({
        editedResult: { ...options.editedResult, segments },
        style: options.style,
        durationSeconds: videoDurationSeconds,
        themeBarColor,
        baseMp4: baseBlob,
        signal: options.signal,
        renderPerfBudgetMs: canvasRenderPerfBudgetMs(videoDurationSeconds),
        // v5.3.9 / v5.3.10 — same resolver the production prefs use (Lab bypasses
        // prefs and passes toggles directly). Orchestrators still auto-gate and
        // fall back on probe/chunk/encode failure.
        parallelBake: resolveParallelBakeEnabled(prefs.experimental),
        encoder: resolveOverlayBakeEncoder(prefs.experimental),
        // v5.5.1 — browser composite default-on via prefs; Lab bypasses prefs
        // with its own toggle. Set experimental.browserComposite: false to opt out.
        composite: resolveOverlayCompositeStrategy(prefs.experimental),
        onProgress: (ratio, stage) => {
          const overallRatio = 0.1 + ratio * 0.82;
          report({
            ratio: overallRatio,
            stage: 'burning',
            message: canvasStageMessage(stage, overallRatio),
          });
        },
      });
    } catch (error) {
      if (!isCanvasRenderPerfExceeded(error)) {
        throw error;
      }
      console.warn(
        `${EXTENSION_LOG_PREFIX} Canvas overlay render exceeded perf budget — falling back to drawtext`,
        {
          budgetMs: error.budgetMs,
          elapsedMs: error.elapsedMs,
          videoDurationSeconds,
          cueCount: segments.length,
        },
      );
      report({
        ratio: 0.1,
        stage: 'burning',
        message: 'Canvas render slow — using drawtext fallback…',
      });
      return burnWithDrawtext();
    }
  }

  // v5.7.0 Phase 2b — partial re-bake splice (experimental.partialRebakeSplice,
  // default on after QA; opt-out with false). When a small cue edit dirties only a
  // few keyframe-aligned regions AND a previous baked MP4 exists to splice into,
  // re-composite just the dirty
  // regions from the clean base and splice them into the prior bake. The executor
  // self-verifies (kept-region pixel equality) and coordinateRebake reports
  // 'partial' ONLY on real success — any miss delegates to runFullComposite (I2).
  const burned = await bakeWithOptionalSplice({
    partialPlan,
    spliceEnabled: resolvePartialRebakeSpliceEnabled(prefs.experimental),
    baseMp4: baseBlob,
    segments,
    style: options.style,
    durationSeconds: videoDurationSeconds,
    themeBarColor,
    signal: options.signal,
    report,
    runFullComposite,
  });

  report({ ratio: 0.94, stage: 'saving', message: 'Saving baked MP4…' });
  // BUG FIX: H13 false-success artifact publication
  // Fix: saveLastBakedMp4 now throws on size rejection too (it used to no-op
  //      silently on >30 MB, then this path fired BAKED_MP4_READY + promoted
  //      the take over the PREVIOUS bake's bytes). A failed save propagates to
  //      the bake's existing failure surface; ready-signal and stamp publish
  //      only from the store's returned persisted meta.
  // Sync: src/storage/last-baked-mp4-db.ts (contract), take-manager.ts
  //       TakeBakeResult.savedAt, audio/voice-reapply.ts (same pattern).
  const savedMeta = await saveLastBakedMp4(burned, base.meta.durationSeconds);
  await browser.storage.local.set({ [BAKED_MP4_READY_KEY]: Date.now() });
  // v5.4.0: promote the bake into the current take — every context (status
  // panel, Reddit attach) learns about the fresh baked MP4 via the snapshot.
  void getTakeManager().updateFromBake({
    durationSeconds: savedMeta.durationSeconds,
    byteLength: savedMeta.byteLength,
    savedAt: savedMeta.savedAt,
  });

  report({
    ratio: 1,
    stage: 'done',
    message: 'Subtitles baked — download from the Current Take deck or attach on Reddit.',
  });
  return burned;
}