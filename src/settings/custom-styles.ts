import {
  CUSTOM_STYLE_BASE_THEME_ID,
  DEFAULT_CUSTOM_STYLE_OVERRIDES,
  designOverridesMatch,
  normalizeDesignOverrides,
  type DesignOverrides,
} from '@/src/theme/design-overrides';
import { isKnownThemeId } from '@/src/theme/presets';
import type { AppearancePreferences, UserPreferencesV1 } from '@/src/settings/user-preferences';

export const MAX_CUSTOM_STYLES = 12;
export const STYLE_ID_PREFIX = 'style-' as const;
export const STYLE_SELECT_CUSTOM = 'custom' as const;

export interface CustomClipStyle {
  id: string;
  name: string;
  /** Bundled preset template — Neon Glow for pretty-8 custom colors. */
  baseThemeId: string;
  designOverrides: DesignOverrides;
}

export function createCustomStyleId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${STYLE_ID_PREFIX}${crypto.randomUUID()}`;
  }
  return `${STYLE_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function normalizeCustomClipStyles(
  styles: CustomClipStyle[] | undefined,
): CustomClipStyle[] {
  if (!styles?.length) return [];

  const seenIds = new Set<string>();
  const normalized: CustomClipStyle[] = [];

  for (const raw of styles) {
    const name = raw.name?.trim();
    const overrides = normalizeDesignOverrides(raw.designOverrides);
    if (!raw.id || !name || !overrides) continue;
    if (!isKnownThemeId(raw.baseThemeId)) continue;
    if (seenIds.has(raw.id)) continue;
    seenIds.add(raw.id);

    normalized.push({
      id: raw.id,
      name: name.slice(0, 40),
      baseThemeId: raw.baseThemeId,
      designOverrides: overrides,
    });

    if (normalized.length >= MAX_CUSTOM_STYLES) break;
  }

  return normalized;
}

export function normalizeActiveCustomStyleId(
  activeId: string | null | undefined,
  styles: CustomClipStyle[],
): string | null {
  if (!activeId) return null;
  return styles.some((style) => style.id === activeId) ? activeId : null;
}

export function getCustomStyleById(
  prefs: UserPreferencesV1,
  styleId: string,
): CustomClipStyle | undefined {
  return prefs.appearance.savedCustomStyles?.find((style) => style.id === styleId);
}

export function appearanceMatchesCustomStyle(
  appearance: AppearancePreferences,
  style: CustomClipStyle,
): boolean {
  const overrides = normalizeDesignOverrides(appearance.designOverrides);
  return (
    appearance.activeCustomStyleId === style.id &&
    designOverridesMatch(overrides, style.designOverrides)
  );
}

export function isCustomStyleDirty(appearance: AppearancePreferences): boolean {
  const styleId = appearance.activeCustomStyleId;
  if (!styleId) return false;
  const style = appearance.savedCustomStyles?.find((entry) => entry.id === styleId);
  if (!style) return false;
  return !appearanceMatchesCustomStyle(appearance, style);
}

export function resolveStyleSelectValue(prefs: UserPreferencesV1): string {
  const activeStyleId = prefs.appearance.activeCustomStyleId;
  if (activeStyleId && getCustomStyleById(prefs, activeStyleId)) {
    return activeStyleId;
  }
  if (prefs.appearance.designOverrides?.barColor) {
    return STYLE_SELECT_CUSTOM;
  }
  return prefs.appearance.activeThemeId;
}

export function parseStyleSelectValue(
  value: string,
): { kind: 'preset'; themeId: string } | { kind: 'custom' } | { kind: 'saved'; styleId: string } {
  if (value === STYLE_SELECT_CUSTOM) return { kind: 'custom' };
  if (value.startsWith(STYLE_ID_PREFIX)) return { kind: 'saved', styleId: value };
  return { kind: 'preset', themeId: value };
}

export function defaultCustomStyleOverrides(): DesignOverrides {
  return { ...DEFAULT_CUSTOM_STYLE_OVERRIDES };
}

export function customStyleBaseThemeId(): string {
  return CUSTOM_STYLE_BASE_THEME_ID;
}

/** Profiles referencing a deleted style should fall back to the default bundled preset. */
export function profilesAffectedByStyleDeletion(
  prefs: UserPreferencesV1,
  styleId: string,
): string[] {
  return (prefs.appearance.savedProfiles ?? [])
    .filter((profile) => profile.customStyleId === styleId)
    .map((profile) => profile.name);
}