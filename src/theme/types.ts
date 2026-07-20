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
  /** Normalized focal anchor within the available pan range. */
  customPosition?: { x: number; y: number };
  /** Multiplier applied after fit/fill base scale. */
  manualScale?: number;
  /** Black overlay opacity applied after the personal image. */
  dim?: number;
  /** Canvas blur radius in CSS pixels. */
  blur?: number;
  /** Composite mode for the personal image draw only. */
  blendMode?: GlobalCompositeOperation;
  /** Lightweight chromatic multi-pass treatment inside the personal-image slot. */
  holo?: boolean;
  /** Animated-GIF playback multiplier. */
  gifSpeed?: number;
  /** Whether GIF timing may react to capture energy. */
  gifReactToAudio?: boolean;
  /** Prefer positioning that leaves the caption-safe region clear. */
  lockToSafeText?: boolean;
}

/** Fully guarded layout consumed by preview and capture painters. */
export type NormalizedUserBackgroundLayout = Required<UserBackgroundLayout>;

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
   * - bokeh: serialized key for the registry-native Bubbles soft-orb field
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
