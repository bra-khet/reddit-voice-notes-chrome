import type { AppearancePreferences } from '@/src/settings/user-preferences';
import {
  deriveBackgroundColor,
  deriveGlowColor,
  normalizeHexColor,
} from '@/src/theme/color-utils';
import { getThemeById } from '@/src/theme/presets';
import type { ThemeDesignEffects, WaveformTheme } from '@/src/theme/types';
import {
  MAX_STACKABLE_EFFECTS,
  isOverlayPresetId,
  isSpectrumPresetId,
  isStackableEffectId,
  normalizeVisualizerParams,
  type OverlayPresetId,
  type SpectrumPresetId,
  type StackableEffectId,
  type VisualizerParams,
} from '@/src/theme/audio-reactive';

export type BackgroundEffect = 'none' | 'bokeh' | 'sparkle';
export type BarGlowEffect = 'default' | 'boosted';

const VALID_BACKGROUND_EFFECTS: readonly BackgroundEffect[] = ['none', 'bokeh', 'sparkle'];
const VALID_BAR_GLOW_EFFECTS: readonly BarGlowEffect[] = ['default', 'boosted'];

const BOOSTED_BAR_GLOW_MULTIPLIER = 1.65;

/** User color + effect overrides merged atop a bundled preset (pretty-8). */
export interface DesignOverrides {
  barColor: string;
  glowColor?: string;
  backgroundEffect?: BackgroundEffect;
  barGlow?: BarGlowEffect;
  spectrumPreset?: SpectrumPresetId;
  visualizerParams?: Partial<VisualizerParams>;
  overlayPreset?: OverlayPresetId | null;
  stackables?: StackableEffectId[];
}

export const CUSTOM_STYLE_BASE_THEME_ID = 'neon-glow' as const;

export const DEFAULT_CUSTOM_STYLE_OVERRIDES: DesignOverrides = {
  barColor: '#00e5ff',
  glowColor: deriveGlowColor('#00e5ff'),
  backgroundEffect: 'none',
  barGlow: 'default',
};

function normalizeBackgroundEffect(raw: BackgroundEffect | undefined): BackgroundEffect {
  if (raw && VALID_BACKGROUND_EFFECTS.includes(raw)) return raw;
  return 'none';
}

function normalizeBarGlow(raw: BarGlowEffect | undefined): BarGlowEffect {
  if (raw && VALID_BAR_GLOW_EFFECTS.includes(raw)) return raw;
  return 'default';
}

export function normalizeDesignOverrides(
  raw: DesignOverrides | null | undefined,
): DesignOverrides | null {
  if (!raw?.barColor) return null;
  const barColor = normalizeHexColor(raw.barColor);
  if (!barColor) return null;

  const normalized: DesignOverrides = {
    barColor,
    glowColor: deriveGlowColor(barColor),
    backgroundEffect: normalizeBackgroundEffect(raw.backgroundEffect),
    barGlow: normalizeBarGlow(raw.barGlow),
  };

  // CHANGED: every additive v6 field is independently allowlisted and bounded.
  // WHY: imported/saved styles cross an untyped persistence boundary and must not reach renderers raw.
  if (isSpectrumPresetId(raw.spectrumPreset)) normalized.spectrumPreset = raw.spectrumPreset;
  if (raw.overlayPreset === null) normalized.overlayPreset = null;
  else if (isOverlayPresetId(raw.overlayPreset)) normalized.overlayPreset = raw.overlayPreset;

  const visualizerParams = normalizeVisualizerParams(raw.visualizerParams);
  if (visualizerParams) normalized.visualizerParams = visualizerParams;

  if (Array.isArray(raw.stackables)) {
    const stackables = [...new Set(raw.stackables.filter(isStackableEffectId))]
      .slice(0, MAX_STACKABLE_EFFECTS);
    if (stackables.length > 0) normalized.stackables = stackables;
  }

  return normalized;
}

