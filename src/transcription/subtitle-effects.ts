import {
  deriveGlowColor,
  hexToHsv,
  hexToRgb,
  hsvToHex,
  normalizeHexColor,
} from '@/src/theme/color-utils';
import {
  DEFAULT_SUBTITLE_SPECIAL_HUE,
  DEFAULT_SUBTITLE_HUE_ROTATE_SPEED,
  type SubtitleGlowColorSource,
  type SubtitleGlowConfig,
  type SubtitleGlowHueRotateMode,
  type SubtitleStyleConfig,
} from '@/src/transcription/types';

// CHANGED: split drawtext helpers vs canvas-overlay-only exports (v5.3.4)
// WHY: drawtext uses buildGlowLayerSpecs / resolveGlowColorHex; canvas uses resolveCanvasOverlayGlowHex,
//      halo integral rings, text gradient — see subtitleStyleHasCanvasOnlyEffects in subtitle-burnin.ts.
// Sync: subtitle-overlay-renderer.ts paint paths; docs/transcription-architecture.md § Canvas overlay path

export interface GlowLayerSpec {
  fontSize: number;
  offsetX: number;
  offsetY: number;
  opacity: number;
}

/**
 * Glow ring density for the soft halo. The preview uses 'full' (lush multi-ring
 * gradient); the burn-in uses cheaper rings so the drawtext filtergraph stays
 * under ffmpeg.wasm's ceiling for multi-cue clips (see subtitle-burnin.ts):
 *  - 'full'   — centre + up-to-3 concentric rings (≈9–25 layers) — preview only
 *  - 'single' — centre + one 8-neighbour ring at the blur offset (9 layers)
 *  - 'min'    — one 4-neighbour ring at the blur offset (4 layers)
 * Border mode ignores this (always its fixed 8-neighbour ring).
 */
export type GlowRingMode = 'full' | 'single' | 'min';

