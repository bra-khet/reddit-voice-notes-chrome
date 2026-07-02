import { burnInSubtitlesToMp4 } from '@/src/ffmpeg/burnin-client';
import { shouldPreferCanvasOverlay } from '@/src/ffmpeg/subtitle-burnin';
import {
  BAKED_MP4_READY_KEY,
  loadUserPreferences,
} from '@/src/settings/user-preferences';
import { saveLastBakedMp4 } from '@/src/storage/last-baked-mp4-db';
import { loadLastBaseMp4 } from '@/src/storage/last-base-mp4-db';
import { resolveAppearanceTheme } from '@/src/theme/design-overrides';
import { cueTextIsBlank, stripScaffoldPlaceholder } from '@/src/transcription/transcript-editing';
import type { SubtitleStyleConfig, TranscriptResult } from '@/src/transcription/types';
import { snapshotBakeChronos } from '@/src/ui/design-studio/bake-chronos';
import { bakeWithCanvasOverlay } from '@/src/ui/design-studio/subtitle-canvas-bake';

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

  // CHANGED: drop soft-hyphen-only scaffold slots + clean placeholders from the
  // cues that do carry text, so scaffolding never leaks into the burn-in (v5.3).
  const segments = options.editedResult.segments
    .filter((segment) => !cueTextIsBlank(segment.text))
    .map((segment) => ({ ...segment, text: stripScaffoldPlaceholder(segment.text).trim() }));
  if (segments.length === 0) {
    throw new Error('Transcript has no subtitle cues to burn in.');
  }

  const prefs = await loadUserPreferences();
  const themeBarColor = resolveAppearanceTheme(prefs.appearance).colors.bar;
  const videoDurationSeconds = options.videoDurationSeconds ?? base.meta.durationSeconds;

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

  let burned: Blob;
  if (preferCanvas) {
    burned = await bakeWithCanvasOverlay({
      editedResult: { ...options.editedResult, segments },
      style: options.style,
      durationSeconds: videoDurationSeconds,
      themeBarColor,
      baseMp4: base.blob,
      signal: options.signal,
      onProgress: (ratio, stage) => {
        const overallRatio = 0.1 + ratio * 0.82;
        report({
          ratio: overallRatio,
          stage: 'burning',
          message: canvasStageMessage(stage, overallRatio),
        });
      },
    });
  } else {
    burned = await burnInSubtitlesToMp4(base.blob, {
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

  report({ ratio: 0.94, stage: 'saving', message: 'Saving baked MP4…' });
  await saveLastBakedMp4(burned, base.meta.durationSeconds);
  await browser.storage.local.set({ [BAKED_MP4_READY_KEY]: Date.now() });

  report({ ratio: 1, stage: 'done', message: 'Subtitles baked — attach from Reddit recorder.' });
  return burned;
}