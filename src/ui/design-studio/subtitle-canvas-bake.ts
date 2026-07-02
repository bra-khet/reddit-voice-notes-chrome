import { runSubtitleBurnIn } from '@/src/ffmpeg/ffmpeg-runner';
import { normalizeOverlayWebmForComposite } from '@/src/ffmpeg/overlay-webm-finalize';
import { withTranscodeLock } from '@/src/ffmpeg/transcode-lock';
import { loadLastBaseMp4 } from '@/src/storage/last-base-mp4-db';
import { renderSubtitleOverlay } from '@/src/transcription/subtitle-overlay-renderer';
import { prepareSegmentsForSubtitleBake } from '@/src/transcription/transcript-editing';
import type { SubtitleStyleConfig, TranscriptResult } from '@/src/transcription/types';
import { computeCreepRatio } from '@/src/ui/design-studio/bake-chronos';
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '@/src/utils/constants';

const NORMALIZE_RATIO_START = 0.32;
const NORMALIZE_RATIO_END = 0.44;
const COMPOSITE_RATIO_START = 0.45;

function normalizeCreepExpectedMs(durationSeconds: number): number {
  return Math.min(20_000, Math.max(4_000, durationSeconds * 350));
}

async function withNormalizeProgressCreep<T>(
  work: () => Promise<T>,
  report: (ratio: number, stage: string) => void,
  durationSeconds: number,
): Promise<T> {
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

  try {
    return await work();
  } finally {
    window.clearInterval(timer);
    report(NORMALIZE_RATIO_END, stage);
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