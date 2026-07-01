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

import { finalizeOverlayWebm } from '@/src/ffmpeg/overlay-webm-finalize';
import { normalizeHexColor } from '@/src/theme/color-utils';
import {
  buildGlowLayerSpecs,
  resolveContrastingBorderColor,
  resolveSubtitleEffectPalette,
} from '@/src/transcription/subtitle-effects';
import {
  loadSubtitleOverlayFonts,
  overlayCssFontFamily,
} from '@/src/transcription/subtitle-overlay-fonts';
import { cueTextIsBlank, stripScaffoldPlaceholder } from '@/src/transcription/transcript-editing';
import type {
  SubtitleGlowConfig,
  SubtitleStyleConfig,
  TranscriptSegment,
} from '@/src/transcription/types';

const DEFAULT_THEME_BAR = '#00e5ff';
const OVERLAY_VIDEO_BPS = 1_500_000;
const SINGLE_FRAME_DEBUG_PAUSE_MS = 180;
/** Wall-clock pacing so MediaRecorder receives encodable canvas frames. */
const RECORDER_WARMUP_MS = 50;
const RECORDER_FLUSH_MS = 800;
/** Extra empty tail frames so MediaRecorder writes duration/cluster metadata. */
const RECORDER_TAIL_FRAME_COUNT = 3;
/** Sync: subtitle-burnin.ts buildBackdropBoxOpt boxborderw=12 */
const BACKDROP_BOX_BORDER_W = 12;

function dualBorderOuterStrokeWidthPx(fontSize: number): number {
  return Math.max(4, Math.round(fontSize * 0.18));
}

function dualBorderInnerStrokeWidthPx(fontSize: number): number {
  return Math.max(2, Math.round(fontSize * 0.1));
}

function dualBorderStrokeExtentPx(fontSize: number): number {
  return Math.ceil(dualBorderOuterStrokeWidthPx(fontSize) / 2) + 2;
}

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
  /** When false, skip FFmpeg remux (dev only). Default true. */
  finalizeWebm?: boolean;
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

