import { deriveGlowColor, normalizeHexColor } from '@/src/theme/color-utils';
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

export function resolveGlowColorHex(
  source: SubtitleGlowColorSource | undefined,
  themeBarColor: string,
  specialHue?: string,
): string {
  if (source === 'black') return '#000000';
  if (source === 'white') return '#ffffff';
  if (source === 'special') {
    return normalizeHexColor(specialHue) ?? DEFAULT_SUBTITLE_SPECIAL_HUE;
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
    return normalizeHexColor(style.specialHue) ?? DEFAULT_SUBTITLE_SPECIAL_HUE;
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
export function buildGlowLayerSpecs(glow: SubtitleGlowConfig, baseFontSize: number): GlowLayerSpec[] {
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

  const blurSteps = Math.max(1, Math.min(3, Math.round(glow.blurRadius ?? 2)));
  const specs: GlowLayerSpec[] = [
    {
      fontSize: baseFontSize,
      offsetX: 0,
      offsetY: 0,
      opacity: baseOpacity * 0.5,
    },
  ];

  for (let step = 1; step <= blurSteps; step += 1) {
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