/** sRGB relative luminance — picks dark vs light monochromatic keyline. */
function hexRelativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0.5;
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(rgb.r);
  const g = channel(rgb.g);
  const b = channel(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function monochromaticKeylineHex(outerHex: string): string {
  const normalized = normalizeHexColor(outerHex) ?? '#ffffff';
  if (normalized === '#000000') return '#e8e8e8';
  if (normalized === '#ffffff') return '#1a1a1a';

  const hsv = hexToHsv(normalized);
  if (!hsv) return '#1a1a1a';

  const luminance = hexRelativeLuminance(normalized);
  // HSV value catches saturated reds/blues that sRGB luminance underrates as "dark".
  const useDarkKeyline = hsv.v >= 48 || luminance >= 0.45;
  const hueShift = useDarkKeyline ? 8 : -8;
  const hue = (hsv.h + hueShift + 360) % 360;

  if (useDarkKeyline) {
    const saturation = Math.max(8, Math.min(24, hsv.s * 0.2 + 6));
    const value = Math.max(12, Math.min(20, 17 - (hsv.v > 72 ? 3 : 0)));
    return hsvToHex(hue, saturation, value);
  }

  const saturation = Math.max(4, Math.min(16, hsv.s * 0.12 + 4));
  const value = Math.max(86, Math.min(93, 90 + (hsv.v < 22 ? 2 : 0)));
  return hsvToHex(hue, saturation, value);
}

function clampSpecialHueForKeyline(specialHex: string, outerHex: string): string {
  const special = normalizeHexColor(specialHex);
  const outer = normalizeHexColor(outerHex);
  if (!special || !outer || special === outer) {
    return monochromaticKeylineHex(outerHex);
  }

  const outerLum = hexRelativeLuminance(outer);
  const specialHsv = hexToHsv(special);
  if (!specialHsv) return monochromaticKeylineHex(outerHex);

  const outerHsv = hexToHsv(outer);
  const useDarkKeyline = (outerHsv?.v ?? 0) >= 48 || outerLum >= 0.45;
  const specialLum = hexRelativeLuminance(special);

  if (useDarkKeyline) {
    if (specialLum >= 0.42) {
      return hsvToHex(
        specialHsv.h,
        Math.min(specialHsv.s, 42),
        Math.max(12, Math.min(24, specialHsv.v * 0.32)),
      );
    }
    return hsvToHex(
      specialHsv.h,
      Math.min(specialHsv.s, 52),
      Math.max(10, Math.min(28, specialHsv.v)),
    );
  }

  if (specialLum <= 0.38) {
    return hsvToHex(
      specialHsv.h,
      Math.min(specialHsv.s, 32),
      Math.max(84, Math.min(93, specialHsv.v * 1.2 + 48)),
    );
  }
  return hsvToHex(
    specialHsv.h,
    Math.min(specialHsv.s, 40),
    Math.max(84, Math.min(94, specialHsv.v)),
  );
}

/**
 * Inner dual-border keyline — monochromatic dark/light definition, not complementary RGB.
 * Canvas overlay only (v5.3.4 Phase 3.5.2).
 */
export function resolveInnerBorderColor(baseHex: string, specialHue?: string): string {
  const special = specialHue ? normalizeHexColor(specialHue) : null;
  const outer = normalizeHexColor(baseHex) ?? '#ffffff';
  if (special && special !== outer) {
    return clampSpecialHueForKeyline(special, outer);
  }
  return monochromaticKeylineHex(outer);
}

export function resolveGlowColorHex(
  source: SubtitleGlowColorSource | undefined,
  themeBarColor: string,
  specialHue?: string,
): string {
  if (source === 'rainbow') {
    // Canvas overlay uses resolveCanvasOverlayGlowHex; drawtext/preview fall back to theme.
    return resolveGlowColorHex('theme', themeBarColor, specialHue);
  }
  if (source === 'black') return '#000000';
  if (source === 'white') return '#ffffff';
  if (source === 'special') {
    // BUG FIX: undefined arg to normalizeHexColor when specialHue is not set
    // Fix: guard argument with ?? so normalizeHexColor always receives a string; keep result fallback for invalid hex
    return normalizeHexColor(specialHue ?? DEFAULT_SUBTITLE_SPECIAL_HUE) ?? DEFAULT_SUBTITLE_SPECIAL_HUE;
  }
  const bar = normalizeHexColor(themeBarColor) ?? '#00e5ff';
  const derived = deriveGlowColor(bar);
  return derived.slice(0, 7);
}

function resolveCanvasOverlayRainbowGlowHex(
  hueRotateMode: SubtitleGlowHueRotateMode,
  themeBarColor: string,
  specialHue: string | undefined,
  timestampSeconds: number,
  hueRotateSpeed: number,
): string {
  const speed = Math.max(1, hueRotateSpeed);
  const hue = ((timestampSeconds * speed) % 360 + 360) % 360;

  if (hueRotateMode === 'rainbow') {
    return hsvToHex(hue, 82, 92);
  }

  const baseHex = resolveGlowColorHex('theme', themeBarColor, specialHue);
  const baseHsv = hexToHsv(baseHex);
  if (!baseHsv) return baseHex;

  const t = (hue / 360) * Math.PI * 2;
  const value = Math.max(38, Math.min(100, baseHsv.v + 16 * Math.sin(t)));
  const saturation = Math.max(20, Math.min(100, baseHsv.s * (0.78 + 0.22 * Math.cos(t))));
  return hsvToHex(baseHsv.h, saturation, value);
}

/**
 * Per-frame glow hex for canvas overlay — static sources or hue-rotate (v5.3.4 Phase 3.5.5).
 */
export function resolveCanvasOverlayGlowHex(
  style: SubtitleStyleConfig,
  themeBarColor: string,
  timestampSeconds: number,
): string {
  const glow = style.glow;
  const source = glow?.colorSource;
  if (source !== 'rainbow') {
    return resolveGlowColorHex(source, themeBarColor, style.specialHue);
  }

  const mode = glow?.hueRotateMode ?? 'rainbow';
  const speed = glow?.hueRotateSpeed ?? DEFAULT_SUBTITLE_HUE_ROTATE_SPEED;
  return resolveCanvasOverlayRainbowGlowHex(
    mode,
    themeBarColor,
    style.specialHue,
    timestampSeconds,
    speed,
  );
}

/**
 * Canvas overlay vertical text gradient stops (v5.3.4 Phase 3.5.3).
 * Top = subtle highlight; bottom = resolved caption color.
 */
export function resolveCanvasTextGradientStops(baseHex: string): { topHex: string; bottomHex: string } {
  const normalized = normalizeHexColor(baseHex) ?? '#ffffff';
  if (normalized === '#000000') {
    return { topHex: '#3a3a3a', bottomHex: '#000000' };
  }
  if (normalized === '#ffffff') {
    // CHANGED: bottom stop softened (#f6f6f6) — highlight stays at top (stop 0).
    // WHY: prior #ececec read as a band when scrutinized; hair less contrast at glyph base.
    return { topHex: '#ffffff', bottomHex: '#f6f6f6' };
  }

  const hsv = hexToHsv(normalized);
  if (!hsv) {
    return { topHex: normalized, bottomHex: normalized };
  }

  const luminance = hexRelativeLuminance(normalized);
  const darkBase = hsv.v < 48 || luminance < 0.45;
  if (darkBase) {
    const topV = Math.min(100, hsv.v + 16);
    const topS = Math.max(0, hsv.s * 0.82);
    return { topHex: hsvToHex(hsv.h, topS, topV), bottomHex: normalized };
  }

  const topV = Math.min(100, hsv.v + 8);
  const topS = Math.max(0, hsv.s * 0.9);
  const bottomV = Math.max(0, hsv.v - 4);
  const bottomS = Math.min(100, hsv.s * 1.02);
  return {
    topHex: hsvToHex(hsv.h, topS, topV),
    bottomHex: hsvToHex(hsv.h, bottomS, bottomV),
  };
}

/** Full vertical sweep period for animated text gradient (canvas overlay). */
export const CANVAS_TEXT_GRADIENT_WAVE_CYCLE_SECONDS = 3.5;
/** Normalized half-width of the sweeping highlight band (0–1 gradient space). */
export const CANVAS_TEXT_GRADIENT_WAVE_BAND_HALF = 0.18;

export function canvasTextGradientWavePhase(timestampSeconds: number): number {
  const cycle = CANVAS_TEXT_GRADIENT_WAVE_CYCLE_SECONDS;
  if (!Number.isFinite(timestampSeconds) || cycle <= 0) return 0;
  const t = ((timestampSeconds % cycle) + cycle) % cycle;
  return t / cycle;
}

function appendGradientColorStops(
  gradient: CanvasGradient,
  stops: Array<[number, string]>,
): void {
  const sorted = stops
    .map(([pos, color]) => [Math.max(0, Math.min(1, pos)), color] as [number, string])
    .sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, string]> = [];
  for (const [pos, color] of sorted) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last[0] - pos) < 1e-6) {
      last[1] = color;
      continue;
    }
    merged.push([pos, color]);
  }
  for (const [pos, color] of merged) {
    gradient.addColorStop(pos, color);
  }
}

