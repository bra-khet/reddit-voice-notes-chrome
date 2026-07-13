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
  dbSnapshotFromUserPreferences,
  loadUserPrefsDbSnapshot,
  measureUserPrefsSnapshot,
  replaceUserPrefsDbSnapshot,
  USER_PREFS_DB_SCHEMA_VERSION,
  type UserPrefsDbSnapshot,
} from '@/src/storage/user-prefs-db';
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
// CHANGED: v5.11.0 keeps public UserPreferencesV1 at v1 while persistence moves to schema v2.
// WHY: callers keep their exact type contract; this tiny local key is only a post-IDB change signal.
const USER_PREFS_V2_COORDINATOR_KEY = 'rvnUserPrefs.v2' as const;
const USER_PREFS_TRANSFER_TYPE = 'rvn-user-preferences-v1' as const;
const MAX_USER_PREFS_IMPORT_BYTES = 2 * 1024 * 1024;
const USER_PREFS_TOTAL_WARNING_BYTES = 256 * 1024;
const USER_PREFS_RECORD_WARNING_BYTES = 64 * 1024;

interface UserPrefsV2Coordinator {
  schemaVersion: typeof USER_PREFS_DB_SCHEMA_VERSION;
  revision: number;
  migratedAt: number;
  updatedAt: number;
}

interface UserPreferencesExportPayload {
  type: typeof USER_PREFS_TRANSFER_TYPE;
  exportedAt: string;
  preferences: UserPreferencesV1;
}
/** One-time marker — flips stored v5.3.10 rollout `webCodecsBake: false` to true. */
export const WEBCODECS_BAKE_ROLLOUT_MIGRATED_KEY = 'rvnWebCodecsBakeRolloutMigrated' as const;
/** One-time marker — flips stored v5.5.0 rollout `browserComposite: false` to true. */
export const BROWSER_COMPOSITE_ROLLOUT_MIGRATED_KEY = 'rvnBrowserCompositeRolloutMigrated' as const;

/** Atomic subtitle on/off — immune to rvnUserPrefs read-modify-write races (BUG-019). */
export const SUBTITLES_ENABLED_STORAGE_KEY = 'rvnSubtitlesEnabled' as const;

const SUBTITLES_ENABLED_LOCAL_KEY = 'rvn.subtitles.enabled' as const;

/** Ms timestamp written when background saves a session transcript (studio refresh signal). */
export const SESSION_TRANSCRIPT_READY_KEY = 'rvnSessionTranscriptReadyAt' as const;
/** Set when Design Studio finishes subtitle burn-in — recorder tab fetches baked MP4. */
export const BAKED_MP4_READY_KEY = 'rvnBakedMp4ReadyAt' as const;

/** Ms timestamp written when background saves the last WebM for voice preview (studio refresh signal). */
export const LAST_RECORDING_READY_KEY = 'rvnLastRecordingReadyAt' as const;

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

export interface ExperimentalPreferences {
  /**
   * v5.3.9 parallel chunked subtitle bake. Default true — eligible clips
   * (≥20 s, enough cores/memory) render overlay chunks concurrently; set false
   * to force the serial render path. Sync: subtitle-bake.ts, subtitle-overlay-parallel.ts
   */
  parallelBake?: boolean;
  /**
   * v5.3.10 WebCodecs overlay encoding. Default true after v5.3.10 QA — when
   * enabled, production bake uses the VideoEncoder dual-stream path
   * (probe-gated `'auto'`) and falls back to the MediaRecorder pipeline on any
   * failure. Set false to force the legacy MediaRecorder path.
   * Sync: subtitle-bake.ts, subtitle-canvas-bake.ts encoder,
   *       subtitle-overlay-webcodecs.ts
   */
  webCodecsBake?: boolean;
  /**
   * v5.5.0 browser-side full composite (ADR-0003). Default true since v5.5.1 —
   * probe-gated in-page decode/blend/encode/mux; set false to force the legacy
   * FFmpeg composite chain. Overlay Lab is dev-only, so production bakes read
   * this flag (not the Lab toggle).
   * Sync: subtitle-bake.ts, subtitle-canvas-bake.ts composite,
   *       src/composite/browser-composite.ts
   */
  browserComposite?: boolean;
  /**
   * v5.7.0 Phase 2b — partial re-bake splice. Default ON after single-machine
   * real-browser QA (AVC + VP9, 2026-07-08). Opt-out: set `false`. When on, a
   * re-bake whose cue edit dirties only a few keyframe-aligned regions splices
   * the freshly-composited regions into the previous baked MP4 instead of a full
   * composite; the executor self-verifies (kept-region pixel equality) and any
   * miss falls back to the full composite. Sync: subtitle-bake.ts,
   *       src/editing/partial-rebake-coordinator.ts, src/composite/composite-splice.ts
   */
  partialRebakeSplice?: boolean;
}

