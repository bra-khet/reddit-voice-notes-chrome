import type { BarAlignment } from '@/src/recorder/waveform';
import {
  normalizeBackgroundPosition,
  normalizeBackgroundScaleMode,
} from '@/src/theme/background-layout';
import type { BackgroundImagePosition, BackgroundScaleMode } from '@/src/theme/types';
import {
  createClipProfileId,
  getClipProfileById,
  MAX_CLIP_PROFILES,
  normalizeActiveProfileId,
  normalizeClipProfiles,
  resolveProfileStyleApplyState,
  type ClipProfile,
} from '@/src/settings/clip-profiles';
import { getPresetClipProfile, isPresetProfileId } from '@/src/settings/preset-profiles';
import {
  createCustomStyleId,
  customStyleBaseThemeId,
  defaultCustomStyleOverrides,
  isCustomStyleDirty,
  MAX_CUSTOM_STYLES,
  normalizeActiveCustomStyleId,
  normalizeCustomClipStyles,
  type CustomClipStyle,
} from '@/src/settings/custom-styles';
import { normalizeBackgroundAssetId } from '@/src/storage/image-db';
import {
  normalizeDesignOverrides,
  type DesignOverrides,
} from '@/src/theme/design-overrides';
import { THEME_STORAGE_KEY } from '@/src/theme/storage';
import { DEFAULT_THEME_ID, normalizeThemeId } from '@/src/theme/presets';
import {
  DEFAULT_TRANSCRIPT_CONFIG,
  normalizeTranscriptConfig,
  transcriptConfigForProfileStorage,
  type TranscriptConfig,
} from '@/src/transcription/types';
import {
  DEFAULT_VOICE_EFFECT_CONFIG,
  normalizeVoiceEffectConfig,
  type VoiceEffectConfig,
} from '@/src/voice/types';

export type { ClipProfile } from '@/src/settings/clip-profiles';
export { MAX_CLIP_PROFILES } from '@/src/settings/clip-profiles';
export type { CustomClipStyle } from '@/src/settings/custom-styles';
export { MAX_CUSTOM_STYLES } from '@/src/settings/custom-styles';
export type { DesignOverrides } from '@/src/theme/design-overrides';

/**
 * Versioned user preferences blob — forward-compatible home for popup settings.
 * CHANGED: scaffold for popup IA; appearance fields migrate from legacy keys.
 * WHY: popup is the long-lived settings surface; versioned merge avoids brittle one-off keys.
 */
export const USER_PREFS_STORAGE_KEY = 'rvnUserPrefs' as const;
export const USER_PREFS_VERSION = 1 as const;

/** Atomic subtitle on/off — immune to rvnUserPrefs read-modify-write races (BUG-019). */
export const SUBTITLES_ENABLED_STORAGE_KEY = 'rvnSubtitlesEnabled' as const;

const SUBTITLES_ENABLED_LOCAL_KEY = 'rvn.subtitles.enabled' as const;

/** Ms timestamp written when background saves a session transcript (studio refresh signal). */
export const SESSION_TRANSCRIPT_READY_KEY = 'rvnSessionTranscriptReadyAt' as const;

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
  /** Personal background scale: fit (letterbox) or fill (crop). Default fill. */
  backgroundScaleMode?: BackgroundScaleMode;
  /** Personal background anchor when letterboxing or cropping. Default center. */
  backgroundPosition?: BackgroundImagePosition;
  /** User-saved theme + alignment combos (pretty-6). */
  savedProfiles?: ClipProfile[];
  /** Active saved profile id, or null when using manual theme/alignment picks. */
  activeProfileId?: string | null;
  /** User-saved custom color styles based on Neon Glow (pretty-8). */
  savedCustomStyles?: CustomClipStyle[];
  /** Active saved custom style id, or null when using a preset or unsaved custom colors. */
  activeCustomStyleId?: string | null;
  /** Live custom color overrides — unsaved custom mode or edits atop a saved style. */
  designOverrides?: DesignOverrides | null;
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
  /** Active voice effect config for export (dulcet-3); profile snapshot in dulcet-4. */
  voiceEffect?: VoiceEffectConfig;
  /** Subtitle / transcript studio state (eloquent-2+). */
  transcriptConfig?: TranscriptConfig;
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
  voiceEffect: { ...DEFAULT_VOICE_EFFECT_CONFIG },
  transcriptConfig: { ...DEFAULT_TRANSCRIPT_CONFIG },
};

