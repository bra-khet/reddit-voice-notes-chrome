import { runSubtitleBurnIn } from '@/src/ffmpeg/ffmpeg-runner';
import { withTranscodeLock } from '@/src/ffmpeg/transcode-lock';
import { loadLastBaseMp4 } from '@/src/storage/last-base-mp4-db';
import { renderSubtitleOverlay } from '@/src/transcription/subtitle-overlay-renderer';
import { cueTextIsBlank, stripScaffoldPlaceholder } from '@/src/transcription/transcript-editing';
import type { SubtitleStyleConfig, TranscriptResult, TranscriptSegment } from '@/src/transcription/types';
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '@/src/utils/constants';

function usableSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  return segments
    .filter((segment) => !cueTextIsBlank(segment.text))
    .map((segment) => ({
      ...segment,
      text: stripScaffoldPlaceholder(segment.text).trim(),
    }))
    .filter((segment) => segment.text.length > 0);
}

export interface CanvasOverlayBakeOptions {
  editedResult: TranscriptResult;
  style: SubtitleStyleConfig;
  durationSeconds: number;
  themeBarColor?: string;
  onProgress?: (ratio: number, stage: string) => void;
}

/**
 * Dev / content-script path — render canvas overlay, then composite via FFmpeg (v5.3.4 Phase 4).
 * Must run in Design Studio (needs document + MediaRecorder); overlay bytes are passed to burn-in.
 */
export async function bakeWithCanvasOverlay(options: CanvasOverlayBakeOptions): Promise<Blob> {
  const segments = usableSegments(options.editedResult.segments);
  if (segments.length === 0) {
    throw new Error('No usable subtitle cues for canvas overlay bake.');
  }

  const base = await loadLastBaseMp4();
  if (!base?.blob) {
    throw new Error('No base MP4 found — record a clip on Reddit first.');
  }

  const report = (ratio: number, stage: string): void => {
    options.onProgress?.(ratio, stage);
  };

  report(0.05, 'canvas-overlay-render');
  const overlayResult = await renderSubtitleOverlay(segments, options.style, options.durationSeconds, {
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    fps: 30,
    background: 'transparent',
    offline: true,
    themeBarColor: options.themeBarColor,
  });

  const overlayBytes = new Uint8Array(await overlayResult.overlayBlob.arrayBuffer());
  const baseBytes = new Uint8Array(await base.blob.arrayBuffer());

  report(0.45, 'canvas-overlay-composite');
  const burnedBytes = await withTranscodeLock(async () =>
    runSubtitleBurnIn(
      baseBytes,
      {
        segments,
        style: options.style,
        videoDurationSeconds: options.durationSeconds ?? base.meta.durationSeconds,
        themeBarColor: options.themeBarColor,
        useCanvasOverlay: true,
        canvasOverlayBytes: overlayBytes,
      },
      (ratio, stage) => {
        report(0.45 + ratio * 0.55, stage);
      },
    ),
  );

  report(1, 'canvas-overlay-done');
  return new Blob([burnedBytes.slice()], { type: 'video/mp4' });
}