/** Production bake encoder resolved from experimental prefs (v5.3.10). */
export type OverlayBakeEncoderPreference = 'auto' | 'mediarecorder';

/** v5.5.0 — composite executor for the WebCodecs bake path (ADR-0003). */
export type OverlayCompositeStrategyPreference = 'browser' | 'ffmpeg';

/**
 * v5.5.1 — browser composite default-on; opt-out only (`browserComposite === false`).
 * Probe failure still falls through to legacy FFmpeg composite in the bake orchestrator.
 */
export function resolveOverlayCompositeStrategy(
  experimental?: ExperimentalPreferences,
): OverlayCompositeStrategyPreference {
  return experimental?.browserComposite === false ? 'ffmpeg' : 'browser';
}

/**
 * v5.7.0 Phase 2b — partial re-bake splice. Default-on after real-browser QA
 * (AVC + VP9); opt-out only (`partialRebakeSplice === false`). Misses (scan
 * gate, fidelity gate, plan full) still fall back to full composite honestly.
 */
export function resolvePartialRebakeSpliceEnabled(
  experimental?: ExperimentalPreferences,
): boolean {
  return experimental?.partialRebakeSplice !== false;
}

/** v5.3.9 — parallel chunked render unless explicitly disabled. */
export function resolveParallelBakeEnabled(
  experimental?: ExperimentalPreferences,
): boolean {
  return experimental?.parallelBake !== false;
}

/**
 * v5.3.10 — WebCodecs dual-stream encode with probe-gated fallback.
 * Opt-out only (`webCodecsBake === false`); undefined/true → `'auto'`.
 */
export function resolveOverlayBakeEncoder(
  experimental?: ExperimentalPreferences,
): OverlayBakeEncoderPreference {
  return experimental?.webCodecsBake === false ? 'mediarecorder' : 'auto';
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
  /** Experimental feature flags (v5.3.9+). */
  experimental?: ExperimentalPreferences;
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
  experimental: {
    parallelBake: true,
    webCodecsBake: true,
    browserComposite: true,
    partialRebakeSplice: true,
  },
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
    experimental: mergeExperimentalPreferences(raw?.experimental),
  };
}

function mergeExperimentalPreferences(
  raw: Partial<ExperimentalPreferences> | undefined,
): ExperimentalPreferences {
  return {
    ...DEFAULT_USER_PREFERENCES.experimental,
    ...raw,
  };
}

/** Flip stored rollout-default `webCodecsBake: false` once; preserves future opt-out. */
async function migrateWebCodecsBakeRolloutIfNeeded(
  merged: UserPreferencesV1,
  raw: Partial<UserPreferencesV1> | undefined,
): Promise<UserPreferencesV1> {
  const markers = await browser.storage.local.get(WEBCODECS_BAKE_ROLLOUT_MIGRATED_KEY);
  if (markers[WEBCODECS_BAKE_ROLLOUT_MIGRATED_KEY]) {
    return merged;
  }
  const hadRolloutDefaultFalse = raw?.experimental?.webCodecsBake === false;
  await browser.storage.local.set({ [WEBCODECS_BAKE_ROLLOUT_MIGRATED_KEY]: true });
  if (!hadRolloutDefaultFalse) {
    return merged;
  }
  return commitUserPreferences({
    ...merged,
    experimental: {
      ...merged.experimental,
      webCodecsBake: true,
    },
  });
}