/** Synchronous cache on extension pages — survives design-studio tab close (BUG-019). */
export function readSubtitlesEnabledLocal(): boolean | null {
  try {
    const value = localStorage.getItem(SUBTITLES_ENABLED_LOCAL_KEY);
    if (value === '1') return true;
    if (value === '0') return false;
    return null;
  } catch {
    return null;
  }
}

export function writeSubtitlesEnabledLocal(enabled: boolean): void {
  try {
    localStorage.setItem(SUBTITLES_ENABLED_LOCAL_KEY, enabled ? '1' : '0');
  } catch {
    // localStorage may be unavailable in rare extension contexts.
  }
}

function applySubtitlesEnabledToConfig(
  config: TranscriptConfig | undefined,
  enabled: boolean,
): TranscriptConfig {
  const normalized = normalizeTranscriptConfig(config);
  return normalizeTranscriptConfig({
    ...normalized,
    transcriptionEnabled: enabled,
    style: {
      ...normalized.style,
      enabled,
    },
  });
}

async function readSubtitlesEnabledFlag(fallbackConfig?: TranscriptConfig): Promise<boolean> {
  const local = readSubtitlesEnabledLocal();
  if (local !== null) return local;

  const stored = await browser.storage.local.get(SUBTITLES_ENABLED_STORAGE_KEY);
  const chromeFlag = stored[SUBTITLES_ENABLED_STORAGE_KEY];
  if (typeof chromeFlag === 'boolean') return chromeFlag;

  return normalizeTranscriptConfig(fallbackConfig).transcriptionEnabled;
}

/** Persist subtitle on/off atomically before any rvnUserPrefs merge. */
export async function setSubtitlesEnabled(enabled: boolean): Promise<void> {
  writeSubtitlesEnabledLocal(enabled);
  await browser.storage.local.set({ [SUBTITLES_ENABLED_STORAGE_KEY]: enabled });
}

async function mergeSubtitlesEnabledIntoPrefs(next: UserPreferencesV1): Promise<UserPreferencesV1> {
  const enabled = await readSubtitlesEnabledFlag(next.transcriptConfig);
  return {
    ...next,
    transcriptConfig: applySubtitlesEnabledToConfig(next.transcriptConfig, enabled),
  };
}

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
  const savedCustomStyles = normalizeCustomClipStyles(raw?.savedCustomStyles);
  const savedProfiles = normalizeClipProfiles(raw?.savedProfiles, savedCustomStyles);
  const activeCustomStyleId = normalizeActiveCustomStyleId(
    raw?.activeCustomStyleId,
    savedCustomStyles,
  );
  const designOverrides = normalizeDesignOverrides(raw?.designOverrides);

  return {
    ...DEFAULT_USER_PREFERENCES.appearance,
    ...raw,
    activeThemeId: normalizeThemeId(raw?.activeThemeId),
    barAlignment: normalizeBarAlignment(raw?.barAlignment),
    savedProfiles,
    activeProfileId: normalizeActiveProfileId(raw?.activeProfileId, savedProfiles),
    customBackgroundId: normalizeBackgroundAssetId(raw?.customBackgroundId),
    backgroundScaleMode: normalizeBackgroundScaleMode(raw?.backgroundScaleMode),
    backgroundPosition: normalizeBackgroundPosition(raw?.backgroundPosition),
    savedCustomStyles,
    activeCustomStyleId,
    designOverrides,
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
    voiceEffect: normalizeVoiceEffectConfig(raw?.voiceEffect),
    transcriptConfig: normalizeTranscriptConfig(raw?.transcriptConfig),
  };
}

// BUG FIX: profile UI stale while rvnUserPrefs correct (BUG-023)
// Fix: serialize read-modify-write so subtitle saves cannot overwrite profile applies.
let prefsOpChain: Promise<unknown> = Promise.resolve();

