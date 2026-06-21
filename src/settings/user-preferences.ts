import type { BarAlignment } from '@/src/recorder/waveform';
import {
  createClipProfileId,
  MAX_CLIP_PROFILES,
  normalizeActiveProfileId,
  normalizeClipProfiles,
  type ClipProfile,
} from '@/src/settings/clip-profiles';
import { normalizeBackgroundAssetId } from '@/src/storage/image-db';
import { THEME_STORAGE_KEY } from '@/src/theme/storage';
import { DEFAULT_THEME_ID, normalizeThemeId } from '@/src/theme/presets';

export type { ClipProfile } from '@/src/settings/clip-profiles';
export { MAX_CLIP_PROFILES } from '@/src/settings/clip-profiles';

/**
 * Versioned user preferences blob — forward-compatible home for popup settings.
 * CHANGED: scaffold for popup IA; appearance fields migrate from legacy keys.
 * WHY: popup is the long-lived settings surface; versioned merge avoids brittle one-off keys.
 */
export const USER_PREFS_STORAGE_KEY = 'rvnUserPrefs' as const;
export const USER_PREFS_VERSION = 1 as const;

export interface AppearancePreferences {
  activeThemeId: string;
  /** Center-mirrored (default), bottom, or top bar anchoring. */
  barAlignment?: BarAlignment;
  /** When true, simplify waveform motion if the OS requests reduced motion (pretty-4 draw). */
  respectReducedMotion?: boolean;
  /**
   * ImageDB record id (`bg-…`) for a user-uploaded background (pretty-7).
   * Blob lives in IndexedDB; prefs store only this reference.
   */
  customBackgroundId?: string | null;
  /** User-saved theme + alignment combos (pretty-6). */
  savedProfiles?: ClipProfile[];
  /** Active saved profile id, or null when using manual theme/alignment picks. */
  activeProfileId?: string | null;
}

export interface AudioPreferences {
  /**
   * Bypass echoCancellation / noiseSuppression / autoGainControl (pretty-3).
   * Default false — browser DSP stays on for speech-friendly economy capture.
   */
  rawMicCapture?: boolean;
  /**
   * Request ideal 48 kHz + ideal stereo via getUserMedia (pretty-3).
   * Default false — economy path uses browser defaults. Pairs well with headsets;
   * degrades gracefully when hardware cannot honor ideals.
   */
  preferHighQualityCapture?: boolean;
  /** Widen viz beyond voice-focused 80 Hz – 16 kHz range (pretty-3). */
  fullSpectrumViz?: boolean;
}

export interface NotificationPreferences {
  /** Planned: show attach/download toasts after recording. */
  showResultToasts?: boolean;
}

export interface UserPreferencesV1 {
  version: typeof USER_PREFS_VERSION;
  appearance: AppearancePreferences;
  audio: AudioPreferences;
  notifications: NotificationPreferences;
}

export const DEFAULT_USER_PREFERENCES: UserPreferencesV1 = {
  version: USER_PREFS_VERSION,
  appearance: {
    activeThemeId: DEFAULT_THEME_ID,
    barAlignment: 'center',
    respectReducedMotion: true,
  },
  audio: {
    rawMicCapture: false,
    preferHighQualityCapture: false,
    fullSpectrumViz: false,
  },
  notifications: {
    showResultToasts: true,
  },
};

const VALID_BAR_ALIGNMENTS: readonly BarAlignment[] = ['center', 'bottom', 'top'];

function normalizeBarAlignment(alignment: BarAlignment | undefined): BarAlignment {
  if (alignment && VALID_BAR_ALIGNMENTS.includes(alignment)) return alignment;
  return DEFAULT_USER_PREFERENCES.appearance.barAlignment ?? 'center';
}