/** Flip stored v5.5.0 rollout-default `browserComposite: false` once; preserves future opt-out. */
async function migrateBrowserCompositeRolloutIfNeeded(
  merged: UserPreferencesV1,
  raw: Partial<UserPreferencesV1> | undefined,
): Promise<UserPreferencesV1> {
  const markers = await browser.storage.local.get(BROWSER_COMPOSITE_ROLLOUT_MIGRATED_KEY);
  if (markers[BROWSER_COMPOSITE_ROLLOUT_MIGRATED_KEY]) {
    return merged;
  }
  const hadRolloutDefaultFalse = raw?.experimental?.browserComposite === false;
  await browser.storage.local.set({ [BROWSER_COMPOSITE_ROLLOUT_MIGRATED_KEY]: true });
  if (!hadRolloutDefaultFalse) {
    return merged;
  }
  return commitUserPreferences({
    ...merged,
    experimental: {
      ...merged.experimental,
      browserComposite: true,
    },
  });
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isUserPrefsV2Coordinator(value: unknown): value is UserPrefsV2Coordinator {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === USER_PREFS_DB_SCHEMA_VERSION &&
    typeof value.revision === 'number' &&
    Number.isFinite(value.revision) &&
    typeof value.migratedAt === 'number' &&
    Number.isFinite(value.migratedAt) &&
    typeof value.updatedAt === 'number' &&
    Number.isFinite(value.updatedAt)
  );
}

function isLegacyUserPreferences(value: unknown): value is Partial<UserPreferencesV1> {
  return isRecord(value) && value.version === USER_PREFS_VERSION;
}

function preferencesFromDbSnapshot(snapshot: UserPrefsDbSnapshot): Partial<UserPreferencesV1> {
  return {
    version: snapshot.global.version,
    appearance: {
      ...snapshot.global.appearance,
      savedProfiles: snapshot.profiles,
      savedCustomStyles: snapshot.customStyles,
    },
    audio: snapshot.global.audio,
    notifications: snapshot.global.notifications,
    voiceEffect: snapshot.global.voiceEffect,
    transcriptConfig: snapshot.global.transcriptConfig,
    experimental: snapshot.global.experimental,
  };
}

function nextPrefsCoordinator(previous: unknown): UserPrefsV2Coordinator {
  const now = Date.now();
  const current = isUserPrefsV2Coordinator(previous) ? previous : undefined;
  return {
    schemaVersion: USER_PREFS_DB_SCHEMA_VERSION,
    revision: Math.max(now, (current?.revision ?? 0) + 1),
    migratedAt: current?.migratedAt ?? now,
    updatedAt: now,
  };
}

function logUserPrefsSize(
  snapshot: UserPrefsDbSnapshot,
  coordinator: UserPrefsV2Coordinator,
): void {
  const sizes = measureUserPrefsSnapshot(snapshot);
  const coordinatorBytes = new TextEncoder().encode(JSON.stringify(coordinator)).byteLength;
  console.info('[Reddit Voice Notes] User preferences saved', {
    ...sizes,
    coordinatorBytes,
    totalWithCoordinatorBytes: sizes.totalBytes + coordinatorBytes,
    profileCount: snapshot.profiles.length,
    customStyleCount: snapshot.customStyles.length,
  });

  if (
    import.meta.env.DEV &&
    (sizes.totalBytes > USER_PREFS_TOTAL_WARNING_BYTES ||
      sizes.maxRecordBytes > USER_PREFS_RECORD_WARNING_BYTES)
  ) {
    console.warn('[Reddit Voice Notes] Large user-preferences payload', {
      totalBytes: sizes.totalBytes,
      maxRecordBytes: sizes.maxRecordBytes,
      totalWarningBytes: USER_PREFS_TOTAL_WARNING_BYTES,
      recordWarningBytes: USER_PREFS_RECORD_WARNING_BYTES,
    });
  }
}