/**
 * Vertical caption fill gradient — static (top highlight → bottom base) or sweeping wave band.
 * Canvas overlay only (v5.3.4 Phase 3.5.3). Color stop 0 = glyph top, stop 1 = glyph bottom.
 */
export function createCanvasOverlayTextGradient(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  textHeight: number,
  baseHex: string,
  wavePhase?: number,
): CanvasGradient {
  const { topHex, bottomHex } = resolveCanvasTextGradientStops(baseHex);
  const gradient = ctx.createLinearGradient(x, y, x, y + textHeight);

  if (wavePhase === undefined) {
    gradient.addColorStop(0, topHex);
    gradient.addColorStop(1, bottomHex);
    return gradient;
  }

  const bandHalf = CANVAS_TEXT_GRADIENT_WAVE_BAND_HALF;
  const center = wavePhase * (1 + bandHalf * 2) - bandHalf;
  appendGradientColorStops(gradient, [
    [0, bottomHex],
    [center - bandHalf, bottomHex],
    [center, topHex],
    [center + bandHalf, bottomHex],
    [1, bottomHex],
  ]);
  return gradient;
}

export function resolveTextColorHex(style: SubtitleStyleConfig, themeBarColor: string): string {
  if (style.textColor === 'black') return '#000000';
  if (style.textColor === 'white') return '#ffffff';
  if (style.textColor === 'theme') {
    return normalizeHexColor(themeBarColor) ?? '#00e5ff';
  }
  if (style.textColor === 'special') {
    // BUG FIX: undefined arg to normalizeHexColor when style.specialHue is not set
    // Fix: guard argument with ?? so normalizeHexColor always receives a string; keep result fallback for invalid hex
    return normalizeHexColor(style.specialHue ?? DEFAULT_SUBTITLE_SPECIAL_HUE) ?? DEFAULT_SUBTITLE_SPECIAL_HUE;
  }
  return '#ffffff';
}