function enqueuePrefsOp<T>(op: () => Promise<T>): Promise<T> {
  const task = prefsOpChain.then(op, op);
  prefsOpChain = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

async function commitUserPreferences(next: UserPreferencesV1): Promise<UserPreferencesV1> {
  const merged = await mergeSubtitlesEnabledIntoPrefs(next);
  await browser.storage.local.set({
    [USER_PREFS_STORAGE_KEY]: merged,
    [THEME_STORAGE_KEY]: merged.appearance.activeThemeId,
  });
  return merged;
}

/** Read + merge rvnUserPrefs. Call only while holding enqueuePrefsOp. */
async function readUserPreferencesBlob(): Promise<UserPreferencesV1> {
  const stored = await browser.storage.local.get(USER_PREFS_STORAGE_KEY);
  const raw = stored[USER_PREFS_STORAGE_KEY] as Partial<UserPreferencesV1> | undefined;

  if (!raw || raw.version !== USER_PREFS_VERSION) {
    const legacy = await browser.storage.local.get(THEME_STORAGE_KEY);
    const legacyId = legacy[THEME_STORAGE_KEY] as string | undefined;
    const base = mergePreferences(undefined);
    if (!legacyId) {
      return mergeSubtitlesEnabledIntoPrefs(base);
    }
    const migrated: UserPreferencesV1 = {
      ...base,
      appearance: {
        ...base.appearance,
        activeThemeId: normalizeThemeId(legacyId),
      },
    };
    return commitUserPreferences(migrated);
  }

  const merged = await mergeSubtitlesEnabledIntoPrefs(mergePreferences(raw));
  if (merged.appearance.activeThemeId !== raw.appearance?.activeThemeId) {
    return commitUserPreferences(merged);
  }
  return merged;
}

export async function loadUserPreferences(): Promise<UserPreferencesV1> {
  return enqueuePrefsOp(() => readUserPreferencesBlob());
}

export async function saveVoiceEffectPreferences(
  config: VoiceEffectConfig,
): Promise<UserPreferencesV1> {
  const current = await loadUserPreferences();
  const next: UserPreferencesV1 = {
    ...current,
    voiceEffect: normalizeVoiceEffectConfig(config),
  };

  return writeUserPreferences(next);
}

export async function saveTranscriptPreferences(
  config: TranscriptConfig,
): Promise<UserPreferencesV1> {
  const normalized = transcriptConfigForProfileStorage(normalizeTranscriptConfig(config));
  await setSubtitlesEnabled(normalized.transcriptionEnabled);
  return enqueuePrefsOp(async () => {
    const current = await readUserPreferencesBlob();
    return commitUserPreferences({
      ...current,
      transcriptConfig: normalized,
    });
  });
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

  return writeUserPreferences(next);
}

export async function saveAppearancePreferences(
  patch: Partial<AppearancePreferences>,
): Promise<UserPreferencesV1> {
  return enqueuePrefsOp(async () => {
    const current = await readUserPreferencesBlob();
    const next: UserPreferencesV1 = {
      ...current,
      appearance: mergeAppearancePreferences({
        ...current.appearance,
        ...patch,
        activeThemeId: normalizeThemeId(patch.activeThemeId ?? current.appearance.activeThemeId),
        barAlignment: normalizeBarAlignment(patch.barAlignment ?? current.appearance.barAlignment),
      }),
    };
    return commitUserPreferences(next);
  });
}

function voiceEffectFromProfile(profile: ClipProfile): VoiceEffectConfig | null {
  if (profile.voiceEffectConfig != null) {
    return normalizeVoiceEffectConfig(profile.voiceEffectConfig);
  }
  // Virtual bundled presets carry visual defaults only — keep live voice prefs.
  if (isPresetProfileId(profile.id)) {
    return null;
  }
  return normalizeVoiceEffectConfig(DEFAULT_VOICE_EFFECT_CONFIG);
}

function transcriptConfigFromProfile(profile: ClipProfile): TranscriptConfig | null {
  if (profile.transcriptConfig != null) {
    return normalizeTranscriptConfig(profile.transcriptConfig);
  }
  // BUG FIX: subtitle toggle reverts on studio exit (BUG-017)
  // Fix: legacy profiles without a transcript snapshot keep live global transcript prefs.
  return null;
}

async function writeUserPreferences(next: UserPreferencesV1): Promise<UserPreferencesV1> {
  return enqueuePrefsOp(() => commitUserPreferences(next));
}

export async function applyClipProfile(profileId: string): Promise<UserPreferencesV1> {
  return enqueuePrefsOp(async () => {
    const current = await readUserPreferencesBlob();
    const profile = getClipProfileById(current, profileId);
    if (!profile) {
      console.warn('[Reddit Voice Notes] applyClipProfile: unknown profile id', profileId);
      return current;
    }

    const styleState = resolveProfileStyleApplyState(
      profile,
      current.appearance.savedCustomStyles,
    );

    const next: UserPreferencesV1 = {
      ...current,
      appearance: mergeAppearancePreferences({
        ...current.appearance,
        activeThemeId: styleState.activeThemeId,
        barAlignment: profile.barAlignment,
        customBackgroundId: profile.customBackgroundId ?? null,
        backgroundScaleMode: profile.backgroundScaleMode,
        backgroundPosition: profile.backgroundPosition,
        activeCustomStyleId: styleState.activeCustomStyleId,
        designOverrides: styleState.designOverrides,
        activeProfileId: profile.id,
      }),
      voiceEffect: voiceEffectFromProfile(profile) ?? current.voiceEffect,
      transcriptConfig: transcriptConfigFromProfile(profile) ?? current.transcriptConfig,
    };

    return commitUserPreferences(next);
  });
}

export type SaveClipProfileOptions = {
  /** Snapshot live color edits on the profile instead of linking a dirty saved style. */
  embedDirtyStyleOverrides?: boolean;
};

export async function saveCurrentAsClipProfile(
  name: string,
  options?: SaveClipProfileOptions,
): Promise<UserPreferencesV1> {
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

  const linkedStyleId = current.appearance.activeCustomStyleId ?? null;
  const linkedStyleDirty =
    Boolean(linkedStyleId) && isCustomStyleDirty(current.appearance);
  const embedOverrides = Boolean(options?.embedDirtyStyleOverrides && linkedStyleDirty);
  const customStyleId = embedOverrides ? null : linkedStyleId;
  const designOverrides = customStyleId
    ? null
    : (normalizeDesignOverrides(current.appearance.designOverrides) ?? null);

  const profile: ClipProfile = {
    id: createClipProfileId(),
    name: trimmed.slice(0, 40),
    themeId: current.appearance.activeThemeId,
    barAlignment: current.appearance.barAlignment ?? 'center',
    customBackgroundId: current.appearance.customBackgroundId ?? null,
    backgroundScaleMode: current.appearance.backgroundScaleMode,
    backgroundPosition: current.appearance.backgroundPosition,
    customStyleId,
    designOverrides,
    voiceEffectConfig: normalizeVoiceEffectConfig(current.voiceEffect),
    transcriptConfig: transcriptConfigForProfileStorage(current.transcriptConfig),
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
  if (isPresetProfileId(profileId)) {
    throw new Error('Built-in clip styles cannot be updated. Save as a new profile instead.');
  }

  const profiles = (current.appearance.savedProfiles ?? []).map((profile) => {
    if (profile.id !== profileId) return profile;
    return {
      ...profile,
      themeId: current.appearance.activeThemeId,
      barAlignment: current.appearance.barAlignment ?? 'center',
      customBackgroundId: current.appearance.customBackgroundId ?? null,
      backgroundScaleMode: current.appearance.backgroundScaleMode,
      backgroundPosition: current.appearance.backgroundPosition,
      customStyleId: current.appearance.activeCustomStyleId ?? null,
      designOverrides: current.appearance.activeCustomStyleId
        ? null
        : (normalizeDesignOverrides(current.appearance.designOverrides) ?? null),
      voiceEffectConfig: normalizeVoiceEffectConfig(current.voiceEffect),
      transcriptConfig: transcriptConfigForProfileStorage(current.transcriptConfig),
    };
  });

  if (!profiles.some((profile) => profile.id === profileId)) {
    throw new Error('Active profile no longer exists.');
  }

  return saveAppearancePreferences({ savedProfiles: profiles });
}

export async function applyCustomClipStyle(styleId: string): Promise<UserPreferencesV1> {
  const current = await loadUserPreferences();
  const style = current.appearance.savedCustomStyles?.find((entry) => entry.id === styleId);
  if (!style) return current;

  return saveAppearancePreferences({
    activeThemeId: style.baseThemeId,
    activeCustomStyleId: style.id,
    designOverrides: { ...style.designOverrides },
  });
}

export async function enterCustomStyleMode(): Promise<UserPreferencesV1> {
  return saveAppearancePreferences({
    activeThemeId: customStyleBaseThemeId(),
    activeCustomStyleId: null,
    designOverrides: defaultCustomStyleOverrides(),
  });
}

export async function applyPresetClipStyle(themeId: string): Promise<UserPreferencesV1> {
  // BUG FIX: preset switch dropped saved profile in Design Studio
  // Fix: keep activeProfileId — bundled presets are style templates; switching them edits the active profile like custom color tweaks
  return saveAppearancePreferences({
    activeThemeId: themeId,
    activeCustomStyleId: null,
    designOverrides: null,
  });
}

/** Recorder popup: apply a bundled preset via its virtual dummy profile (pretty-8). */
export async function applyPresetClipProfile(themeId: string): Promise<UserPreferencesV1> {
  const profile = getPresetClipProfile(themeId);
  if (!profile) return loadUserPreferences();
  return applyClipProfile(profile.id);
}

export async function saveCustomStyleColors(
  overrides: DesignOverrides,
): Promise<UserPreferencesV1> {
  const normalized = normalizeDesignOverrides(overrides);
  if (!normalized) {
    throw new Error('Pick a valid color first.');
  }
  return saveAppearancePreferences({ designOverrides: normalized });
}

export async function saveCurrentAsCustomStyle(name: string): Promise<UserPreferencesV1> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Enter a style name.');
  }

  const current = await loadUserPreferences();
  const overrides = normalizeDesignOverrides(current.appearance.designOverrides);
  if (!overrides) {
    throw new Error('Pick a custom color before saving.');
  }

  const styles = [...(current.appearance.savedCustomStyles ?? [])];
  if (styles.length >= MAX_CUSTOM_STYLES) {
    throw new Error(`You can save up to ${MAX_CUSTOM_STYLES} custom styles.`);
  }

  const duplicate = styles.find((style) => style.name.toLowerCase() === trimmed.toLowerCase());
  if (duplicate) {
    throw new Error('A style with that name already exists.');
  }

  const style: CustomClipStyle = {
    id: createCustomStyleId(),
    name: trimmed.slice(0, 40),
    baseThemeId: customStyleBaseThemeId(),
    designOverrides: overrides,
  };

  return saveAppearancePreferences({
    savedCustomStyles: [...styles, style],
    activeCustomStyleId: style.id,
    activeThemeId: style.baseThemeId,
    designOverrides: { ...overrides },
  });
}

