import { deriveGlowColor, hexToHsv, hsvToHex, normalizeHexColor } from '@/src/theme/color-utils';
import {
  DEFAULT_SUBTITLE_SPECIAL_HUE,
  type SubtitleGlowColorSource,
  type SubtitleGlowConfig,
  type SubtitleStyleConfig,
} from '@/src/transcription/types';

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

/**
 * Complementary inner accent for dual border — clamped saturation to avoid neon cheese.
 * Canvas overlay only (v5.3.4 Phase 3.5.2).
 */
export function resolveContrastingBorderColor(baseHex: string): string {
  const normalized = normalizeHexColor(baseHex) ?? '#ffffff';
  if (normalized === '#000000') return '#e0e0e0';
  if (normalized === '#ffffff') return '#2c2c2c';

  const hsv = hexToHsv(normalized);
  if (!hsv) return '#ffffff';

  const hue = (hsv.h + 180) % 360;
  const saturation = Math.max(38, Math.min(68, hsv.s * 0.85 + 12));
  const value =
    hsv.v > 55 ? Math.max(30, Math.min(70, hsv.v * 0.65)) : Math.min(88, hsv.v * 1.4 + 25);
  return hsvToHex(hue, saturation, value);
}

export function resolveGlowColorHex(
  source: SubtitleGlowColorSource | undefined,
  themeBarColor: string,
  specialHue?: string,
): string {
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