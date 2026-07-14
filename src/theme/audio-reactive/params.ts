import type { LayoutMode } from './layout';

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