function normalizeAudioPreferences(audio: Partial<AudioPreferences> | undefined): AudioPreferences {
  return {
    rawMicCapture: audio?.rawMicCapture ?? DEFAULT_USER_PREFERENCES.audio.rawMicCapture ?? false,
    preferHighQualityCapture:
      audio?.preferHighQualityCapture ??
      DEFAULT_USER_PREFERENCES.audio.preferHighQualityCapture ??
      false,
    fullSpectrumViz: audio?.fullSpectrumViz ?? DEFAULT_USER_PREFERENCES.audio.fullSpectrumViz ?? false,
  };
}

function mergeAppearancePreferences(
  raw: Partial<AppearancePreferences> | undefined,
): AppearancePreferences {
  const savedProfiles = normalizeClipProfiles(raw?.savedProfiles);
  return {
    ...DEFAULT_USER_PREFERENCES.appearance,
    ...raw,
    activeThemeId: normalizeThemeId(raw?.activeThemeId),
    barAlignment: normalizeBarAlignment(raw?.barAlignment),
    savedProfiles,
    activeProfileId: normalizeActiveProfileId(raw?.activeProfileId, savedProfiles),
    customBackgroundId: normalizeBackgroundAssetId(raw?.customBackgroundId),
  };
}

function mergePreferences(raw: Partial<UserPreferencesV1> | undefined): UserPreferencesV1 {
  return {
    version: USER_PREFS_VERSION,
    appearance: mergeAppearancePreferences({
      ...DEFAULT_USER_PREFERENCES.appearance,
      ...raw?.appearance,
    }),
    audio: normalizeAudioPreferences({
      ...DEFAULT_USER_PREFERENCES.audio,
      ...raw?.audio,
    }),
    notifications: {
      ...DEFAULT_USER_PREFERENCES.notifications,
      ...raw?.notifications,
    },
  };
}

/** One-time migration: legacy `rvnActiveThemeId` → versioned prefs blob. */
async function migrateLegacyThemeKey(prefs: UserPreferencesV1): Promise<UserPreferencesV1> {
  const legacy = await browser.storage.local.get(THEME_STORAGE_KEY);
  const legacyId = legacy[THEME_STORAGE_KEY] as string | undefined;
  if (!legacyId) return prefs;

  const migrated: UserPreferencesV1 = {
    ...prefs,
    appearance: {
      ...prefs.appearance,
      activeThemeId: normalizeThemeId(legacyId),
    },
  };

  await browser.storage.local.set({
    [USER_PREFS_STORAGE_KEY]: migrated,
    [THEME_STORAGE_KEY]: migrated.appearance.activeThemeId,
  });

  return migrated;
}

export async function loadUserPreferences(): Promise<UserPreferencesV1> {
  const stored = await browser.storage.local.get(USER_PREFS_STORAGE_KEY);
  const raw = stored[USER_PREFS_STORAGE_KEY] as Partial<UserPreferencesV1> | undefined;

  if (!raw || raw.version !== USER_PREFS_VERSION) {
    return migrateLegacyThemeKey(DEFAULT_USER_PREFERENCES);
  }

  const merged = mergePreferences(raw);
  if (merged.appearance.activeThemeId !== raw.appearance?.activeThemeId) {
    await browser.storage.local.set({
      [USER_PREFS_STORAGE_KEY]: merged,
      [THEME_STORAGE_KEY]: merged.appearance.activeThemeId,
    });
  }

  return merged;
}

export async function saveAudioPreferences(
  patch: Partial<AudioPreferences>,
): Promise<UserPreferencesV1> {
  const current = await loadUserPreferences();
  const next: UserPreferencesV1 = {
    ...current,
    audio: normalizeAudioPreferences({
      ...current.audio,
      ...patch,
    }),
  };

  await browser.storage.local.set({ [USER_PREFS_STORAGE_KEY]: next });
  return next;
}

