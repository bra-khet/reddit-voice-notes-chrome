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
  /** When true, simplify waveform motion if the OS requests reduced motion (pretty-2 UI; pretty-4 draw). */
  respectReducedMotion?: boolean;
  /**
   * Planned (pretty-7): IndexedDB record id for a user-uploaded background image.
   * Canvas draws this during capture — not composited after transcode.
   */
  customBackgroundId?: string | null;
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

function mergePreferences(raw: Partial<UserPreferencesV1> | undefined): UserPreferencesV1 {
  return {
    version: USER_PREFS_VERSION,
    appearance: {
      ...DEFAULT_USER_PREFERENCES.appearance,
      ...raw?.appearance,
      activeThemeId: normalizeThemeId(raw?.appearance?.activeThemeId),
      barAlignment: normalizeBarAlignment(raw?.appearance?.barAlignment),
    },
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