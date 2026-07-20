import { hexToRgb, normalizeHexColor, rgbToHex } from '@/src/theme/color-utils';
import type { VisualizerParams } from './params';

/** Shared color helpers for allocation-bounded Canvas-2D visual families. */
export function resolveVisualPalette(color: VisualizerParams['color']): readonly string[] {
  const values = Array.isArray(color) ? color : [color];
  const normalized = values
    .map((entry) => normalizeHexColor(entry))
    .filter((entry): entry is string => Boolean(entry));
  return normalized.length > 0 ? normalized : ['#ffffff'];
}

export function colorWithAlpha(color: string, alpha: number): string {
  const rgb = hexToRgb(color) ?? { r: 255, g: 255, b: 255 };
  const safeAlpha = Math.min(1, Math.max(0, Number.isFinite(alpha) ? alpha : 0));
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${safeAlpha})`;
}

export function mixVisualColors(from: string, to: string, amount: number): string {
  const left = hexToRgb(from) ?? { r: 255, g: 255, b: 255 };
  const right = hexToRgb(to) ?? left;
  const mix = Math.min(1, Math.max(0, amount));
  return rgbToHex(
    left.r + (right.r - left.r) * mix,
    left.g + (right.g - left.g) * mix,
    left.b + (right.b - left.b) * mix,
  );
}
