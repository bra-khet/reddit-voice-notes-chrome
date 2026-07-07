import { burnInSubtitlesToMp4 } from '@/src/ffmpeg/burnin-client';
import { shouldPreferCanvasOverlay } from '@/src/ffmpeg/subtitle-burnin';
import {
  BAKED_MP4_READY_KEY,
  loadUserPreferences,
  resolveOverlayBakeEncoder,
  resolveOverlayCompositeStrategy,
  resolveParallelBakeEnabled,
} from '@/src/settings/user-preferences';
import { saveLastBakedMp4 } from '@/src/storage/last-baked-mp4-db';
import { loadLastBaseMp4 } from '@/src/storage/last-base-mp4-db';
import { resolveAppearanceTheme } from '@/src/theme/design-overrides';
import { prepareSegmentsForSubtitleBake } from '@/src/transcription/transcript-editing';
import type { SubtitleStyleConfig, TranscriptResult } from '@/src/transcription/types';
import { snapshotBakeChronos } from '@/src/ui/design-studio/bake-chronos';
import {
  canvasRenderPerfBudgetMs,
  isCanvasRenderPerfExceeded,
} from '@/src/transcription/canvas-render-perf-guard';
import { bakeWithCanvasOverlay } from '@/src/ui/design-studio/subtitle-canvas-bake';
import { getTakeManager } from '@/src/session/take-manager';
import { EXTENSION_LOG_PREFIX } from '@/src/utils/constants';

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

export async function bakeSubtitlesInStudio(options: SubtitleBakeOptions): Promise<Blob> {
  const startedAt = performance.now();
  const report = (progress: Omit<SubtitleBakeProgress, 'elapsedMs' | 'estimatedRemainingMs'>): void => {
    const chronos = snapshotBakeChronos(startedAt, progress.ratio);
    options.onProgress?.({ ...progress, ...chronos });
  };

  report({ ratio: 0.02, stage: 'loading', message: 'Loading base MP4…' });

  const base = await loadLastBaseMp4();
  if (!base?.blob) {
    throw new Error('No base MP4 found — record a clip on Reddit first.');
  }

  const videoDurationSeconds = options.videoDurationSeconds ?? base.meta.durationSeconds;
  const segments = prepareSegmentsForSubtitleBake(
    options.editedResult.segments,
    videoDurationSeconds,
  );
  if (segments.length === 0) {
    throw new Error('Transcript has no subtitle cues to burn in.');
  }

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
    return burnInSubtitlesToMp4(base.blob, {
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

  let burned: Blob;
  if (preferCanvas) {
    try {
      burned = await bakeWithCanvasOverlay({
        editedResult: { ...options.editedResult, segments },
        style: options.style,
        durationSeconds: videoDurationSeconds,
        themeBarColor,
        baseMp4: base.blob,
        signal: options.signal,
        renderPerfBudgetMs: canvasRenderPerfBudgetMs(videoDurationSeconds),
        // v5.3.9 / v5.3.10 — same resolver the production prefs use (Lab bypasses
        // prefs and passes toggles directly). Orchestrators still auto-gate and
        // fall back on probe/chunk/encode failure.
        parallelBake: resolveParallelBakeEnabled(prefs.experimental),
        encoder: resolveOverlayBakeEncoder(prefs.experimental),
        // v5.5.0 — browser composite is opt-in until the Phase 0 QA gate
        // passes (ADR-0003); resolver returns 'ffmpeg' unless the user (or
        // Lab) enabled experimental.browserComposite.
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
      burned = await burnWithDrawtext();
    }
  } else {
    burned = await burnWithDrawtext();
  }

  report({ ratio: 0.94, stage: 'saving', message: 'Saving baked MP4…' });
  await saveLastBakedMp4(burned, base.meta.durationSeconds);
  await browser.storage.local.set({ [BAKED_MP4_READY_KEY]: Date.now() });
  // v5.4.0: promote the bake into the current take — every context (status
  // panel, Reddit attach) learns about the fresh baked MP4 via the snapshot.
  void getTakeManager().updateFromBake({
    durationSeconds: base.meta.durationSeconds,
    byteLength: burned.size,
  });

  report({
    ratio: 1,
    stage: 'done',
    message: 'Subtitles baked — download from the Current Take deck or attach on Reddit.',
  });
  return burned;
}