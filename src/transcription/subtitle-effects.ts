import { deriveGlowColor, normalizeHexColor } from '@/src/theme/color-utils';
import type {
  SubtitleGlowColorSource,
  SubtitleGlowConfig,
  SubtitleStyleConfig,
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
): string {
  if (source === 'black') return '#000000';
  if (source === 'white') return '#ffffff';
  const bar = normalizeHexColor(themeBarColor) ?? '#00e5ff';
  const derived = deriveGlowColor(bar);
  return derived.slice(0, 7);
}

export function resolveTextColorHex(style: SubtitleStyleConfig): string {
  return style.textColor === 'black' ? '#000000' : '#ffffff';
}

/** drawtext fontcolor for main caption — proven BUG-025-safe names only. */
export function drawtextMainFontColor(style: SubtitleStyleConfig): string {
  return style.textColor === 'black' ? 'black' : 'white';
}

/**
 * FFmpeg drawtext color for glow/shadow duplicate layers.
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

/**
 * Glow layers for halo (soft ring) or offset (colored drop shadow).
 * Halo uses the same font size as the main caption so bake/preview stay aligned.
 */
export function buildGlowLayerSpecs(glow: SubtitleGlowConfig, baseFontSize: number): GlowLayerSpec[] {
  if (glow.enabled !== true) return [];

  const mode = glow.mode ?? 'halo';
  const baseOpacity = glow.opacity ?? 0.55;

  if (mode === 'offset') {
    return [
      {
        fontSize: baseFontSize,
        offsetX: glow.offsetX ?? 2,
        offsetY: glow.offsetY ?? 2,
        opacity: baseOpacity,
      },
    ];
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

  const ring: [number, number][] = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ];

  for (let step = 1; step <= blurSteps; step += 1) {
    const falloff = 1 - (step - 1) * 0.22;
    for (const [dx, dy] of ring) {
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
): { textHex: string; glowHex: string; shadowHex: string } {
  const glow = style.glow;
  return {
    textHex: resolveTextColorHex(style),
    glowHex: resolveGlowColorHex(glow?.colorSource, themeBarColor),
    shadowHex: '#000000',
  };
}

export function subtitleStyleNeedsGlowLayers(style: SubtitleStyleConfig): boolean {
  return style.glow?.enabled === true;
}