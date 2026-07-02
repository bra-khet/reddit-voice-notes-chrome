import { runSubtitleBurnIn } from '@/src/ffmpeg/ffmpeg-runner';
import { normalizeOverlayWebmForComposite } from '@/src/ffmpeg/overlay-webm-finalize';
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
  /** When provided, skips a second loadLastBaseMp4() (production bake path). */
  baseMp4?: Blob;
  onProgress?: (ratio: number, stage: string) => void;
  signal?: AbortSignal;
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

  const segments = usableSegments(options.editedResult.segments);
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
  const overlayResult = await renderSubtitleOverlay(segments, options.style, options.durationSeconds, {
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    fps: 30,
    background: 'transparent',
    offline: true,
    themeBarColor: options.themeBarColor,
    onRenderProgress: ({ ratio }) => {
      report(
        RENDER_RATIO_START + ratio * (RENDER_RATIO_END - RENDER_RATIO_START),
        'canvas-overlay-render',
      );
    },
  });

  throwIfAborted(options.signal);
  report(0.32, 'canvas-overlay-alpha-normalize');
  const compositeOverlay = await normalizeOverlayWebmForComposite(
    overlayResult.overlayBlob,
    overlayResult.fps,
  );
  const overlayBytes = new Uint8Array(await compositeOverlay.arrayBuffer());
  const baseBytes = new Uint8Array(await baseBlob.arrayBuffer());

  report(0.45, 'canvas-overlay-composite');
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
        report(0.45 + ratio * 0.55, stage);
      },
    ),
  );

  report(1, 'canvas-overlay-done');
  return new Blob([burnedBytes.slice()], { type: 'video/mp4' });
}