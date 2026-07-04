/**
 * v5.3.4+ Canvas Overlay Subtitle Renderer (v5.3.5 cue-stable overlay caching)
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
import {
  buildCanvasOverlayHaloLayerSpecs,
  buildGlowLayerSpecs,
  canvasOverlayHaloMaxRingOffsetPx,
  CANVAS_HALO_UNDERPASS_OPACITY_BUDGET,
  canvasTextGradientWavePhase,
  createCanvasOverlayTextGradient,
  resolveCanvasOverlayGlowHex,
  resolveInnerBorderColor,
  resolveSubtitleEffectPalette,
} from '@/src/transcription/subtitle-effects';
import {
  loadSubtitleOverlayFonts,
  overlayCssFontFamily,
} from '@/src/transcription/subtitle-overlay-fonts';
import { prepareSegmentsForSubtitleBake } from '@/src/transcription/transcript-editing';
import { throwIfRenderAborted } from '@/src/transcription/canvas-render-perf-guard';
import {
  CUE_OVERLAY_CACHE_MAX_ENTRIES,
  CUE_OVERLAY_CACHE_PHASE_BUCKETS,
  CueOverlayCache,
  makeCueOverlayCacheKey,
  type CueOverlayCacheStats,
} from '@/src/transcription/subtitle-overlay-cue-cache';
import {
  DEFAULT_SUBTITLE_SPECIAL_HUE,
  type SubtitleGlowConfig,
  type SubtitleStyleConfig,
  type TranscriptSegment,
} from '@/src/transcription/types';
import { normalizeHexColor } from '@/src/theme/color-utils';
import {
  BAKE_FRAME_SAFE_PADDING_PX,
  buildCueRenderedSizeResult,
  classifyBackdropFrameFit,
  CUE_BACKDROP_BOX_BORDER_W,
  type CueRenderedSizeResult,
} from '@/src/transcription/subtitle-cue-measurement';

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
/** Shared glow-clip safety pad — sync with glowBleedInsetsPx side sums. */
const GLOW_BLEED_SAFETY_PX = 6;
/** Minimal frame rim inset — VP8 containment only; per-cue clip handles glow extent. */
const FRAME_EDGE_INSET_PX = 4;

function glowOpacityFactor(glow: SubtitleGlowConfig): number {
  return Math.max(0, Math.min(1, glow.opacity ?? 0.55));
}

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
  /** Bake progress — fired after each painted timeline frame (excludes tail hold frames). */
  onRenderProgress?: (info: { frameIndex: number; totalFrames: number; ratio: number }) => void;
  /** Abort between frames — used for user cancel + canvas render perf guard (Phase 5.3). */
  signal?: AbortSignal;
  /** v5.3.5: cache fully painted cue graphics; default true for bake. */
  enableCueCache?: boolean;
  /** v5.3.5: optional cache instrumentation. */
  debug?: {
    logCacheStats?: boolean;
    onCacheStats?: (stats: CueOverlayCacheStats) => void;
  };
  /**
   * v5.3.9 chunked parallel bake — capture only this global frame range.
   * Frames paint at (startFrame + i) / fps so animation phase, cue timing, and
   * cache keys are bit-identical to the serial render of the same global frame.
   * Sync: overlay-chunk-planner.ts PlannedOverlayChunk, subtitle-overlay-parallel.ts
   */
  timeRange?: { startFrame: number; frameCount: number };
  /** v5.3.9: per-chunk cue cache budget (parallelCueCacheMaxEntries). */
  cueCacheMaxEntries?: number;
}

/** Canvas capture metrics — v5.3.5 Overlay Lab timing logs. */
export interface SubtitleOverlayRenderMetrics {
  totalFrames: number;
  fps: number;
  /** Wall time for MediaRecorder capture loop (excludes FFmpeg finalize). */
  renderWallMs: number;
  msPerFrame: number;
  /** renderWallMs / (durationSeconds * 1000). */
  realtimeFactor: number;
  cueCache: CueOverlayCacheStats;
}

export interface SubtitleOverlayResult {
  /** The rendered overlay as a video Blob (webm or mp4) */
  overlayBlob: Blob;
  /** Duration of the rendered overlay in seconds */
  durationSeconds: number;
  /** Actual framerate used */
  fps: number;
  /** Populated after offline capture — used by Overlay Lab QA (v5.3.5). */
  renderMetrics?: SubtitleOverlayRenderMetrics;
}