async function commitUserPreferences(next: UserPreferencesV1): Promise<UserPreferencesV1> {
  const merged = await mergeSubtitlesEnabledIntoPrefs(next);
  const stored = await browser.storage.local.get(USER_PREFS_V2_COORDINATOR_KEY);
  const coordinator = nextPrefsCoordinator(stored[USER_PREFS_V2_COORDINATOR_KEY]);
  const snapshot = dbSnapshotFromUserPreferences(merged);

  // CHANGED: persist the complete v2 snapshot before publishing its local-storage revision.
  // WHY: mirrors H13 persist-before-publish and prevents listeners observing an uncommitted IDB state.
  await replaceUserPrefsDbSnapshot(snapshot);
  await browser.storage.local.set({
    [USER_PREFS_V2_COORDINATOR_KEY]: coordinator,
    [THEME_STORAGE_KEY]: merged.appearance.activeThemeId,
  });
  logUserPrefsSize(snapshot, coordinator);
  return merged;
}

async function removeMigratedLegacyBlob(): Promise<void> {
  try {
    await browser.storage.local.remove(USER_PREFS_STORAGE_KEY);
  } catch (error) {
    console.warn('[Reddit Voice Notes] Could not remove migrated rvnUserPrefs blob', error);
  }
}

/** Read + merge the v2 IDB snapshot, with one-time v1 fallback migration. */
async function readUserPreferencesBlob(): Promise<UserPreferencesV1> {
  const stored = await browser.storage.local.get([
    USER_PREFS_STORAGE_KEY,
    USER_PREFS_V2_COORDINATOR_KEY,
  ]);
  const legacyCandidate = stored[USER_PREFS_STORAGE_KEY];
  const legacyRaw = isLegacyUserPreferences(legacyCandidate)
    ? legacyCandidate
    : undefined;
  const coordinator = stored[USER_PREFS_V2_COORDINATOR_KEY];

  let dbSnapshot: UserPrefsDbSnapshot | null;
  try {
    dbSnapshot = await loadUserPrefsDbSnapshot();
  } catch (error) {
    if (legacyRaw) {
      // CHANGED: a failed first migration leaves the legacy blob intact and usable.
      // WHY: migration is retryable and must never delete or strand the only good preference copy.
      console.warn('[Reddit Voice Notes] Using legacy user preferences after IDB failure', error);
      return mergeSubtitlesEnabledIntoPrefs(mergePreferences(legacyRaw));
    }
    throw error;
  }

  let raw: Partial<UserPreferencesV1>;
  let publishedV2 = isUserPrefsV2Coordinator(coordinator);
  let removeLegacyAfterSuccess = false;

  if (dbSnapshot) {
    raw = preferencesFromDbSnapshot(dbSnapshot);
    removeLegacyAfterSuccess = Boolean(legacyRaw);
  } else if (legacyRaw) {
    raw = legacyRaw;
    const migrated = await mergeSubtitlesEnabledIntoPrefs(mergePreferences(raw));
    try {
      await commitUserPreferences(migrated);
    } catch (error) {
      console.warn('[Reddit Voice Notes] User-preferences migration deferred', error);
      return migrated;
    }
    publishedV2 = true;
    removeLegacyAfterSuccess = true;
  } else {
    const legacy = await browser.storage.local.get(THEME_STORAGE_KEY);
    const legacyId = legacy[THEME_STORAGE_KEY] as string | undefined;
    const base = mergePreferences(undefined);
    const initial: UserPreferencesV1 = {
      ...base,
      appearance: {
        ...base.appearance,
        activeThemeId: legacyId
          ? normalizeThemeId(legacyId)
          : base.appearance.activeThemeId,
      },
    };
    raw = await commitUserPreferences(initial);
    publishedV2 = true;
  }

  let merged = await mergeSubtitlesEnabledIntoPrefs(mergePreferences(raw));
  merged = await migrateWebCodecsBakeRolloutIfNeeded(merged, raw);
  merged = await migrateBrowserCompositeRolloutIfNeeded(merged, raw);
  if (
    !publishedV2 ||
    merged.appearance.activeThemeId !== raw.appearance?.activeThemeId
  ) {
    merged = await commitUserPreferences(merged);
  }
  if (removeLegacyAfterSuccess) await removeMigratedLegacyBlob();
  return merged;
}

