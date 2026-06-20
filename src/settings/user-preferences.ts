import type { BarAlignment } from '@/src/recorder/waveform';
import { THEME_STORAGE_KEY } from '@/src/theme/storage';
import { DEFAULT_THEME_ID, normalizeThemeId } from '@/src/theme/presets';

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
  /** Planned (pretty-4): simplify waveform motion when OS requests reduced motion. */
  respectReducedMotion?: boolean;
  /**
   * Planned (pretty-7): IndexedDB record id for a user-uploaded background image.
   * Canvas draws this during capture — not composited after transcode.
   */
  customBackgroundId?: string | null;
}

export interface AudioPreferences {
  /** Planned: bypass echoCancellation / noiseSuppression / autoGainControl. */
  rawMicCapture?: boolean;
  /** Planned: widen viz beyond voice-focused 80 Hz – 16 kHz range. */
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

function mergePreferences(raw: Partial<UserPreferencesV1> | undefined): UserPreferencesV1 {
  return {
    version: USER_PREFS_VERSION,
    appearance: {
      ...DEFAULT_USER_PREFERENCES.appearance,
      ...raw?.appearance,
      activeThemeId: normalizeThemeId(raw?.appearance?.activeThemeId),
      barAlignment: normalizeBarAlignment(raw?.appearance?.barAlignment),
    },
    audio: {
      ...DEFAULT_USER_PREFERENCES.audio,
      ...raw?.audio,
    },
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

export async function saveAppearancePreferences(
  patch: Partial<AppearancePreferences>,
): Promise<UserPreferencesV1> {
  const current = await loadUserPreferences();
  const next: UserPreferencesV1 = {
    ...current,
    appearance: {
      ...current.appearance,
      ...patch,
      activeThemeId: normalizeThemeId(patch.activeThemeId ?? current.appearance.activeThemeId),
      barAlignment: normalizeBarAlignment(patch.barAlignment ?? current.appearance.barAlignment),
    },
  };

  await browser.storage.local.set({
    [USER_PREFS_STORAGE_KEY]: next,
    [THEME_STORAGE_KEY]: next.appearance.activeThemeId,
  });

  return next;
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