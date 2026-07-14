import type {
  OverlayPresetId,
  SpectrumPresetId,
  StackableEffectId,
} from './audio-reactive/catalog';
import type { VisualizerParams } from './audio-reactive/params';

/** Bar geometry for the waveform draw loop. */
export interface ThemeBarStyle {
  width: number;
  spacing: number;
  cornerRadius: number;
  /** Max shadow blur (px) at full amplitude. */
  glow: number;
}

export interface ThemeColors {
  bar: string;
  glow: string;
  /** Letterbox / fallback fill behind image backgrounds. */
  bg: string;
}

export type BackgroundType = 'solid' | 'gradient' | 'image' | 'bokeh';

/** `fit` = contain (letterbox); `fill` = cover (crop). */
export type BackgroundScaleMode = 'fit' | 'fill';

/** Personal background placement within the 16:9 frame. */
export type BackgroundImagePosition =
  | 'top'
  | 'top-left'
  | 'top-right'
  | 'center'
  | 'bottom'
  | 'bottom-left'
  | 'bottom-right'
  | 'left'
  | 'right';

export interface UserBackgroundLayout {
  scaleMode: BackgroundScaleMode;
  position: BackgroundImagePosition;
}

export interface GradientStop {
  offset: number;
  color: string;
}

export interface ThemeBackground {
  type: BackgroundType;
  /**
   * - solid: CSS color string
   * - gradient: ordered stops (top → bottom)
   * - image: bundled asset key (see `BACKGROUND_ASSETS`)
   * - bokeh: registry-native soft-orb field (value reserved for future variants)
   */
  value: string | GradientStop[];
  /** Semi-transparent dim over image backgrounds so bars stay readable (0–1). */
  imageDimOverlay?: number;
  scaleMode?: BackgroundScaleMode;
}

/** Optional flair merged from Design Studio custom styles (pretty-8). */
export interface ThemeDesignEffects {
  /** v2 compatibility field; new dispatch prefers overlayPreset when present. */
  backgroundOverlay?: 'bokeh' | 'sparkle';
  spectrumPreset?: SpectrumPresetId;
  overlayPreset?: OverlayPresetId | null;
  visualizerParams?: Partial<VisualizerParams>;
  stackables?: readonly StackableEffectId[];
  barGlowMultiplier?: number;
}

export interface WaveformTheme {
  id: string;
  name: string;
  bars: ThemeBarStyle;
  colors: ThemeColors;
  background: ThemeBackground;
  designEffects?: ThemeDesignEffects;
}
