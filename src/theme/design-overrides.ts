import type { AppearancePreferences } from '@/src/settings/user-preferences';
import {
  deriveBackgroundColor,
  deriveGlowColor,
  normalizeHexColor,
} from '@/src/theme/color-utils';
import { getThemeById } from '@/src/theme/presets';
import type { WaveformTheme } from '@/src/theme/types';

/** User color overrides merged atop a bundled preset (pretty-8). */
export interface DesignOverrides {
  barColor: string;
  glowColor?: string;
  /** Reserved for pretty-8 effect toggles (bokeh, sparkle, …). */
  backgroundEffect?: 'none' | 'bokeh' | 'sparkle';
}

export const CUSTOM_STYLE_BASE_THEME_ID = 'neon-glow' as const;

export const DEFAULT_CUSTOM_STYLE_OVERRIDES: DesignOverrides = {
  barColor: '#00e5ff',
  glowColor: '#ff00e5aa',
};

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
    backgroundEffect: raw.backgroundEffect,
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
  return left.barColor === right.barColor && (left.glowColor ?? '') === (right.glowColor ?? '');
}

export function applyDesignOverrides(
  base: WaveformTheme,
  overrides: DesignOverrides,
): WaveformTheme {
  const normalized = normalizeDesignOverrides(overrides);
  if (!normalized) return base;

  const barColor = normalized.barColor;
  const glowColor = normalized.glowColor ?? deriveGlowColor(barColor);

  return {
    ...base,
    colors: {
      bar: barColor,
      glow: glowColor,
      bg: deriveBackgroundColor(barColor),
    },
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