/** drawtext fontcolor for main caption — white/black names or opaque 0xRRGGBBAA. */
export function drawtextMainFontColor(style: SubtitleStyleConfig, themeBarColor?: string): string {
  const hex = resolveTextColorHex(style, themeBarColor ?? '#00e5ff');
  if (hex === '#ffffff') return 'white';
  if (hex === '#000000') return 'black';
  return `0x${hex.slice(1).toUpperCase()}FF`;
}

/** Sizes the backdrop box without painting glyphs — 0xRRGGBBAA, not black@0.00 (BUG-029 regression). */
export const DRAWTEXT_BACKDROP_PLATE_FONT_COLOR = '0x00000000';

/**
 * FFmpeg drawtext color for glow duplicate layers.
 * BUG FIX: invalid fontcolor breaks entire -vf chain (BUG-028)
 * Fix: use white/black names or 0xRRGGBBAA — never 0xRRGGBB@opacity.
 */
export function ffmpegDrawtextColor(hex: string, opacity: number): string {
  const normalized = normalizeHexColor(hex) ?? '#ffffff';
  const alpha = Math.max(0, Math.min(1, opacity));

  if (normalized === '#ffffff') {
    return alpha >= 0.99 ? 'white' : `white@${alpha.toFixed(2)}`;
  }
  if (normalized === '#000000') {
    return alpha >= 0.99 ? 'black' : `black@${alpha.toFixed(2)}`;
  }

  const alphaByte = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
  return `0x${normalized.slice(1).toUpperCase()}${alphaByte}`;
}

const BORDER_RING: [number, number][] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/**
 * Glow layers for halo (soft ring) or border (solid outline, no alpha).
 * Halo uses the same font size as the main caption so bake/preview stay aligned.
 */
const CARDINAL_RING: [number, number][] = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
];

export function buildGlowLayerSpecs(
  glow: SubtitleGlowConfig,
  baseFontSize: number,
  ringMode: GlowRingMode = 'full',
): GlowLayerSpec[] {
  if (glow.enabled !== true) return [];

  const mode = glow.mode ?? 'halo';
  const baseOpacity = glow.opacity ?? 0.55;

  if (mode === 'border') {
    return BORDER_RING.map(([offsetX, offsetY]) => ({
      fontSize: baseFontSize,
      offsetX,
      offsetY,
      opacity: 1,
    }));
  }

  // Halo. blurRadius (1–3) sets the ring spread distance in px.
  const spread = Math.max(1, Math.min(3, Math.round(glow.blurRadius ?? 2)));

  // Cheap single-ring halos for the burn-in (flat layer cost regardless of spread).
  if (ringMode === 'min') {
    return CARDINAL_RING.map(([dx, dy]) => ({
      fontSize: baseFontSize,
      offsetX: dx * spread,
      offsetY: dy * spread,
      opacity: baseOpacity * 0.4,
    }));
  }
  if (ringMode === 'single') {
    const specs: GlowLayerSpec[] = [
      { fontSize: baseFontSize, offsetX: 0, offsetY: 0, opacity: baseOpacity * 0.5 },
    ];
    for (const [dx, dy] of BORDER_RING) {
      specs.push({
        fontSize: baseFontSize,
        offsetX: dx * spread,
        offsetY: dy * spread,
        opacity: baseOpacity * 0.4,
      });
    }
    return specs;
  }

  // 'full' — lush multi-ring gradient (preview).
  const specs: GlowLayerSpec[] = [
    { fontSize: baseFontSize, offsetX: 0, offsetY: 0, opacity: baseOpacity * 0.5 },
  ];
  for (let step = 1; step <= spread; step += 1) {
    const falloff = 1 - (step - 1) * 0.22;
    for (const [dx, dy] of BORDER_RING) {
      specs.push({
        fontSize: baseFontSize,
        offsetX: dx * step,
        offsetY: dy * step,
        opacity: baseOpacity * 0.35 * falloff,
      });
    }
  }

  return specs;
}

