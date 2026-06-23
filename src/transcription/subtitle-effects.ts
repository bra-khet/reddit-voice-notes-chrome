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

/** ~2.9 s per full hue cycle — slower rotation = smaller hue jump per bake slice (looks smoother). */
export const RAINBOW_CYCLES_PER_SECOND = 0.35;

/** Bake quantizes rainbow into static drawtext slices (FFmpeg fontcolor is not time-expressive). */
export const RAINBOW_BAKE_SLICE_SECONDS = 0.25;

export const RAINBOW_BAKE_MAX_SLICES_PER_CUE = 24;

export function rainbowHueHexAtTime(
  timeSeconds: number,
  phaseHueHex: string,
  cyclesPerSecond = RAINBOW_CYCLES_PER_SECOND,
): string {
  const phase = hexToHsv(phaseHueHex)?.h ?? 0;
  const hue = (phase + timeSeconds * cyclesPerSecond * 360) % 360;
  return hsvToHex(hue, 100, 100);
}

export function styleUsesSpecialHueRainbow(style: SubtitleStyleConfig): boolean {
  if (style.specialHueRainbow !== true) return false;
  const textSpecial = style.textColor === 'special';
  const glowSpecial = style.glow?.enabled === true && style.glow.colorSource === 'special';
  return textSpecial || glowSpecial;
}

export function subtitlePreviewNeedsAnimation(style: SubtitleStyleConfig): boolean {
  return styleUsesSpecialHueRainbow(style);
}

export interface TemporalDrawtextSlice {
  start: number;
  end: number;
  fontColor: string;
}

export function temporalizeDrawtextColor(
  start: number,
  end: number,
  colorAtTime: (timeSeconds: number) => string,
): TemporalDrawtextSlice[] {
  const duration = end - start;
  if (duration <= 0) {
    return [{ start, end, fontColor: colorAtTime(start) }];
  }

  const sliceCount = Math.min(
    RAINBOW_BAKE_MAX_SLICES_PER_CUE,
    Math.max(1, Math.ceil(duration / RAINBOW_BAKE_SLICE_SECONDS)),
  );
  const sliceDur = duration / sliceCount;
  const slices: TemporalDrawtextSlice[] = [];

  for (let index = 0; index < sliceCount; index += 1) {
    const sliceStart = start + index * sliceDur;
    const sliceEnd = index === sliceCount - 1 ? end : start + (index + 1) * sliceDur;
    const mid = (sliceStart + sliceEnd) / 2;
    slices.push({
      start: sliceStart,
      end: sliceEnd,
      fontColor: colorAtTime(mid),
    });
  }

  return slices;
}

export function resolveGlowColorHex(
  source: SubtitleGlowColorSource | undefined,
  themeBarColor: string,
  specialHue?: string,
  timeSeconds?: number,
  rainbowEnabled?: boolean,
): string {
  if (source === 'black') return '#000000';
  if (source === 'white') return '#ffffff';
  if (source === 'special') {
    const base = normalizeHexColor(specialHue) ?? DEFAULT_SUBTITLE_SPECIAL_HUE;
    if (rainbowEnabled && timeSeconds !== undefined) {
      return rainbowHueHexAtTime(timeSeconds, base);
    }
    return base;
  }
  const bar = normalizeHexColor(themeBarColor) ?? '#00e5ff';
  const derived = deriveGlowColor(bar);
  return derived.slice(0, 7);
}

export function resolveTextColorHex(
  style: SubtitleStyleConfig,
  themeBarColor: string,
  timeSeconds?: number,
): string {
  if (style.textColor === 'black') return '#000000';
  if (style.textColor === 'white') return '#ffffff';
  if (style.textColor === 'theme') {
    return normalizeHexColor(themeBarColor) ?? '#00e5ff';
  }
  if (style.textColor === 'special') {
    const base = normalizeHexColor(style.specialHue) ?? DEFAULT_SUBTITLE_SPECIAL_HUE;
    if (style.specialHueRainbow && timeSeconds !== undefined) {
      return rainbowHueHexAtTime(timeSeconds, base);
    }
    return base;
  }
  return '#ffffff';
}

/** drawtext fontcolor for main caption — white/black names or opaque 0xRRGGBBAA. */
export function drawtextMainFontColor(
  style: SubtitleStyleConfig,
  themeBarColor?: string,
  timeSeconds?: number,
): string {
  const hex = resolveTextColorHex(style, themeBarColor ?? '#00e5ff', timeSeconds);
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
  timeSeconds?: number,
): { textHex: string; glowHex: string } {
  const glow = style.glow;
  const rainbow = style.specialHueRainbow === true;
  return {
    textHex: resolveTextColorHex(style, themeBarColor, timeSeconds),
    glowHex: resolveGlowColorHex(
      glow?.colorSource,
      themeBarColor,
      style.specialHue,
      timeSeconds,
      rainbow && glow?.colorSource === 'special',
    ),
  };
}

export function subtitleStyleNeedsGlowLayers(style: SubtitleStyleConfig): boolean {
  return style.glow?.enabled === true;
}