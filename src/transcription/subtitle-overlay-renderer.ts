/**
 * v5.3.4 Canvas Overlay Subtitle Renderer
 * Renders timed styled subtitles + glow/border effects to an off-screen canvas
 * and captures the result as a video track / Blob for later FFmpeg compositing.
 *
 * Sync points:
 * - Uses SubtitleStyleConfig and TranscriptSegment from ./types
 * - Re-uses color helpers from ./subtitle-effects
 * - Will be called from src/ffmpeg/subtitle-burnin.ts and Design Studio
 * - Font family keys: preview-font-loader.ts PREVIEW_FAMILY_FOR_KEY, subtitle-burnin.ts FONT_ASSETS
 */

import { resolveSubtitleEffectPalette } from '@/src/transcription/subtitle-effects';
import { cueTextIsBlank, stripScaffoldPlaceholder } from '@/src/transcription/transcript-editing';
import type { SubtitleStyleConfig, TranscriptSegment } from '@/src/transcription/types';

const DEFAULT_THEME_BAR = '#00e5ff';
const OVERLAY_VIDEO_BPS = 1_500_000;
const SINGLE_FRAME_DEBUG_PAUSE_MS = 180;

// Sync: preview-font-loader.ts PREVIEW_FAMILY_FOR_KEY
const OVERLAY_FONT_FAMILY: Readonly<Record<string, string>> = {
  'dejavu-sans': 'RVN-DejaVu-Sans',
  'dejavu-serif': 'RVN-DejaVu-Serif',
  'dejavu-mono': 'RVN-DejaVu-Mono',
  'dejavu-bold': 'RVN-DejaVu-Bold',
};

export interface SubtitleOverlayFrameDebugInfo {
  frameIndex: number;
  timestampSeconds: number;
  imageUrl: string;
}

export interface SubtitleOverlayRenderOptions {
  /** Target output width (should match base video) */
  width: number;
  /** Target output height (should match base video) */
  height: number;
  /** Desired output framerate (e.g. 30) */
  fps: number;
  /** Background color or 'transparent' */
  background?: string | 'transparent';
  /** When true, render faster than real-time (default true for bake) */
  offline?: boolean;
  /** Active theme bar color — resolves theme-hue text/glow at render time. */
  themeBarColor?: string;
  /** Dev-only: pause after each painted frame for progressive visual QA. */
  singleFrameDebug?: boolean;
  /** Called after each frame when singleFrameDebug is enabled. Revoke imageUrl when done. */
  onFrameDebug?: (info: SubtitleOverlayFrameDebugInfo) => void | Promise<void>;
}

export interface SubtitleOverlayResult {
  /** The rendered overlay as a video Blob (webm or mp4) */
  overlayBlob: Blob;
  /** Duration of the rendered overlay in seconds */
  durationSeconds: number;
  /** Actual framerate used */
  fps: number;
}

interface NormalizedCue {
  start: number;
  end: number;
  text: string;
}

interface RenderTarget {
  paintCanvas: HTMLCanvasElement | OffscreenCanvas;
  paintCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  captureCanvas: HTMLCanvasElement;
  captureCtx: CanvasRenderingContext2D;
  blitToCapture: () => void;
}

