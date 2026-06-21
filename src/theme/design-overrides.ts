import type { AppearancePreferences } from '@/src/settings/user-preferences';
import {
  deriveBackgroundColor,
  deriveGlowColor,
  normalizeHexColor,
} from '@/src/theme/color-utils';
import { getThemeById } from '@/src/theme/presets';
import type { ThemeDesignEffects, WaveformTheme } from '@/src/theme/types';

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
}

export const CUSTOM_STYLE_BASE_THEME_ID = 'neon-glow' as const;

export const DEFAULT_CUSTOM_STYLE_OVERRIDES: DesignOverrides = {
  barColor: '#00e5ff',
  glowColor: '#ff00e5aa',
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

  const glowRaw = raw.glowColor?.trim();
  let glowColor: string | undefined;
  if (glowRaw) {
    if (glowRaw.length === 9 && glowRaw.startsWith('#')) {
      glowColor = glowRaw.toLowerCase();
    } else {
      const glowHex = normalizeHexColor(glowRaw);
      glowColor = glowHex ? `${glowHex}aa` : undefined;
    }
  }

  return {
    barColor,
    glowColor: glowColor ?? deriveGlowColor(barColor),
    backgroundEffect: normalizeBackgroundEffect(raw.backgroundEffect),
    barGlow: normalizeBarGlow(raw.barGlow),
  };
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
    left.barGlow === right.barGlow
  );
}

function buildDesignEffects(overrides: DesignOverrides): ThemeDesignEffects | undefined {
  const backgroundOverlay =
    overrides.backgroundEffect === 'bokeh' || overrides.backgroundEffect === 'sparkle'
      ? overrides.backgroundEffect
      : undefined;
  const barGlowMultiplier =
    overrides.barGlow === 'boosted' ? BOOSTED_BAR_GLOW_MULTIPLIER : undefined;

  if (!backgroundOverlay && !barGlowMultiplier) return undefined;
  return {
    backgroundOverlay,
    barGlowMultiplier,
  };
}

export function themeHasAnimatedOverlay(theme: WaveformTheme): boolean {
  const overlay = theme.designEffects?.backgroundOverlay;
  return overlay === 'bokeh' || overlay === 'sparkle';
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