export async function loadUserPreferences(): Promise<UserPreferencesV1> {
  return enqueuePrefsOp(() => readUserPreferencesBlob());
}

function importedPreferencesFromJson(json: string): Partial<UserPreferencesV1> {
  const trimmed = json.trim();
  if (!trimmed) throw new Error('Choose a Reddit Voice Notes preferences JSON file.');
  if (new TextEncoder().encode(trimmed).byteLength > MAX_USER_PREFS_IMPORT_BYTES) {
    throw new Error('Preferences file is too large to import.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error('Preferences file is not valid JSON.');
  }

  if (!isRecord(parsed) || parsed.type !== USER_PREFS_TRANSFER_TYPE) {
    throw new Error('This is not a Reddit Voice Notes preferences export.');
  }
  if (typeof parsed.exportedAt !== 'string' || !isRecord(parsed.preferences)) {
    throw new Error('Preferences export is missing required metadata.');
  }

  const preferences = parsed.preferences;
  if (
    preferences.version !== USER_PREFS_VERSION ||
    !isRecord(preferences.appearance) ||
    !isRecord(preferences.audio) ||
    !isRecord(preferences.notifications)
  ) {
    throw new Error('Preferences export uses an unsupported or invalid schema.');
  }

  const appearance = preferences.appearance;
  if (
    ('savedProfiles' in appearance && !Array.isArray(appearance.savedProfiles)) ||
    ('savedCustomStyles' in appearance && !Array.isArray(appearance.savedCustomStyles)) ||
    (Array.isArray(appearance.savedProfiles) &&
      !appearance.savedProfiles.every(isRecord)) ||
    (Array.isArray(appearance.savedCustomStyles) &&
      !appearance.savedCustomStyles.every(isRecord))
  ) {
    throw new Error('Preferences export contains invalid profile or style records.');
  }

  return preferences as unknown as Partial<UserPreferencesV1>;
}

/** Export the complete normalized preference snapshot in a versioned JSON envelope. */
export async function exportUserPreferencesAsJSON(): Promise<string> {
  const preferences = await loadUserPreferences();
  const payload: UserPreferencesExportPayload = {
    type: USER_PREFS_TRANSFER_TYPE,
    exportedAt: new Date().toISOString(),
    preferences,
  };
  return JSON.stringify(payload, null, 2);
}

/** Validate, normalize, and atomically replace the live preference snapshot. */
export async function importUserPreferencesFromJSON(
  json: string,
): Promise<UserPreferencesV1> {
  const imported = mergePreferences(importedPreferencesFromJson(json));
  const normalized: UserPreferencesV1 = {
    ...imported,
    transcriptConfig: transcriptConfigForProfileStorage(imported.transcriptConfig),
    appearance: {
      ...imported.appearance,
      savedProfiles: imported.appearance.savedProfiles?.map((profile) => ({
        ...profile,
        transcriptConfig:
          profile.transcriptConfig == null
            ? null
            : transcriptConfigForProfileStorage(profile.transcriptConfig),
      })),
    },
  };

  return enqueuePrefsOp(async () => {
    const current = await readUserPreferencesBlob();
    const previousSubtitlesEnabled = normalizeTranscriptConfig(
      current.transcriptConfig,
    ).transcriptionEnabled;
    const importedSubtitlesEnabled = normalizeTranscriptConfig(
      normalized.transcriptConfig,
    ).transcriptionEnabled;

    // CHANGED: imported subtitle enablement follows the existing BUG-019 atomic-key pathway.
    // WHY: a later prefs merge must not overwrite the toggle selected by the imported snapshot.
    await setSubtitlesEnabled(importedSubtitlesEnabled);
    try {
      return await commitUserPreferences(normalized);
    } catch (error) {
      try {
        await setSubtitlesEnabled(previousSubtitlesEnabled);
      } catch (rollbackError) {
        console.warn('[Reddit Voice Notes] Could not restore subtitle flag after import failure', rollbackError);
      }
      throw error;
    }
  });
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
      !(USER_PREFS_V2_COORDINATOR_KEY in changes) &&
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