async function ensureOverlayFonts(): Promise<void> {
  await loadSubtitleOverlayFonts();
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
          // BUG FIX: VP8 overlay edge color bleed (v5.3.4 QA)
          // Fix: replace — don't alpha-blend — when copying the offscreen paint buffer;
          //      source-over left prior-frame glow pixels at the canvas rim after encode.
          captureCtx.globalCompositeOperation = 'copy';
          captureCtx.drawImage(paintCanvas, 0, 0);
          captureCtx.globalCompositeOperation = 'source-over';
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

/** Mirrors subtitle-burnin.ts drawtextY — margin + text_h positioning. */
function drawtextMarginPx(fontSize: number): number {
  return Math.max(16, Math.round(fontSize * 0.9));
}

/** FFmpeg drawtext text_h proxy for single-line DejaVu cues. */
function drawtextTextHeightPx(fontSize: number): number {
  return fontSize;
}

function drawtextYpx(
  position: SubtitleStyleConfig['position'],
  fontSize: number,
  canvasHeight: number,
): number {
  const margin = drawtextMarginPx(fontSize);
  const textHeight = drawtextTextHeightPx(fontSize);
  if (position === 'top') return margin;
  if (position === 'center') return Math.round((canvasHeight - textHeight) / 2);
  return canvasHeight - textHeight - margin;
}

/** Mirrors subtitle-burnin.ts drawtextX(0) — centered caption anchor. */
function drawtextXpx(canvasWidth: number): number {
  return canvasWidth / 2;
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

function haloSpreadPx(glow: SubtitleGlowConfig): number {
  return Math.max(1, Math.min(3, Math.round(glow.blurRadius ?? 2)));
}

/** Canvas-only halo diffusion radius — no FFmpeg layer budget on this path. */
function haloShadowBlurPx(glow: SubtitleGlowConfig): number {
  return 6 + haloSpreadPx(glow) * 5;
}

function glowSafeInset(style: SubtitleStyleConfig, fontSize: number): number {
  const glow = style.glow;
  if (glow?.enabled !== true) return 4;
  const spread = haloSpreadPx(glow);
  const mode = glow.mode ?? 'halo';
  const dualExtra = glow.dualBorder === true ? dualBorderStrokeExtentPx(fontSize) : 0;
  if (mode === 'border') return Math.max(4, spread + 2 + dualExtra);
  // CHANGED: halo inset accounts for multi-ring 'full' spread + shadowBlur underpass (v5.3.4 Phase 3.5.1).
  // WHY: softer canvas halo extends farther than the old single-ring duplicate layers.
  const shadowExtent = Math.ceil(haloShadowBlurPx(glow) * 0.85);
  return Math.max(12, spread + shadowExtent + 4 + dualExtra);
}

function resetPaintContextState(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
): void {
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
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
  textTopY: number,
  style: SubtitleStyleConfig,
  fontSize: number,
): void {
  const textWidth = ctx.measureText(text).width;
  const textHeight = drawtextTextHeightPx(fontSize);
  const blockWidth = textWidth + BACKDROP_BOX_BORDER_W * 2;
  const blockHeight = textHeight + BACKDROP_BOX_BORDER_W * 2;
  const blockX = Math.round(centerX - blockWidth / 2);
  const blockY = textTopY - BACKDROP_BOX_BORDER_W;

  const backdrop = style.backdrop;
  if (backdrop?.enabled !== false) {
    const opacity = backdrop?.opacity ?? 0.72;
    const radius = backdrop?.borderRadius ?? 8;
    ctx.fillStyle = `rgba(0, 0, 0, ${opacity})`;
    fillRoundedRect(ctx, blockX, blockY, blockWidth, blockHeight, radius);
  }
}

function paintHaloDiffusionUnderpass(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  glow: SubtitleGlowConfig,
  glowHex: string,
): void {
  const baseOpacity = glow.opacity ?? 0.55;
  const blur = haloShadowBlurPx(glow);

  ctx.save();
  ctx.shadowColor = hexToRgba(glowHex, Math.min(1, baseOpacity * 0.65));
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = hexToRgba(glowHex, 1);
  ctx.globalAlpha = Math.min(0.42, baseOpacity * 0.55);
  ctx.fillText(text, x, y);
  ctx.restore();
  resetPaintContextState(ctx);
}

function resolveDualBorderInnerHex(outerHex: string, style: SubtitleStyleConfig): string {
  const outer = normalizeHexColor(outerHex) ?? '#ffffff';
  const glow = style.glow;
  const usesSpecial =
    style.textColor === 'special' || glow?.colorSource === 'special';
  if (usesSpecial) {
    const special = normalizeHexColor(style.specialHue ?? '');
    if (special && special !== outer) return special;
  }
  const contrasting = resolveContrastingBorderColor(outer);
  if (contrasting !== outer) return contrasting;
  return outer === '#000000' ? '#ffffff' : '#000000';
}

function paintDualBorderStrokes(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  style: SubtitleStyleConfig,
  outerHex: string,
  fontSize: number,
): void {
  const innerHex = resolveDualBorderInnerHex(outerHex, style);
  const outerWidth = dualBorderOuterStrokeWidthPx(fontSize);
  const innerWidth = dualBorderInnerStrokeWidthPx(fontSize);

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.globalAlpha = 1;
  // BUG FIX: dual border invisible / VP8 dot artifacts (Phase 3.5.2 QA)
  // Fix: font-scaled strokeText (outer wide, inner narrow) replaces 1–2px fillText offset
  //      rings that collapsed to sparse fragments on transparent WebM.
  ctx.strokeStyle = hexToRgba(outerHex, 1);
  ctx.lineWidth = outerWidth;
  ctx.strokeText(text, x, y);
  ctx.strokeStyle = hexToRgba(innerHex, 1);
  ctx.lineWidth = innerWidth;
  ctx.strokeText(text, x, y);
  ctx.restore();
  resetPaintContextState(ctx);
}

function paintDualBorderInnerStroke(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  innerHex: string,
  fontSize: number,
): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.globalAlpha = 1;
  ctx.strokeStyle = hexToRgba(innerHex, 1);
  ctx.lineWidth = dualBorderInnerStrokeWidthPx(fontSize);
  ctx.strokeText(text, x, y);
  ctx.restore();
  resetPaintContextState(ctx);
}

function paintGlowDuplicateLayers(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  specs: ReturnType<typeof buildGlowLayerSpecs>,
  glowHex: string,
): void {
  ctx.fillStyle = hexToRgba(glowHex, 1);

  for (const spec of specs) {
    ctx.save();
    ctx.globalAlpha = spec.opacity;
    ctx.fillText(
      text,
      Math.round(x + spec.offsetX),
      Math.round(y + spec.offsetY),
    );
    ctx.restore();
  }
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

  const fontSize = style.fontSize ?? 22;
  const mode = glow.mode ?? 'halo';
  const dualBorder = glow.dualBorder === true;

  if (dualBorder && mode === 'border') {
    // CHANGED: canvas dual contrasting border — stroke-based two-tone outline (v5.3.4 Phase 3.5.2).
    // WHY: pro styling; not ported to drawtext (layer explosion).
    paintDualBorderStrokes(ctx, text, x, y, style, glowHex, fontSize);
    return;
  }

  if (dualBorder && mode === 'halo') {
    paintDualBorderInnerStroke(
      ctx,
      text,
      x,
      y,
      resolveDualBorderInnerHex(glowHex, style),
      fontSize,
    );
  }

  if (mode === 'halo') {
    // CHANGED: canvas halo uses lush multi-ring + shadowBlur underpass (v5.3.4 Phase 3.5.1).
    // WHY: 'single' ring matched drawtext but reads too sharp; canvas has no layer budget.
    // Sync: drawtext/burn-in still uses 'single' in subtitle-burnin.ts; preview uses 'single' in subtitle-preview.ts
    paintHaloDiffusionUnderpass(ctx, text, x, y, glow, glowHex);
    paintGlowDuplicateLayers(
      ctx,
      text,
      x,
      y,
      buildGlowLayerSpecs(glow, fontSize, 'full'),
      glowHex,
    );
    return;
  }

  // Border mode: fixed 8-neighbour ring (ringMode ignored by buildGlowLayerSpecs).
  // BUG FIX: canvas border glow jagged/bleeding vs drawtext
  // Fix: duplicate offset fillText layers — same path as drawtext-glow tier.
  // Sync: subtitle-preview.ts drawSubtitlePreview(), subtitle-effects.ts buildGlowLayerSpecs
  paintGlowDuplicateLayers(
    ctx,
    text,
    x,
    y,
    buildGlowLayerSpecs(glow, fontSize, 'single'),
    glowHex,
  );
}

function paintMainText(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  _style: SubtitleStyleConfig,
  textHex: string,
): void {
  void _style;
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
  const palette = resolveSubtitleEffectPalette(style, themeBarColor);

  ctx.save();
  ctx.font = `normal ${fontSize}px ${fontFamily}, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const centerX = drawtextXpx(width);
  const textTopY = drawtextYpx(style.position, fontSize, height);

  paintBackdropPlate(ctx, cue.text, centerX, textTopY, style, fontSize);

  const inset = glowSafeInset(style, fontSize);
  ctx.save();
  ctx.beginPath();
  ctx.rect(inset, inset, width - inset * 2, height - inset * 2);
  ctx.clip();
  const textX = Math.round(centerX);
  const textY = Math.round(textTopY);
  paintGlowText(ctx, cue.text, textX, textY, style, palette.glowHex);
  resetPaintContextState(ctx);
  paintMainText(ctx, cue.text, textX, textY, style, palette.textHex);
  ctx.restore();
  ctx.restore();
}

function clearFrame(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  background: string | 'transparent',
): void {
  ctx.clearRect(0, 0, width, height);
  resetPaintContextState(ctx);
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

function frameCaptureIntervalMs(fps: number): number {
  return Math.max(4, Math.ceil(1000 / fps));
}

async function waitForNextCaptureTick(
  fps: number,
  singleFrameDebug: boolean,
): Promise<void> {
  // Single-frame debug already pauses long enough for MediaRecorder to ingest frames.
  if (singleFrameDebug) return;
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, frameCaptureIntervalMs(fps));
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
  const singleFrameDebug = options.singleFrameDebug === true;
  // BUG FIX: regular dev harness produced empty overlay.webm (Phase 2 QA)
  // Fix: captureStream(fps) + wall-clock frame pacing — MediaRecorder cannot encode
  //      when frames are painted in a tight microtask loop (~164ms total); single-frame
  //      debug worked only because its 180ms pause gave the encoder time to run.
  const stream = target.captureCanvas.captureStream(fps);

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

    // No timeslice — one clean cluster chain; timesliced blobs often lack seek Cues.
    recorder.start();

    void (async () => {
      try {
        await new Promise<void>((r) => {
          window.setTimeout(() => r(), RECORDER_WARMUP_MS);
        });

        const paintAndCapture = async (timestamp: number, frameIndex: number): Promise<void> => {
          paintFrame(target, cues, style, options, timestamp, durationSeconds);

          if (singleFrameDebug && options.onFrameDebug) {
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
          } else {
            await waitForNextCaptureTick(fps, singleFrameDebug);
          }
        };

        for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
          await paintAndCapture(frameIndex / fps, frameIndex);
        }

        // Hold the final empty frame so duration metadata is written before stop().
        for (let tail = 0; tail < RECORDER_TAIL_FRAME_COUNT; tail += 1) {
          paintFrame(target, [], style, options, durationSeconds, durationSeconds);
          await waitForNextCaptureTick(fps, false);
        }

        await new Promise<void>((r) => {
          window.setTimeout(() => r(), RECORDER_FLUSH_MS);
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
  const rawBlob = await recordOverlayTimeline(target, cues, style, duration, {
    ...options,
    fps,
    offline: options.offline ?? true,
  });

  const shouldFinalize = options.finalizeWebm !== false;
  const overlayBlob = shouldFinalize ? await finalizeOverlayWebm(rawBlob, fps) : rawBlob;

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