export function designOverridesMatch(
  a: DesignOverrides | null | undefined,
  b: DesignOverrides | null | undefined,
): boolean {
  const left = normalizeDesignOverrides(a);
  const right = normalizeDesignOverrides(b);
  if (!left && !right) return true;
  if (!left || !right) return false;
  return (
    left.barColor === right.barColor &&
    (left.glowColor ?? '') === (right.glowColor ?? '') &&
    left.backgroundEffect === right.backgroundEffect &&
    left.barGlow === right.barGlow &&
    left.spectrumPreset === right.spectrumPreset &&
    left.overlayPreset === right.overlayPreset &&
    JSON.stringify(left.visualizerParams ?? null) === JSON.stringify(right.visualizerParams ?? null) &&
    JSON.stringify(left.stackables ?? []) === JSON.stringify(right.stackables ?? [])
  );
}

function buildDesignEffects(overrides: DesignOverrides): ThemeDesignEffects | undefined {
  const legacyOverlay =
    overrides.backgroundEffect === 'bokeh' || overrides.backgroundEffect === 'sparkle'
      ? overrides.backgroundEffect
      : undefined;
  const hasOverlayPreset = overrides.overlayPreset !== undefined;
  const overlayPreset = hasOverlayPreset ? overrides.overlayPreset : legacyOverlay;
  const backgroundOverlay = overlayPreset === 'bokeh' || overlayPreset === 'sparkle'
    ? overlayPreset
    : undefined;
  const barGlowMultiplier =
    overrides.barGlow === 'boosted' ? BOOSTED_BAR_GLOW_MULTIPLIER : undefined;

  if (
    !backgroundOverlay &&
    !barGlowMultiplier &&
    !overrides.spectrumPreset &&
    !overrides.visualizerParams &&
    !overrides.stackables?.length &&
    !hasOverlayPreset
  ) return undefined;

  return {
    ...(backgroundOverlay ? { backgroundOverlay } : {}),
    ...(hasOverlayPreset ? { overlayPreset } : {}),
    ...(overrides.spectrumPreset ? { spectrumPreset: overrides.spectrumPreset } : {}),
    ...(overrides.visualizerParams ? { visualizerParams: overrides.visualizerParams } : {}),
    ...(overrides.stackables?.length ? { stackables: overrides.stackables } : {}),
    ...(barGlowMultiplier ? { barGlowMultiplier } : {}),
  };
}

export function themeHasAnimatedOverlay(theme: WaveformTheme): boolean {
  const effects = theme.designEffects;
  const overlay = effects?.overlayPreset !== undefined
    ? effects.overlayPreset
    : effects?.backgroundOverlay;
  return Boolean(overlay) || Boolean(effects?.stackables?.length);
}

export function effectiveBarGlow(theme: WaveformTheme): number {
  return theme.bars.glow * (theme.designEffects?.barGlowMultiplier ?? 1);
}

export function applyDesignOverrides(
  base: WaveformTheme,
  overrides: DesignOverrides,
): WaveformTheme {
  const normalized = normalizeDesignOverrides(overrides);
  if (!normalized) return base;

  const barColor = normalized.barColor;
  const glowColor = normalized.glowColor ?? deriveGlowColor(barColor);
  const designEffects = buildDesignEffects(normalized);

  return {
    ...base,
    colors: {
      bar: barColor,
      glow: glowColor,
      bg: deriveBackgroundColor(barColor),
    },
    designEffects,
  };
}

export function isCustomStyleMode(appearance: AppearancePreferences): boolean {
  return Boolean(appearance.activeCustomStyleId) || Boolean(appearance.designOverrides?.barColor);
}

export function resolveAppearanceTheme(appearance: AppearancePreferences): WaveformTheme {
  const savedStyleId = appearance.activeCustomStyleId;
  const liveOverrides = normalizeDesignOverrides(appearance.designOverrides);

  if (savedStyleId) {
    const saved = appearance.savedCustomStyles?.find((style) => style.id === savedStyleId);
    if (saved) {
      const base = getThemeById(saved.baseThemeId);
      const overrides = liveOverrides ?? normalizeDesignOverrides(saved.designOverrides);
      return overrides ? applyDesignOverrides(base, overrides) : base;
    }
  }

  if (liveOverrides) {
    const base = getThemeById(CUSTOM_STYLE_BASE_THEME_ID);
    return applyDesignOverrides(base, liveOverrides);
  }

  return getThemeById(appearance.activeThemeId);
}
