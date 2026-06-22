import { burnInSubtitlesToMp4 } from '@/src/ffmpeg/burnin-client';
import { saveLastBakedMp4 } from '@/src/storage/last-baked-mp4-db';
import { loadLastBaseMp4 } from '@/src/storage/last-base-mp4-db';
import type { SubtitleStyleConfig, TranscriptResult } from '@/src/transcription/types';
import { BAKED_MP4_READY_KEY } from '@/src/settings/user-preferences';

export interface SubtitleBakeProgress {
  ratio: number;
  stage: 'loading' | 'burning' | 'saving' | 'done' | 'error';
  message?: string;
}

export interface SubtitleBakeOptions {
  editedResult: TranscriptResult;
  style: SubtitleStyleConfig;
  videoDurationSeconds?: number;
  onProgress?: (progress: SubtitleBakeProgress) => void;
  signal?: AbortSignal;
}

export async function bakeSubtitlesInStudio(options: SubtitleBakeOptions): Promise<Blob> {
  const report = (progress: SubtitleBakeProgress): void => {
    options.onProgress?.(progress);
  };

  report({ ratio: 0.02, stage: 'loading', message: 'Loading base MP4…' });

  const base = await loadLastBaseMp4();
  if (!base?.blob) {
    throw new Error('No base MP4 found — record a clip on Reddit first.');
  }

  const segments = options.editedResult.segments.filter((segment) => segment.text.trim());
  if (segments.length === 0) {
    throw new Error('Transcript has no subtitle cues to burn in.');
  }

  report({ ratio: 0.08, stage: 'burning', message: 'Burning subtitles…' });

  const burned = await burnInSubtitlesToMp4(base.blob, {
    segments,
    style: options.style,
    videoDurationSeconds: options.videoDurationSeconds ?? base.meta.durationSeconds,
    signal: options.signal,
    onProgress: (ratio) => {
      report({
        ratio: 0.1 + ratio * 0.82,
        stage: 'burning',
        message: `Burning subtitles… ${Math.round(ratio * 100)}%`,
      });
    },
  });

  report({ ratio: 0.94, stage: 'saving', message: 'Saving baked MP4…' });
  await saveLastBakedMp4(burned, base.meta.durationSeconds);
  await browser.storage.local.set({ [BAKED_MP4_READY_KEY]: Date.now() });

  report({ ratio: 1, stage: 'done', message: 'Subtitles baked — attach from Reddit recorder.' });
  return burned;
}