export async function saveAppearancePreferences(
  patch: Partial<AppearancePreferences>,
): Promise<UserPreferencesV1> {
  const current = await loadUserPreferences();
  const next: UserPreferencesV1 = {
    ...current,
    appearance: mergeAppearancePreferences({
      ...current.appearance,
      ...patch,
      activeThemeId: normalizeThemeId(patch.activeThemeId ?? current.appearance.activeThemeId),
      barAlignment: normalizeBarAlignment(patch.barAlignment ?? current.appearance.barAlignment),
    }),
  };

  await browser.storage.local.set({
    [USER_PREFS_STORAGE_KEY]: next,
    [THEME_STORAGE_KEY]: next.appearance.activeThemeId,
  });

  return next;
}

export async function applyClipProfile(profileId: string): Promise<UserPreferencesV1> {
  const current = await loadUserPreferences();
  const profile = current.appearance.savedProfiles?.find((entry) => entry.id === profileId);
  if (!profile) return current;

  return saveAppearancePreferences({
    activeThemeId: profile.themeId,
    barAlignment: profile.barAlignment,
    customBackgroundId: profile.customBackgroundId ?? null,
    activeProfileId: profile.id,
  });
}

export async function saveCurrentAsClipProfile(name: string): Promise<UserPreferencesV1> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Enter a profile name.');
  }

  const current = await loadUserPreferences();
  const profiles = [...(current.appearance.savedProfiles ?? [])];

  if (profiles.length >= MAX_CLIP_PROFILES) {
    throw new Error(`You can save up to ${MAX_CLIP_PROFILES} profiles.`);
  }

  const duplicate = profiles.find(
    (profile) => profile.name.toLowerCase() === trimmed.toLowerCase(),
  );
  if (duplicate) {
    throw new Error('A profile with that name already exists.');
  }

  const profile: ClipProfile = {
    id: createClipProfileId(),
    name: trimmed.slice(0, 40),
    themeId: current.appearance.activeThemeId,
    barAlignment: current.appearance.barAlignment ?? 'center',
    customBackgroundId: current.appearance.customBackgroundId ?? null,
  };

  return saveAppearancePreferences({
    savedProfiles: [...profiles, profile],
    activeProfileId: profile.id,
  });
}

export async function updateActiveClipProfile(): Promise<UserPreferencesV1> {
  const current = await loadUserPreferences();
  const profileId = current.appearance.activeProfileId;
  if (!profileId) {
    throw new Error('Select a saved profile to update.');
  }

  const profiles = (current.appearance.savedProfiles ?? []).map((profile) => {
    if (profile.id !== profileId) return profile;
    return {
      ...profile,
      themeId: current.appearance.activeThemeId,
      barAlignment: current.appearance.barAlignment ?? 'center',
      customBackgroundId: current.appearance.customBackgroundId ?? null,
    };
  });

  if (!profiles.some((profile) => profile.id === profileId)) {
    throw new Error('Active profile no longer exists.');
  }

  return saveAppearancePreferences({ savedProfiles: profiles });
}

export async function deleteClipProfile(profileId: string): Promise<UserPreferencesV1> {
  const current = await loadUserPreferences();
  const profiles = (current.appearance.savedProfiles ?? []).filter(
    (profile) => profile.id !== profileId,
  );
  const activeProfileId =
    current.appearance.activeProfileId === profileId ? null : current.appearance.activeProfileId;

  return saveAppearancePreferences({
    savedProfiles: profiles,
    activeProfileId,
  });
}

/** True when prefs allow honoring the OS reduced-motion preference. */
export function shouldReduceMotion(prefs: UserPreferencesV1): boolean {
  if (prefs.appearance.respectReducedMotion === false) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function onUserPreferencesChanged(
  listener: (prefs: UserPreferencesV1) => void,
): () => void {
  const handler = (
    changes: Record<string, { newValue?: unknown }>,
    area: string,
  ) => {
    if (area !== 'local') return;
    if (!(USER_PREFS_STORAGE_KEY in changes) && !(THEME_STORAGE_KEY in changes)) return;
    void loadUserPreferences().then(listener);
  };

  browser.storage.onChanged.addListener(handler);
  return () => browser.storage.onChanged.removeListener(handler);
}