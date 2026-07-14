import type { LayoutMode } from './layout';
import { isLayoutMode } from './layout';
import { normalizeHexColor } from '@/src/theme/color-utils';

/**
 * CHANGED: v6 spectrum and overlay presets share one bounded control vocabulary.
 * WHY: the Style panel can render consistent controls without preset-specific persistence shapes.
 */
export interface VisualizerParams {
  sensitivity: number;
  intensity: number;
  smoothing: number;
  color: string | readonly string[];
  density: number;
  bassWeight?: number;
  midWeight?: number;
  trebleWeight?: number;
  layoutMode?: LayoutMode;
  highContrast?: boolean;
  afterimageStrength?: number;
}

export const DEFAULT_VISUALIZER_PARAMS: Readonly<VisualizerParams> = Object.freeze({
  sensitivity: 0.5,
  intensity: 0.5,
  smoothing: 0.5,
  color: '#8f93e6',
  density: 0.5,
});

const MAX_PALETTE_COLORS = 7;

function clamp(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, value));
}

function normalizeVisualColor(value: unknown): string | readonly string[] | undefined {
  if (typeof value === 'string') return normalizeHexColor(value) ?? undefined;
  if (!Array.isArray(value)) return undefined;

  const colors = value
    .map((entry) => (typeof entry === 'string' ? normalizeHexColor(entry) : null))
    .filter((entry): entry is string => Boolean(entry));
  const unique = [...new Set(colors)].slice(0, MAX_PALETTE_COLORS);
  return unique.length > 0 ? unique : undefined;
}

/** Guard the optional preference payload without inventing values for absent controls. */
export function normalizeVisualizerParams(
  raw: Partial<VisualizerParams> | null | undefined,
): Partial<VisualizerParams> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;

  const normalized: Partial<VisualizerParams> = {};
  const sensitivity = clamp(raw.sensitivity, 0, 1);
  const intensity = clamp(raw.intensity, 0, 1);
  const smoothing = clamp(raw.smoothing, 0, 1);
  const density = clamp(raw.density, 0, 1);
  const bassWeight = clamp(raw.bassWeight, 0, 2);
  const midWeight = clamp(raw.midWeight, 0, 2);
  const trebleWeight = clamp(raw.trebleWeight, 0, 2);
  const afterimageStrength = clamp(raw.afterimageStrength, 0, 1);
  const color = normalizeVisualColor(raw.color);

  if (sensitivity !== undefined) normalized.sensitivity = sensitivity;
  if (intensity !== undefined) normalized.intensity = intensity;
  if (smoothing !== undefined) normalized.smoothing = smoothing;
  if (density !== undefined) normalized.density = density;
  if (bassWeight !== undefined) normalized.bassWeight = bassWeight;
  if (midWeight !== undefined) normalized.midWeight = midWeight;
  if (trebleWeight !== undefined) normalized.trebleWeight = trebleWeight;
  if (afterimageStrength !== undefined) normalized.afterimageStrength = afterimageStrength;
  if (color !== undefined) normalized.color = color;
  if (isLayoutMode(raw.layoutMode)) normalized.layoutMode = raw.layoutMode;
  if (typeof raw.highContrast === 'boolean') normalized.highContrast = raw.highContrast;

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

/** Merge registry defaults with a normalized saved override into a complete render payload. */
export function resolveVisualizerParams(
  defaults: Partial<VisualizerParams> | undefined,
  overrides: Partial<VisualizerParams> | null | undefined,
): VisualizerParams {
  return {
    ...DEFAULT_VISUALIZER_PARAMS,
    ...normalizeVisualizerParams(defaults),
    ...normalizeVisualizerParams(overrides),
  };
}