export async function updateActiveCustomStyle(): Promise<UserPreferencesV1> {
  const current = await loadUserPreferences();
  const styleId = current.appearance.activeCustomStyleId;
  if (!styleId) {
    throw new Error('Select a saved custom style to update.');
  }

  const overrides = normalizeDesignOverrides(current.appearance.designOverrides);
  if (!overrides) {
    throw new Error('Pick a valid color first.');
  }

  const styles = (current.appearance.savedCustomStyles ?? []).map((style) => {
    if (style.id !== styleId) return style;
    return { ...style, designOverrides: overrides };
  });

  if (!styles.some((style) => style.id === styleId)) {
    throw new Error('Active custom style no longer exists.');
  }

  return saveAppearancePreferences({ savedCustomStyles: styles });
}

export async function deleteCustomClipStyle(styleId: string): Promise<UserPreferencesV1> {
  const current = await loadUserPreferences();
  const styles = (current.appearance.savedCustomStyles ?? []).filter(
    (style) => style.id !== styleId,
  );

  const profiles = (current.appearance.savedProfiles ?? []).map((profile) => {
    if (profile.customStyleId !== styleId) return profile;
    return {
      ...profile,
      themeId: DEFAULT_THEME_ID,
      customStyleId: null,
      designOverrides: null,
    };
  });

  const activeProfileId = current.appearance.activeProfileId;
  const activeProfileUsedStyle =
    Boolean(activeProfileId) &&
    (current.appearance.savedProfiles ?? []).some(
      (profile) => profile.id === activeProfileId && profile.customStyleId === styleId,
    );

  const patch: Partial<AppearancePreferences> = {
    savedCustomStyles: styles,
    savedProfiles: profiles,
  };

  if (current.appearance.activeCustomStyleId === styleId) {
    patch.activeCustomStyleId = null;
    patch.designOverrides = null;
    patch.activeThemeId = DEFAULT_THEME_ID;
  }

  if (activeProfileUsedStyle && activeProfileId) {
    const reverted = profiles.find((profile) => profile.id === activeProfileId);
    if (reverted) {
      patch.activeThemeId = reverted.themeId;
      patch.activeCustomStyleId = null;
      patch.designOverrides = null;
    }
  }

  return saveAppearancePreferences(patch);
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
    if (
      !(USER_PREFS_STORAGE_KEY in changes) &&
      !(THEME_STORAGE_KEY in changes) &&
      !(SUBTITLES_ENABLED_STORAGE_KEY in changes)
    ) {
      return;
    }
    void loadUserPreferences().then(listener);
  };

  browser.storage.onChanged.addListener(handler);
  return () => browser.storage.onChanged.removeListener(handler);
}