interface RecordOverlayTimelineResult {
  overlayBlob: Blob;
  renderMetrics: SubtitleOverlayRenderMetrics;
}

/** Exported for the v5.3.9 parallel orchestrator (normalize once, chunk many). */
export interface NormalizedCue {
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

export function normalizeOverlaySegments(
  segments: TranscriptSegment[],
  durationSeconds: number,
): NormalizedCue[] {
  return prepareSegmentsForSubtitleBake(segments, durationSeconds).map((segment) => ({
    start: segment.start,
    end: segment.end,
    text: segment.text,
  }));
}

function cuesAtTimestamp(cues: NormalizedCue[], timestamp: number, durationSeconds: number): NormalizedCue[] {
  const isLastFrame = timestamp >= durationSeconds - 1e-6;
  return cues.filter((cue) => {
    if (timestamp < cue.start) return false;
    if (isLastFrame) return timestamp <= cue.end;
    return timestamp < cue.end;
  });
}

interface TempPaintSurface {
  paintCanvas: HTMLCanvasElement | OffscreenCanvas;
  paintCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
}

function createTempPaintSurface(width: number, height: number): TempPaintSurface {
  if (typeof OffscreenCanvas !== 'undefined') {
    const paintCanvas = new OffscreenCanvas(width, height);
    const paintCtx = paintCanvas.getContext('2d', { alpha: true });
    if (paintCtx) return { paintCanvas, paintCtx };
  }

  const paintCanvas = document.createElement('canvas');
  paintCanvas.width = width;
  paintCanvas.height = height;
  const paintCtx = paintCanvas.getContext('2d', { alpha: true });
  if (!paintCtx) {
    throw new Error('Canvas 2D context unavailable for cue overlay cache surface.');
  }
  return { paintCanvas, paintCtx };
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

interface CueInkMetrics {
  inkLeft: number;
  inkTop: number;
  inkWidth: number;
  inkHeight: number;
}

interface GlowBleedInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Font-scaled extra headroom above measured ink (caps/serifs/bold). */
function fontScaledCapBiasPx(fontSize: number): number {
  return Math.ceil(fontSize * 0.14);
}

/** Font-scaled extra room below measured ink (descenders). */
function fontScaledDescenderBiasPx(fontSize: number): number {
  return Math.ceil(fontSize * 0.06);
}

/** Font-scaled extra room at line start/end (wide glyphs, last-glyph halo tail). */
function fontScaledSideBiasPx(fontSize: number): number {
  return Math.ceil(fontSize * 0.1);
}

/**
 * Ink box from TextMetrics — textAlign center, textBaseline top.
 * Uses the larger of actual vs font bounding boxes so all DejaVu families behave consistently.
 */
function measureCueInkMetrics(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  anchorX: number,
  anchorY: number,
  fontSize: number,
): CueInkMetrics {
  const metrics = ctx.measureText(text);
  const fallbackW = metrics.width;
  const fallbackH = drawtextTextHeightPx(fontSize);
  const sidePad = Math.ceil(fontSize * 0.06);
  const left = (metrics.actualBoundingBoxLeft ?? fallbackW / 2) + sidePad;
  const right = (metrics.actualBoundingBoxRight ?? fallbackW / 2) + sidePad;
  const ascent = Math.max(
    metrics.actualBoundingBoxAscent ?? 0,
    metrics.fontBoundingBoxAscent ?? 0,
  );
  const descent = Math.max(
    metrics.actualBoundingBoxDescent ?? 0,
    metrics.fontBoundingBoxDescent ?? 0,
    fallbackH * 0.92,
  );

  return {
    inkLeft: anchorX - left,
    inkTop: anchorY - ascent,
    inkWidth: left + right,
    inkHeight: ascent + descent,
  };
}

/** Per-edge glow bleed beyond measured ink — drives per-cue clip (not a uniform frame inset). */
function glowBleedInsetsPx(style: SubtitleStyleConfig, fontSize: number): GlowBleedInsets {
  const uniform = 4;
  const glow = style.glow;
  if (glow?.enabled !== true) {
    return { top: uniform, right: uniform, bottom: uniform, left: uniform };
  }

  const spread = haloSpreadPx(glow);
  const mode = glow.mode ?? 'halo';
  const dualExtra = glow.dualBorder === true ? dualBorderStrokeExtentPx(fontSize) : 0;
  const ringExtent = canvasOverlayHaloMaxRingOffsetPx(glow);
  const capBias = fontScaledCapBiasPx(fontSize);
  const descBias = fontScaledDescenderBiasPx(fontSize);
  const sidePad = Math.ceil(fontSize * 0.06) + GLOW_BLEED_SAFETY_PX;

  const sideBias = fontScaledSideBiasPx(fontSize);
  const strokeHalf = Math.ceil(dualBorderOuterStrokeWidthPx(fontSize) / 2);

  if (mode === 'border') {
    const side = spread + ringExtent + dualExtra + sidePad;
    return {
      top: side + capBias + strokeHalf + 4,
      right: side + sideBias + strokeHalf + 4,
      bottom: side + descBias + 2,
      left: side + sideBias + strokeHalf + 4,
    };
  }

  const blur = haloShadowBlurPx(glow);
  // BUG FIX: halo clip tight on cap tops and line start/end (long-cue right edge)
  // Fix: symmetric horizontal bias matching vertical shadowBlur tail on all edges.
  const shadowPad = Math.ceil(blur * 1.25) + GLOW_BLEED_SAFETY_PX;
  const side = spread + ringExtent + shadowPad + dualExtra + sidePad;
  const topBias = Math.ceil(blur * 0.45) + capBias + 8;
  const bottomBias = Math.ceil(blur * 0.18) + descBias + 4;
  const horizontalBias = Math.ceil(blur * 0.38) + sideBias + 6;
  return {
    top: side + topBias,
    right: side + horizontalBias,
    bottom: side + bottomBias,
    left: side + horizontalBias,
  };
}

function cueGlowClipRectFromInk(
  ink: CueInkMetrics,
  insets: GlowBleedInsets,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  const left = ink.inkLeft - insets.left;
  const top = ink.inkTop - insets.top;
  const right = ink.inkLeft + ink.inkWidth + insets.right;
  const bottom = ink.inkTop + ink.inkHeight + insets.bottom;

  const x = Math.max(FRAME_EDGE_INSET_PX, Math.floor(left));
  const y = Math.max(FRAME_EDGE_INSET_PX, Math.floor(top));
  const x2 = Math.min(width - FRAME_EDGE_INSET_PX, Math.ceil(right));
  const y2 = Math.min(height - FRAME_EDGE_INSET_PX, Math.ceil(bottom));
  return { x, y, w: Math.max(1, x2 - x), h: Math.max(1, y2 - y) };
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
  ink: CueInkMetrics,
  style: SubtitleStyleConfig,
): void {
  const backdrop = style.backdrop;
  if (backdrop?.enabled === false) return;

  const blockX = Math.floor(ink.inkLeft - BACKDROP_BOX_BORDER_W);
  const blockY = Math.floor(ink.inkTop - BACKDROP_BOX_BORDER_W);
  const blockWidth = Math.ceil(ink.inkWidth + BACKDROP_BOX_BORDER_W * 2);
  const blockHeight = Math.ceil(ink.inkHeight + BACKDROP_BOX_BORDER_W * 2);
  const opacity = backdrop?.opacity ?? 0.72;
  const radius = backdrop?.borderRadius ?? 8;
  ctx.fillStyle = `rgba(0, 0, 0, ${opacity})`;
  fillRoundedRect(ctx, blockX, blockY, blockWidth, blockHeight, radius);
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
  const underpassBudget = baseOpacity * CANVAS_HALO_UNDERPASS_OPACITY_BUDGET;
  const blur = haloShadowBlurPx(glow);
  const darkGlow = (normalizeHexColor(glowHex) ?? glowHex) === '#000000';

  ctx.save();
  // BUG FIX: patchy/muddy canvas halo (black glow + dual border edge case)
  // Fix: budget-split underpass vs rings; lower dark-glow fill alpha so shadowBlur tapers
  //      smoothly without stacking opaque centre duplicates on top.
  ctx.shadowColor = hexToRgba(glowHex, Math.min(0.72, underpassBudget * 1.4));
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = hexToRgba(glowHex, 1);
  ctx.globalAlpha = darkGlow
    ? Math.min(0.2, underpassBudget * 0.65)
    : Math.min(0.36, underpassBudget * 1.05);
  ctx.fillText(text, x, y);
  ctx.restore();
  resetPaintContextState(ctx);
}

function resolveDualBorderInnerHex(outerHex: string, style: SubtitleStyleConfig): string {
  const glow = style.glow;
  const userChoseSpecialHue =
    style.textColor === 'special' ||
    glow?.colorSource === 'special' ||
    normalizeHexColor(style.specialHue ?? '') !==
      normalizeHexColor(DEFAULT_SUBTITLE_SPECIAL_HUE);
  return resolveInnerBorderColor(outerHex, userChoseSpecialHue ? style.specialHue : undefined);
}

function paintDualBorderStrokes(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  style: SubtitleStyleConfig,
  outerHex: string,
  fontSize: number,
  glow: SubtitleGlowConfig,
): void {
  const innerHex = resolveDualBorderInnerHex(outerHex, style);
  const outerWidth = dualBorderOuterStrokeWidthPx(fontSize);
  const innerWidth = dualBorderInnerStrokeWidthPx(fontSize);
  const strokeAlpha = glowOpacityFactor(glow);

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  // BUG FIX: glow strength slider ignored dual border strokes (halo + dual border QA)
  // Fix: scale stroke globalAlpha by glow.opacity — inner keyline and outer ring track slider.
  ctx.globalAlpha = strokeAlpha;
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
  glow: SubtitleGlowConfig,
): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.globalAlpha = glowOpacityFactor(glow);
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
    paintDualBorderStrokes(ctx, text, x, y, style, glowHex, fontSize, glow);
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
      glow,
    );
  }

  if (mode === 'halo') {
    // CHANGED: integral-normalized ring budget + shadowBlur core (v5.3.4 Phase 3.5.1 polish).
    // WHY: raw 'full' specs stack ~3× opacity at spread=2 and double-paint the core — patchy/muddy
    //      halos (especially black glow). Rings-only specs normalize to constant glow.opacity integral.
    // Sync: drawtext/burn-in still uses buildGlowLayerSpecs('single') in subtitle-burnin.ts
    paintHaloDiffusionUnderpass(ctx, text, x, y, glow, glowHex);
    paintGlowDuplicateLayers(
      ctx,
      text,
      x,
      y,
      buildCanvasOverlayHaloLayerSpecs(glow, fontSize),
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
  style: SubtitleStyleConfig,
  textHex: string,
  fontSize: number,
  timestampSeconds: number,
): void {
  if (style.textGradient === false) {
    ctx.fillStyle = textHex;
    ctx.fillText(text, x, y);
    return;
  }

  const textHeight = drawtextTextHeightPx(fontSize);
  const wavePhase =
    style.textGradientWave === true ? canvasTextGradientWavePhase(timestampSeconds) : undefined;
  ctx.fillStyle = createCanvasOverlayTextGradient(ctx, x, y, textHeight, textHex, wavePhase);
  ctx.fillText(text, x, y);
}

/**
 * Backdrop plate bounds — authoritative LONG / bake overflow (not glow bleed or split budget).
 * BUG FIX: false LONG badge at bake resolution
 * Fix: measure at bake width; overflow = backdrop plate past frame safe inset only.
 */
function computeCueBakeFitExtent(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  style: SubtitleStyleConfig,
  width: number,
  height: number,
) {
  const fontSize = style.fontSize ?? 22;
  const fontFamily = overlayCssFontFamily(style.fontFamily);
  ctx.font = `normal ${fontSize}px ${fontFamily}, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const textX = Math.round(drawtextXpx(width));
  const textY = Math.round(drawtextYpx(style.position, fontSize, height));
  const ink = measureCueInkMetrics(ctx, text, textX, textY, fontSize);

  const backdropEnabled = style.backdrop?.enabled !== false;
  const borderW = backdropEnabled ? CUE_BACKDROP_BOX_BORDER_W : 4;
  const backdropLeft = ink.inkLeft - borderW;
  const backdropRight = ink.inkLeft + ink.inkWidth + borderW;
  const comfortMarginPx = Math.min(backdropLeft, width - backdropRight);

  return classifyBackdropFrameFit(
    backdropLeft,
    backdropRight,
    width,
    BAKE_FRAME_SAFE_PADDING_PX,
    comfortMarginPx,
  );
}

export type { CueRenderedSizeResult };

export interface MeasureCueRenderedSizeInput {
  text: string;
  style: SubtitleStyleConfig;
  width: number;
  height: number;
  themeBarColor?: string;
  /** Representative animation phase — fixed 0 for width checks (roadmap §3.2). */
  timestampSeconds?: number;
}

/**
 * Real-canvas cue measurement — reuses paintCue without MediaRecorder (Phase 1).
 * WHY: authoritative LONG badge / Smart Adjust once heuristic marginal band triggers.
 */
export async function measureCueRenderedSize(
  input: MeasureCueRenderedSizeInput,
): Promise<CueRenderedSizeResult> {
  const {
    text,
    style,
    width,
    height,
    themeBarColor = DEFAULT_THEME_BAR,
    timestampSeconds = 0,
  } = input;

  await ensureOverlayFonts();

  const cue: NormalizedCue = { start: 0, end: 1, text };
  const surface = createTempPaintSurface(width, height);
  clearFrame(surface.paintCtx, width, height, 'transparent');
  paintCue(surface.paintCtx, cue, style, width, height, themeBarColor, timestampSeconds);

  const fit = computeCueBakeFitExtent(surface.paintCtx, text, style, width, height);
  return buildCueRenderedSizeResult(fit, width, 1);
}

function paintCue(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  cue: NormalizedCue,
  style: SubtitleStyleConfig,
  width: number,
  height: number,
  themeBarColor: string,
  timestampSeconds: number,
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
  const textX = Math.round(centerX);
  const textY = Math.round(textTopY);
  const ink = measureCueInkMetrics(ctx, cue.text, textX, textY, fontSize);

  paintBackdropPlate(ctx, ink, style);

  if (style.glow?.enabled === true) {
    // BUG FIX: halo clip artifacts above cap glyphs (T/F/D/Z; serif/bold worst)
    // Fix: ink-box clip from TextMetrics + asymmetric bleed (extra top for shadowBlur);
    //      clip glow passes only — main text/gradient paints outside the clip.
    const insets = glowBleedInsetsPx(style, fontSize);
    const clipRect = cueGlowClipRectFromInk(ink, insets, width, height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(clipRect.x, clipRect.y, clipRect.w, clipRect.h);
    ctx.clip();
    const glowHex = resolveCanvasOverlayGlowHex(style, themeBarColor, timestampSeconds);
    paintGlowText(ctx, cue.text, textX, textY, style, glowHex);
    ctx.restore();
    resetPaintContextState(ctx);
  } else {
    const glowHex = resolveCanvasOverlayGlowHex(style, themeBarColor, timestampSeconds);
    paintGlowText(ctx, cue.text, textX, textY, style, glowHex);
    resetPaintContextState(ctx);
  }
  paintMainText(ctx, cue.text, textX, textY, style, palette.textHex, fontSize, timestampSeconds);
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

function shouldUseCueOverlayCache(options: SubtitleOverlayRenderOptions): boolean {
  if (options.enableCueCache === false) return false;
  if (options.singleFrameDebug === true) return false;
  return true;
}

function scheduleCueCacheBitmap(
  cache: CueOverlayCache,
  key: string,
  surface: TempPaintSurface,
): void {
  const source = surface.paintCanvas;
  void createImageBitmap(source)
    .then((bitmap) => {
      cache.set(key, bitmap);
    })
    .catch(() => {
      // Drop failed cache population — next frame repaints synchronously.
    });
}

function paintCueWithCache(
  cache: CueOverlayCache,
  target: RenderTarget,
  cue: NormalizedCue,
  style: SubtitleStyleConfig,
  options: SubtitleOverlayRenderOptions,
  timestamp: number,
): void {
  const { width, height } = options;
  const themeBarColor = options.themeBarColor ?? DEFAULT_THEME_BAR;
  const key = makeCueOverlayCacheKey(cue, style, themeBarColor, timestamp);
  const bitmap = cache.get(key);

  if (!bitmap) {
    // BUG FIX: v5.3.5 cue-cache bake subtitle drift
    // Fix: cache miss paints + blits synchronously; populate ImageBitmap in the
    //      background. Awaiting createImageBitmap stretched MediaRecorder frame
    //      delivery and accumulated A/V desync (worse per cue on cache misses).
    const temp = createTempPaintSurface(width, height);
    clearFrame(temp.paintCtx, width, height, 'transparent');
    paintCue(temp.paintCtx, cue, style, width, height, themeBarColor, timestamp);
    target.paintCtx.drawImage(temp.paintCanvas, 0, 0);
    scheduleCueCacheBitmap(cache, key, temp);
    return;
  }

  target.paintCtx.drawImage(bitmap, 0, 0);
}

function paintFrame(
  target: RenderTarget,
  cues: NormalizedCue[],
  style: SubtitleStyleConfig,
  options: SubtitleOverlayRenderOptions,
  timestamp: number,
  durationSeconds: number,
  cueCache?: CueOverlayCache,
): void {
  const { width, height } = options;
  const themeBarColor = options.themeBarColor ?? DEFAULT_THEME_BAR;
  const background = options.background ?? 'transparent';

  clearFrame(target.paintCtx, width, height, background);

  const active = cuesAtTimestamp(cues, timestamp, durationSeconds);
  const useCache = cueCache !== undefined && shouldUseCueOverlayCache(options);

  if (useCache) {
    for (const cue of active) {
      paintCueWithCache(cueCache, target, cue, style, options, timestamp);
    }
  } else {
    for (const cue of active) {
      paintCue(target.paintCtx, cue, style, width, height, themeBarColor, timestamp);
    }
  }

  target.blitToCapture();
}

/** Target wall-clock spacing between captured overlay frames. */
export function frameCaptureIntervalMs(fps: number): number {
  return Math.max(4, Math.ceil(1000 / fps));
}

/**
 * Remaining wait after paint so total frame period matches 1/fps.
 * BUG FIX: v5.3.5 cue-cache bake subtitle drift — Sync: paintAndCapture loop below.
 */
export function compensatedCaptureWaitMs(fps: number, paintElapsedMs: number): number {
  return Math.max(0, frameCaptureIntervalMs(fps) - paintElapsedMs);
}

async function waitForCompensatedCaptureTick(
  fps: number,
  paintElapsedMs: number,
  singleFrameDebug: boolean,
): Promise<void> {
  // Single-frame debug already pauses long enough for MediaRecorder to ingest frames.
  if (singleFrameDebug) return;
  const waitMs = compensatedCaptureWaitMs(fps, paintElapsedMs);
  if (waitMs <= 0) return;
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, waitMs);
  });
}

async function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png');
  });
}

function buildDisabledCueCacheStats(): CueOverlayCacheStats {
  return {
    enabled: false,
    phaseBuckets: CUE_OVERLAY_CACHE_PHASE_BUCKETS,
    maxEntries: CUE_OVERLAY_CACHE_MAX_ENTRIES,
    hits: 0,
    misses: 0,
    lookups: 0,
    creates: 0,
    evictions: 0,
    uniqueKeys: 0,
    hitRate: 0,
  };
}

async function recordOverlayTimeline(
  target: RenderTarget,
  cues: NormalizedCue[],
  style: SubtitleStyleConfig,
  durationSeconds: number,
  options: SubtitleOverlayRenderOptions,
): Promise<RecordOverlayTimelineResult> {
  const fps = Math.max(1, options.fps);
  // CHANGED: v5.3.9 — timeRange captures an exact global frame window (no ceil drift).
  // WHY: chunked parallel bake must partition ceil(duration*fps) frames precisely.
  const range = options.timeRange;
  const startFrame = range?.startFrame ?? 0;
  const totalFrames = range
    ? Math.max(1, range.frameCount)
    : Math.max(1, Math.ceil(durationSeconds * fps));
  const mimeType = pickOverlayMimeType();
  const singleFrameDebug = options.singleFrameDebug === true;
  const cacheEnabled = shouldUseCueOverlayCache(options);
  const cueCache = cacheEnabled ? new CueOverlayCache(options.cueCacheMaxEntries) : undefined;
  const renderStartedAt = performance.now();
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
        throwIfRenderAborted(options.signal);
        await new Promise<void>((r) => {
          window.setTimeout(() => r(), RECORDER_WARMUP_MS);
        });

        const paintAndCapture = async (timestamp: number, frameIndex: number): Promise<void> => {
          throwIfRenderAborted(options.signal);
          const paintStartedAt = performance.now();
          paintFrame(target, cues, style, options, timestamp, durationSeconds, cueCache);
          const paintElapsedMs = performance.now() - paintStartedAt;

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
            await waitForCompensatedCaptureTick(fps, paintElapsedMs, singleFrameDebug);
          }
        };

        for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
          throwIfRenderAborted(options.signal);
          // Global timestamp: identical expression to the serial render for the same
          // global frame — keeps animation phase + cache keys chunk-invariant (v5.3.9).
          await paintAndCapture((startFrame + frameIndex) / fps, frameIndex);
          options.onRenderProgress?.({
            frameIndex: frameIndex + 1,
            totalFrames,
            ratio: (frameIndex + 1) / totalFrames,
          });
        }

        // Hold the final empty frame so duration metadata is written before stop().
        for (let tail = 0; tail < RECORDER_TAIL_FRAME_COUNT; tail += 1) {
          const paintStartedAt = performance.now();
          paintFrame(target, [], style, options, durationSeconds, durationSeconds, cueCache);
          await waitForCompensatedCaptureTick(fps, performance.now() - paintStartedAt, false);
        }

        await new Promise<void>((r) => {
          window.setTimeout(() => r(), RECORDER_FLUSH_MS);
        });

        if (recorder.state === 'recording') {
          recorder.requestData();
          recorder.stop();
        }
      } catch (error) {
        cueCache?.clear();
        if (recorder.state === 'recording') recorder.stop();
        reject(error);
      }
    })();
  });

  for (const track of stream.getVideoTracks()) {
    track.stop();
  }

  const renderWallMs = Math.round(performance.now() - renderStartedAt);
  const cueCacheStats = cueCache?.stats(true) ?? buildDisabledCueCacheStats();

  if (options.debug?.logCacheStats) {
    console.info('[subtitle-overlay] cue cache stats', cueCacheStats);
  }
  options.debug?.onCacheStats?.(cueCacheStats);

  cueCache?.clear();

  const blobType = mimeType ?? 'video/webm';
  const overlayBlob = new Blob(chunks, { type: blobType });
  if (overlayBlob.size === 0) {
    throw new Error('Subtitle overlay capture produced an empty video blob.');
  }

  // v5.3.9: chunk captures rate against the captured window, not the full clip.
  const capturedSeconds = range ? totalFrames / fps : durationSeconds;
  const renderMetrics: SubtitleOverlayRenderMetrics = {
    totalFrames,
    fps,
    renderWallMs,
    msPerFrame: totalFrames > 0 ? renderWallMs / totalFrames : 0,
    realtimeFactor: capturedSeconds > 0 ? renderWallMs / (capturedSeconds * 1000) : 0,
    cueCache: cueCacheStats,
  };

  return { overlayBlob, renderMetrics };
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
  const { overlayBlob: rawBlob, renderMetrics } = await recordOverlayTimeline(target, cues, style, duration, {
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
    renderMetrics,
  };
}

export interface CaptureOverlayChunkInput {
  /** Pre-normalized global cues — normalizeOverlaySegments output (normalize once). */
  cues: NormalizedCue[];
  style: SubtitleStyleConfig;
  /** Full clip duration (global) — drives last-frame cue semantics. */
  globalDurationSeconds: number;
  /** Must include timeRange; finalize is skipped (concat step owns remux). */
  options: SubtitleOverlayRenderOptions;
}

/**
 * v5.3.9 — capture one planned chunk as a raw MediaRecorder WebM (no FFmpeg
 * finalize). Runs concurrently with sibling chunks: the paced capture loop is
 * ~90% idle wait, so N chunks multiplex on one thread for ~N× render speedup.
 * Sync: subtitle-overlay-parallel.ts (orchestration), overlay-chunk-concat.ts (stitch)
 */
export async function captureOverlayChunkRaw(
  input: CaptureOverlayChunkInput,
): Promise<{ overlayBlob: Blob; renderMetrics: SubtitleOverlayRenderMetrics }> {
  if (!input.options.timeRange) {
    throw new Error('captureOverlayChunkRaw requires options.timeRange.');
  }
  await ensureOverlayFonts();
  const target = createRenderTarget(input.options.width, input.options.height);
  return recordOverlayTimeline(
    target,
    input.cues,
    input.style,
    input.globalDurationSeconds,
    { ...input.options, fps: Math.max(1, input.options.fps), offline: input.options.offline ?? true },
  );
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