import {
  deriveGlowColor,
  hexToHsv,
  hexToRgb,
  hsvToHex,
  normalizeHexColor,
} from '@/src/theme/color-utils';
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