function pickOverlayMimeType(): string | undefined {
  const candidates = ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

function overlayCssFontFamily(key: string | undefined): string {
  return OVERLAY_FONT_FAMILY[key ?? 'dejavu-sans'] ?? 'RVN-DejaVu-Sans';
}

async function ensureOverlayFonts(): Promise<void> {
  if (typeof document === 'undefined') return;
  const { loadDejaVuPreviewFonts } = await import('@/src/ui/design-studio/preview-font-loader');
  await loadDejaVuPreviewFonts();
}

function normalizeOverlaySegments(
  segments: TranscriptSegment[],
  durationSeconds: number,
): NormalizedCue[] {
  const usable = segments
    .filter((segment) => !cueTextIsBlank(segment.text))
    .map((segment) => {
      const text = stripScaffoldPlaceholder(segment.text).trim();
      const start = Math.max(0, segment.start);
      const end = Math.max(start + 0.35, segment.end);
      return { start, end, text };
    })
    .filter((segment) => segment.text.length > 0);

  if (usable.length === 0) return [];

  const duration = Math.max(1, durationSeconds);
  const missingTimings = usable.every((segment) => segment.end <= segment.start);

  if (missingTimings) {
    const slot = duration / usable.length;
    return usable.map((segment, index) => ({
      ...segment,
      start: index * slot,
      end: Math.min(duration, (index + 1) * slot - 0.05),
    }));
  }

  return usable;
}

function cuesAtTimestamp(cues: NormalizedCue[], timestamp: number, durationSeconds: number): NormalizedCue[] {
  const isLastFrame = timestamp >= durationSeconds - 1e-6;
  return cues.filter((cue) => {
    if (timestamp < cue.start) return false;
    if (isLastFrame) return timestamp <= cue.end;
    return timestamp < cue.end;
  });
}

function createRenderTarget(width: number, height: number): RenderTarget {
  if (typeof document === 'undefined') {
    throw new Error('Subtitle overlay render requires a document (canvas + MediaRecorder).');
  }

  const captureCanvas = document.createElement('canvas');
  captureCanvas.width = width;
  captureCanvas.height = height;
  const captureCtx = captureCanvas.getContext('2d', { alpha: true });
  if (!captureCtx) {
    throw new Error('Canvas 2D context unavailable for subtitle overlay capture.');
  }

  if (typeof OffscreenCanvas !== 'undefined') {
    const paintCanvas = new OffscreenCanvas(width, height);
    const paintCtx = paintCanvas.getContext('2d', { alpha: true });
    if (paintCtx) {
      return {
        paintCanvas,
        paintCtx,
        captureCanvas,
        captureCtx,
        blitToCapture: () => {
          captureCtx.clearRect(0, 0, width, height);
          captureCtx.drawImage(paintCanvas, 0, 0);
        },
      };
    }
  }

  return {
    paintCanvas: captureCanvas,
    paintCtx: captureCtx,
    captureCanvas,
    captureCtx,
    blitToCapture: () => undefined,
  };
}

function verticalTextY(
  position: SubtitleStyleConfig['position'],
  fontSize: number,
  canvasHeight: number,
  textHeight: number,
): number {
  const margin = Math.max(16, Math.round(fontSize * 0.9));
  if (position === 'top') return margin;
  if (position === 'center') return Math.round((canvasHeight - textHeight) / 2);
  return canvasHeight - textHeight - margin;
}

function fillRoundedRect(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
}

function hexToRgba(hex: string, opacity: number): string {
  const normalized = hex.startsWith('#') ? hex.slice(1) : hex;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

function paintBackdropPlate(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  centerX: number,
  topY: number,
  style: SubtitleStyleConfig,
  fontSize: number,
  lineHeight: number,
): { blockX: number; blockY: number; textY: number } {
  const paddingX = 12;
  const paddingY = 10;
  const textWidth = ctx.measureText(text).width;
  const blockWidth = textWidth + paddingX * 2;
  const blockHeight = lineHeight + paddingY * 2;
  const blockX = Math.round(centerX - blockWidth / 2);
  const blockY = topY;

  const backdrop = style.backdrop;
  if (backdrop?.enabled !== false) {
    const opacity = backdrop?.opacity ?? 0.72;
    const radius = backdrop?.borderRadius ?? 8;
    ctx.fillStyle = `rgba(0, 0, 0, ${opacity})`;
    fillRoundedRect(ctx, blockX, blockY, blockWidth, blockHeight, radius);
  }

  return { blockX, blockY, textY: blockY + paddingY };
}

function paintGlowText(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  style: SubtitleStyleConfig,
  glowHex: string,
): void {
  const glow = style.glow;
  if (glow?.enabled !== true) return;

  const mode = glow.mode ?? 'halo';
  const glowOpacity = glow.opacity ?? 0.55;

  if (mode === 'border') {
    ctx.save();
    ctx.strokeStyle = glowHex;
    ctx.lineWidth = Math.max(2, Math.round((style.fontSize ?? 22) * 0.08));
    ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y);
    ctx.restore();
    return;
  }

  // Halo: native shadowBlur replaces drawtext ring duplication (Phase 2 baseline).
  const spread = Math.max(1, Math.min(3, Math.round(glow.blurRadius ?? 2)));
  const blurPx = spread * 4;

  ctx.save();
  ctx.shadowBlur = blurPx;
  ctx.shadowColor = hexToRgba(glowHex, glowOpacity);
  ctx.shadowOffsetX = glow.offsetX ?? 0;
  ctx.shadowOffsetY = glow.offsetY ?? 0;
  ctx.fillStyle = hexToRgba(glowHex, glowOpacity);
  ctx.fillText(text, x, y);

  // Second pass thickens the soft halo without extra drawtext layers.
  ctx.shadowBlur = blurPx * 1.35;
  ctx.globalAlpha = glowOpacity * 0.55;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function paintMainText(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  textHex: string,
): void {
  ctx.fillStyle = textHex;
  ctx.fillText(text, x, y);
}

function paintCue(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  cue: NormalizedCue,
  style: SubtitleStyleConfig,
  width: number,
  height: number,
  themeBarColor: string,
): void {
  const fontSize = style.fontSize ?? 22;
  const fontFamily = overlayCssFontFamily(style.fontFamily);
  const lineHeight = Math.round(fontSize * 1.25);
  const palette = resolveSubtitleEffectPalette(style, themeBarColor);

  ctx.save();
  ctx.font = `600 ${fontSize}px ${fontFamily}, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const centerX = width / 2;
  const textHeight = lineHeight;
  const anchorY = verticalTextY(style.position, fontSize, height, textHeight);
  const { textY } = paintBackdropPlate(ctx, cue.text, centerX, anchorY, style, fontSize, lineHeight);

  paintGlowText(ctx, cue.text, centerX, textY, style, palette.glowHex);
  paintMainText(ctx, cue.text, centerX, textY, palette.textHex);
  ctx.restore();
}

function clearFrame(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  background: string | 'transparent',
): void {
  ctx.clearRect(0, 0, width, height);
  if (background !== 'transparent') {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }
}

function paintFrame(
  target: RenderTarget,
  cues: NormalizedCue[],
  style: SubtitleStyleConfig,
  options: SubtitleOverlayRenderOptions,
  timestamp: number,
  durationSeconds: number,
): void {
  const { width, height } = options;
  const themeBarColor = options.themeBarColor ?? DEFAULT_THEME_BAR;
  const background = options.background ?? 'transparent';

  clearFrame(target.paintCtx, width, height, background);

  const active = cuesAtTimestamp(cues, timestamp, durationSeconds);
  for (const cue of active) {
    paintCue(target.paintCtx, cue, style, width, height, themeBarColor);
  }

  target.blitToCapture();
}

async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => {
    queueMicrotask(() => resolve());
  });
}

async function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png');
  });
}

async function recordOverlayTimeline(
  target: RenderTarget,
  cues: NormalizedCue[],
  style: SubtitleStyleConfig,
  durationSeconds: number,
  options: SubtitleOverlayRenderOptions,
): Promise<Blob> {
  const fps = Math.max(1, options.fps);
  const totalFrames = Math.max(1, Math.ceil(durationSeconds * fps));
  const mimeType = pickOverlayMimeType();
  const stream = target.captureCanvas.captureStream(0);
  const videoTrack = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;

  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: OVERLAY_VIDEO_BPS,
  });

  await new Promise<void>((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = () => {
      reject(new Error('MediaRecorder failed while capturing subtitle overlay.'));
    };
    recorder.onstop = () => resolve();

    recorder.start(100);

    void (async () => {
      try {
        for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
          const timestamp = frameIndex / fps;
          paintFrame(target, cues, style, options, timestamp, durationSeconds);

          if (typeof videoTrack?.requestFrame === 'function') {
            videoTrack.requestFrame();
          }

          if (options.singleFrameDebug && options.onFrameDebug) {
            const png = await canvasToPngBlob(target.captureCanvas);
            if (png) {
              const imageUrl = URL.createObjectURL(png);
              try {
                await options.onFrameDebug({
                  frameIndex,
                  timestampSeconds: timestamp,
                  imageUrl,
                });
              } finally {
                URL.revokeObjectURL(imageUrl);
              }
            }
            await new Promise<void>((r) => {
              window.setTimeout(() => r(), SINGLE_FRAME_DEBUG_PAUSE_MS);
            });
          }

          if (options.offline !== false) {
            await yieldToEventLoop();
          }
        }

        await new Promise<void>((r) => {
          window.setTimeout(() => r(), 120);
        });

        if (recorder.state === 'recording') {
          recorder.requestData();
          recorder.stop();
        }
      } catch (error) {
        if (recorder.state === 'recording') recorder.stop();
        reject(error);
      }
    })();
  });

  for (const track of stream.getVideoTracks()) {
    track.stop();
  }

  const blobType = mimeType ?? 'video/webm';
  const overlayBlob = new Blob(chunks, { type: blobType });
  if (overlayBlob.size === 0) {
    throw new Error('Subtitle overlay capture produced an empty video blob.');
  }
  return overlayBlob;
}

/**
 * Main entry point. Renders the full timeline offline.
 * Must work completely off-screen (no DOM attachment required).
 */
export async function renderSubtitleOverlay(
  segments: TranscriptSegment[],
  style: SubtitleStyleConfig,
  durationSeconds: number,
  options: SubtitleOverlayRenderOptions,
): Promise<SubtitleOverlayResult> {
  const fps = Math.max(1, options.fps);
  const duration = Math.max(0.5, durationSeconds);
  const cues = normalizeOverlaySegments(segments, duration);

  if (cues.length === 0) {
    throw new Error('No usable subtitle cues to render in canvas overlay.');
  }

  await ensureOverlayFonts();

  const target = createRenderTarget(options.width, options.height);
  const overlayBlob = await recordOverlayTimeline(target, cues, style, duration, {
    ...options,
    fps,
    offline: options.offline ?? true,
  });

  return {
    overlayBlob,
    durationSeconds: duration,
    fps,
  };
}

/**
 * Helper for Design Studio / dev testing.
 * Renders and returns a URL that can be played in a <video> element.
 */
export async function renderSubtitleOverlayForPreview(
  segments: TranscriptSegment[],
  style: SubtitleStyleConfig,
  durationSeconds: number,
  options?: Partial<SubtitleOverlayRenderOptions>,
): Promise<string> {
  const result = await renderSubtitleOverlay(segments, style, durationSeconds, {
    width: options?.width ?? 640,
    height: options?.height ?? 360,
    fps: options?.fps ?? 30,
    background: options?.background ?? 'transparent',
    offline: options?.offline ?? true,
    themeBarColor: options?.themeBarColor,
    singleFrameDebug: options?.singleFrameDebug,
    onFrameDebug: options?.onFrameDebug,
    ...options,
  });
  return URL.createObjectURL(result.overlayBlob);
}