/** Fraction of glow.opacity routed to offset rings (canvas overlay halo). */
export const CANVAS_HALO_RING_OPACITY_BUDGET = 0.68;

/** Fraction of glow.opacity routed to shadowBlur core (canvas overlay halo). */
export const CANVAS_HALO_UNDERPASS_OPACITY_BUDGET = 0.32;

/**
 * Scale layer opacities so their sum equals targetSum — constant integral regardless of ring count.
 * Canvas overlay only; drawtext tiers keep per-layer opacities from buildGlowLayerSpecs.
 */
export function normalizeGlowLayerOpacityIntegral(
  specs: GlowLayerSpec[],
  targetSum: number,
): GlowLayerSpec[] {
  if (specs.length === 0 || targetSum <= 0) return specs;
  const sum = specs.reduce((total, spec) => total + spec.opacity, 0);
  if (sum <= 0) return specs;
  const scale = targetSum / sum;
  return specs.map((spec) => ({ ...spec, opacity: spec.opacity * scale }));
}

/**
 * Integral-normalized multi-ring halo for canvas overlay.
 * Rings only — core diffusion is paintHaloDiffusionUnderpass (no centre duplicate; avoids muddy stack).
 * Sync: subtitle-overlay-renderer.ts paintGlowText halo branch.
 */
/** Furthest duplicate-ring offset (px) — canvas overlay halo; sync bleed with subtitle-overlay-renderer.ts */
export function canvasOverlayHaloMaxRingOffsetPx(glow: SubtitleGlowConfig): number {
  const spread = Math.max(1, Math.min(3, Math.round(glow.blurRadius ?? 2)));
  return spread + 1;
}

export function buildCanvasOverlayHaloLayerSpecs(
  glow: SubtitleGlowConfig,
  baseFontSize: number,
): GlowLayerSpec[] {
  if (glow.enabled !== true) return [];

  const baseOpacity = glow.opacity ?? 0.55;
  const spread = Math.max(1, Math.min(3, Math.round(glow.blurRadius ?? 2)));
  const raw: GlowLayerSpec[] = [];

  for (let step = 1; step <= spread; step += 1) {
    // CHANGED: exp falloff vs linear 0.22/step — smoother taper, less octagonal fence at max spread.
    const falloff = Math.exp(-0.42 * (step - 1));
    for (const [dx, dy] of BORDER_RING) {
      raw.push({
        fontSize: baseFontSize,
        offsetX: dx * step,
        offsetY: dy * step,
        opacity: falloff,
      });
    }
  }

  // Whisper ring one step beyond spread — soft outer tail without a hard cutoff.
  const outerFalloff = Math.exp(-0.42 * spread) * 0.42;
  for (const [dx, dy] of BORDER_RING) {
    raw.push({
      fontSize: baseFontSize,
      offsetX: dx * (spread + 1),
      offsetY: dy * (spread + 1),
      opacity: outerFalloff,
    });
  }

  const ringBudget = baseOpacity * CANVAS_HALO_RING_OPACITY_BUDGET;
  return normalizeGlowLayerOpacityIntegral(raw, ringBudget);
}

export function resolveSubtitleEffectPalette(
  style: SubtitleStyleConfig,
  themeBarColor: string,
): { textHex: string; glowHex: string } {
  const glow = style.glow;
  return {
    textHex: resolveTextColorHex(style, themeBarColor),
    glowHex: resolveGlowColorHex(glow?.colorSource, themeBarColor, style.specialHue),
  };
}

export function subtitleStyleNeedsGlowLayers(style: SubtitleStyleConfig): boolean {
  return style.glow?.enabled === true;
}