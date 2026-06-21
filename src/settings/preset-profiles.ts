import type { ClipProfile } from '@/src/settings/clip-profiles';
import { DEFAULT_USER_BACKGROUND_LAYOUT } from '@/src/theme/background-layout';
import {
  getThemeById,
  isKnownThemeId,
  listThemePresets,
  normalizeThemeId,
} from '@/src/theme/presets';

/** Virtual profile ids for bundled clip styles — never stored in `savedProfiles`. */
export const PRESET_PROFILE_ID_PREFIX = 'preset-' as const;

export function presetProfileId(themeId: string): string {
  return `${PRESET_PROFILE_ID_PREFIX}${normalizeThemeId(themeId)}`;
}

export function isPresetProfileId(profileId: string): boolean {
  return profileId.startsWith(PRESET_PROFILE_ID_PREFIX);
}

export function presetThemeIdFromProfileId(profileId: string): string {
  return profileId.slice(PRESET_PROFILE_ID_PREFIX.length);
}

/** Built-in clip style as a read-only dummy profile (pretty-8 recorder popup). */
export function getPresetClipProfile(themeId: string): ClipProfile | undefined {
  const normalizedThemeId = normalizeThemeId(themeId);
  if (!isKnownThemeId(normalizedThemeId)) return undefined;

  const theme = getThemeById(normalizedThemeId);
  return {
    id: presetProfileId(normalizedThemeId),
    name: theme.name,
    themeId: normalizedThemeId,
    barAlignment: 'center',
    customBackgroundId: null,
    backgroundScaleMode: DEFAULT_USER_BACKGROUND_LAYOUT.scaleMode,
    backgroundPosition: DEFAULT_USER_BACKGROUND_LAYOUT.position,
    customStyleId: null,
    designOverrides: null,
  };
}

export function listPresetClipProfiles(): ClipProfile[] {
  return listThemePresets()
    .map((theme) => getPresetClipProfile(theme.id))
    .filter((profile): profile is ClipProfile => Boolean(profile));
}