import { burnInSubtitlesToMp4 } from '@/src/ffmpeg/burnin-client';
import { loadLastBaseMp4 } from '@/src/storage/last-base-mp4-db';
import { cueTextIsBlank, stripScaffoldPlaceholder } from '@/src/transcription/transcript-editing';
import {
  renderSubtitleOverlayForPreview,
  type SubtitleOverlayFrameDebugInfo,
} from '@/src/transcription/subtitle-overlay-renderer';
import type { SubtitleStyleConfig, TranscriptResult, TranscriptSegment } from '@/src/transcription/types';
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '@/src/utils/constants';

export interface SubtitleOverlayCompareResult {
  canvasOverlayUrl: string;
  drawtextBakedUrl: string;
}

function usableSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  return segments
    .filter((segment) => !cueTextIsBlank(segment.text))
    .map((segment) => ({
      ...segment,
      text: stripScaffoldPlaceholder(segment.text).trim(),
    }))
    .filter((segment) => segment.text.length > 0);
}

/**
 * Dev harness — render canvas overlay + drawtext burn-in on the last base MP4 for side-by-side QA.
 */
export async function renderSubtitleOverlayComparison(
  edited: TranscriptResult,
  style: SubtitleStyleConfig,
  durationSeconds: number,
  themeBarColor: string | undefined,
  options?: {
    singleFrameDebug?: boolean;
    onFrameDebug?: (info: SubtitleOverlayFrameDebugInfo) => void | Promise<void>;
    /** Fires when canvas overlay is ready (before drawtext burn-in may finish). */
    onCanvasOverlayReady?: (canvasOverlayUrl: string) => void;
  },
): Promise<SubtitleOverlayCompareResult> {
  const segments = usableSegments(edited.segments);
  if (segments.length === 0) {
    throw new Error('No usable subtitle cues for overlay comparison.');
  }

  const base = await loadLastBaseMp4();
  if (!base?.blob) {
    throw new Error('No base MP4 found — record a clip on Reddit first for drawtext comparison.');
  }

  const canvasOverlayPromise = renderSubtitleOverlayForPreview(segments, style, durationSeconds, {
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    fps: 30,
    background: 'transparent',
    offline: true,
    themeBarColor,
    singleFrameDebug: options?.singleFrameDebug,
    onFrameDebug: options?.onFrameDebug,
  }).then((canvasOverlayUrl) => {
    options?.onCanvasOverlayReady?.(canvasOverlayUrl);
    return canvasOverlayUrl;
  });

  const [canvasOverlayUrl, drawtextBlob] = await Promise.all([
    canvasOverlayPromise,
    burnInSubtitlesToMp4(base.blob, {
      segments,
      style,
      videoDurationSeconds: durationSeconds ?? base.meta.durationSeconds,
      themeBarColor,
    }),
  ]);

  return {
    canvasOverlayUrl,
    drawtextBakedUrl: URL.createObjectURL(drawtextBlob),
  };
}