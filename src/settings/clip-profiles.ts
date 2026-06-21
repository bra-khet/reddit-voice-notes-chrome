import type { BarAlignment } from '@/src/recorder/waveform';
import { normalizeBackgroundAssetId } from '@/src/storage/image-db';
import { isKnownThemeId, normalizeThemeId } from '@/src/theme/presets';
import type { AppearancePreferences, UserPreferencesV1 } from '@/src/settings/user-preferences';

export const MAX_CLIP_PROFILES = 12;
export const PROFILE_ID_PREFIX = 'clip-' as const;
export const PROFILE_SELECT_CUSTOM = '' as const;

export interface ClipProfile {
  id: string;
  name: string;
  themeId: string;
  barAlignment: BarAlignment;
  /** ImageDB record id (`bg-…`) when this profile uses a personal background. */
  customBackgroundId?: string | null;
}

const VALID_BAR_ALIGNMENTS: readonly BarAlignment[] = ['center', 'bottom', 'top'];

function normalizeBarAlignment(alignment: BarAlignment | undefined): BarAlignment {
  if (alignment && VALID_BAR_ALIGNMENTS.includes(alignment)) return alignment;
  return 'center';
}

export function createClipProfileId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${PROFILE_ID_PREFIX}${crypto.randomUUID()}`;
  }
  return `${PROFILE_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function normalizeClipProfiles(profiles: ClipProfile[] | undefined): ClipProfile[] {
  if (!profiles?.length) return [];

  const seenIds = new Set<string>();
  const normalized: ClipProfile[] = [];

  for (const raw of profiles) {
    const name = raw.name?.trim();
    if (!raw.id || !name || !isKnownThemeId(raw.themeId)) continue;
    if (seenIds.has(raw.id)) continue;
    seenIds.add(raw.id);

    normalized.push({
      id: raw.id,
      name: name.slice(0, 40),
      themeId: normalizeThemeId(raw.themeId),
      barAlignment: normalizeBarAlignment(raw.barAlignment),
      customBackgroundId: normalizeBackgroundAssetId(raw.customBackgroundId),
    });

    if (normalized.length >= MAX_CLIP_PROFILES) break;
  }

  return normalized;
}

export function normalizeActiveProfileId(
  activeId: string | null | undefined,
  profiles: ClipProfile[],
): string | null {
  if (!activeId) return null;
  return profiles.some((profile) => profile.id === activeId) ? activeId : null;
}

export function getClipProfileById(
  prefs: UserPreferencesV1,
  profileId: string,
): ClipProfile | undefined {
  return prefs.appearance.savedProfiles?.find((profile) => profile.id === profileId);
}

export function appearanceMatchesProfile(
  appearance: AppearancePreferences,
  profile: ClipProfile,
): boolean {
  return (
    appearance.activeThemeId === profile.themeId &&
    (appearance.barAlignment ?? 'center') === profile.barAlignment &&
    (appearance.customBackgroundId ?? null) === (profile.customBackgroundId ?? null)
  );
}

export function findMatchingClipProfile(prefs: UserPreferencesV1): ClipProfile | undefined {
  const profiles = prefs.appearance.savedProfiles ?? [];
  return profiles.find((profile) => appearanceMatchesProfile(prefs.appearance, profile));
}

/** Recorder panel select value for a saved profile. */
export function profileSelectValue(profileId: string): string {
  return `profile:${profileId}`;
}

export function parseClipStyleSelectValue(value: string): { kind: 'profile'; profileId: string } | { kind: 'theme'; themeId: string } {
  if (value.startsWith('profile:')) {
    return { kind: 'profile', profileId: value.slice('profile:'.length) };
  }
  return { kind: 'theme', themeId: value };
}

export function resolveClipStyleSelectValue(prefs: UserPreferencesV1): string {
  const activeId = prefs.appearance.activeProfileId;
  if (activeId && getClipProfileById(prefs, activeId)) {
    return profileSelectValue(activeId);
  }
  return prefs.appearance.activeThemeId;
}