import type { ClipProfile } from '@/src/settings/clip-profiles';
import type { CustomClipStyle } from '@/src/settings/custom-styles';
import {
  MSG_USER_PREFS_DB_LOAD,
  MSG_USER_PREFS_DB_REPLACE,
  type UserPrefsDbLoadResponse,
  type UserPrefsDbReplaceResponse,
} from '@/src/messaging/types';
import type {
  AppearancePreferences,
  AudioPreferences,
  ExperimentalPreferences,
  NotificationPreferences,
  UserPreferencesV1,
} from '@/src/settings/user-preferences';
import {
  transcriptConfigForProfileStorage,
  type TranscriptConfig,
} from '@/src/transcription/types';
import type { VoiceEffectConfig } from '@/src/voice/types';
import { isOwnStorageOrigin } from '@/src/utils/host-origin';

// CHANGED: v5.11.0 stores the complete user-preference snapshot as structured IDB rows.
// WHY: rich profile/style records outgrew a single inspectable rvnUserPrefs local-storage blob.
const DB_NAME = 'rvnUserPrefs';
const DB_VERSION = 1;
const GLOBAL_STORE = 'global';
const PROFILES_STORE = 'profiles';
const CUSTOM_STYLES_STORE = 'customStyles';
const GLOBAL_RECORD_ID = 'global';

export const USER_PREFS_DB_SCHEMA_VERSION = 2 as const;

type StoredAppearancePreferences = Omit<
  AppearancePreferences,
  'savedProfiles' | 'savedCustomStyles'
>;

export interface UserPrefsGlobalRecord {
  id: typeof GLOBAL_RECORD_ID;
  schemaVersion: typeof USER_PREFS_DB_SCHEMA_VERSION;
  version: UserPreferencesV1['version'];
  appearance: StoredAppearancePreferences;
  audio: AudioPreferences;
  notifications: NotificationPreferences;
  voiceEffect?: VoiceEffectConfig;
  transcriptConfig?: TranscriptConfig;
  experimental?: ExperimentalPreferences;
}

export interface UserPrefsDbSnapshot {
  global: UserPrefsGlobalRecord;
  profiles: ClipProfile[];
  customStyles: CustomClipStyle[];
}

export interface UserPrefsSerializedSizes {
  globalBytes: number;
  profilesBytes: number;
  customStylesBytes: number;
  totalBytes: number;
  maxRecordBytes: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

// BUG FIX: hosted Design Studio relayed prefs to a background that does not exist
// Fix: the test was `protocol === 'http:'/'https:'`, which meant "content script"
//      only while extension pages and Reddit content scripts were the sole hosts.
//      The Pages-hosted Studio is https AND owns its storage, so it was misrouted
//      into MSG_USER_PREFS_DB_LOAD and failed to boot with "Background could not
//      load user preferences." Ask the durable question instead — does the
//      extension's own base URL share this origin — which is identical for all
//      three extension contexts and correct for the hosted one.
// Sync: src/storage/background-loader.ts (isExtensionPageContext) makes the same
//      origin decision and must keep using the same helper.
function requiresBackgroundRelay(): boolean {
  if (typeof location === 'undefined') return false;
  return !isOwnStorageOrigin();
}

function parseRelayedSnapshot(snapshotJson: string | undefined): UserPrefsDbSnapshot | null {
  if (!snapshotJson) throw new Error('Background returned no user-preferences snapshot.');
  const parsed = JSON.parse(snapshotJson) as UserPrefsDbSnapshot | null;
  if (parsed === null) return null;
  if (
    !parsed.global ||
    parsed.global.schemaVersion !== USER_PREFS_DB_SCHEMA_VERSION ||
    !Array.isArray(parsed.profiles) ||
    !Array.isArray(parsed.customStyles)
  ) {
    throw new Error('Background returned an invalid user-preferences snapshot.');
  }
  return parsed;
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable.'));
  }

  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(GLOBAL_STORE)) {
          db.createObjectStore(GLOBAL_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(PROFILES_STORE)) {
          db.createObjectStore(PROFILES_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(CUSTOM_STYLES_STORE)) {
          db.createObjectStore(CUSTOM_STYLES_STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        dbPromise = null;
        reject(request.error ?? new Error('Failed to open user-preferences database.'));
      };
    });
  }

  return dbPromise;
}

function globalRecordFromPreferences(prefs: UserPreferencesV1): UserPrefsGlobalRecord {
  const {
    savedProfiles: _savedProfiles,
    savedCustomStyles: _savedCustomStyles,
    ...appearance
  } = prefs.appearance;

  return {
    id: GLOBAL_RECORD_ID,
    schemaVersion: USER_PREFS_DB_SCHEMA_VERSION,
    version: prefs.version,
    appearance,
    audio: prefs.audio,
    notifications: prefs.notifications,
    voiceEffect: prefs.voiceEffect,
    transcriptConfig: transcriptConfigForProfileStorage(prefs.transcriptConfig),
    experimental: prefs.experimental,
  };
}

export function dbSnapshotFromUserPreferences(prefs: UserPreferencesV1): UserPrefsDbSnapshot {
  return {
    global: globalRecordFromPreferences(prefs),
    // CHANGED: the v2 split strips any legacy/session transcript result before persistence.
    // WHY: profile/global prefs own subtitle settings only; transcript cue text remains in its IDB.
    profiles: (prefs.appearance.savedProfiles ?? []).map((profile) => ({
      ...profile,
      transcriptConfig:
        profile.transcriptConfig == null
          ? null
          : transcriptConfigForProfileStorage(profile.transcriptConfig),
    })),
    customStyles: prefs.appearance.savedCustomStyles ?? [],
  };
}

function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/** Pure size telemetry helper shared by saves and focused tests. */
export function measureUserPrefsSnapshot(snapshot: UserPrefsDbSnapshot): UserPrefsSerializedSizes {
  const globalBytes = jsonByteLength(snapshot.global);
  const profileRecordBytes = snapshot.profiles.map(jsonByteLength);
  const customStyleRecordBytes = snapshot.customStyles.map(jsonByteLength);
  const profilesBytes = profileRecordBytes.reduce((total, size) => total + size, 0);
  const customStylesBytes = customStyleRecordBytes.reduce((total, size) => total + size, 0);
  return {
    globalBytes,
    profilesBytes,
    customStylesBytes,
    totalBytes: globalBytes + profilesBytes + customStylesBytes,
    maxRecordBytes: Math.max(0, globalBytes, ...profileRecordBytes, ...customStyleRecordBytes),
  };
}

export async function loadUserPrefsDbSnapshotDirect(): Promise<UserPrefsDbSnapshot | null> {
  try {
    const db = await openDatabase();
    return await new Promise<UserPrefsDbSnapshot | null>((resolve, reject) => {
      const tx = db.transaction(
        [GLOBAL_STORE, PROFILES_STORE, CUSTOM_STYLES_STORE],
        'readonly',
      );
      const globalRequest = tx.objectStore(GLOBAL_STORE).get(GLOBAL_RECORD_ID);
      const profilesRequest = tx.objectStore(PROFILES_STORE).getAll();
      const customStylesRequest = tx.objectStore(CUSTOM_STYLES_STORE).getAll();

      tx.oncomplete = () => {
        const global = globalRequest.result as UserPrefsGlobalRecord | undefined;
        if (!global) {
          resolve(null);
          return;
        }
        if (global.schemaVersion !== USER_PREFS_DB_SCHEMA_VERSION) {
          reject(new Error(`Unsupported user-preferences schema ${global.schemaVersion}.`));
          return;
        }
        resolve({
          global,
          profiles: profilesRequest.result as ClipProfile[],
          customStyles: customStylesRequest.result as CustomClipStyle[],
        });
      };
      tx.onerror = () => reject(tx.error ?? new Error('User-preferences read failed.'));
      tx.onabort = () => reject(tx.error ?? new Error('User-preferences read aborted.'));
    });
  } catch (error) {
    console.warn('[Reddit Voice Notes] Could not load user preferences from IndexedDB', error);
    throw error;
  }
}

/** Load the complete snapshot directly or through background from a content script. */
export async function loadUserPrefsDbSnapshot(): Promise<UserPrefsDbSnapshot | null> {
  if (!requiresBackgroundRelay()) return loadUserPrefsDbSnapshotDirect();

  // CHANGED: Reddit content scripts use the background as the extension-IDB owner.
  // WHY: IndexedDB follows the host-page origin there; direct access would create a separate DB.
  const response = (await browser.runtime.sendMessage({
    type: MSG_USER_PREFS_DB_LOAD,
  })) as UserPrefsDbLoadResponse | undefined;
  if (!response?.ok) {
    throw new Error(response?.error ?? 'Background could not load user preferences.');
  }
  return parseRelayedSnapshot(response.snapshotJson);
}

/**
 * Atomically replace global prefs and every profile/style row.
 * The caller publishes the chrome.storage coordinator only after this resolves.
 */
export async function replaceUserPrefsDbSnapshotDirect(
  snapshot: UserPrefsDbSnapshot,
): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(
        [GLOBAL_STORE, PROFILES_STORE, CUSTOM_STYLES_STORE],
        'readwrite',
      );
      const globalStore = tx.objectStore(GLOBAL_STORE);
      const profilesStore = tx.objectStore(PROFILES_STORE);
      const customStylesStore = tx.objectStore(CUSTOM_STYLES_STORE);

      try {
        globalStore.clear();
        profilesStore.clear();
        customStylesStore.clear();
        globalStore.put(snapshot.global);
        for (const profile of snapshot.profiles) profilesStore.put(profile);
        for (const style of snapshot.customStyles) customStylesStore.put(style);
      } catch (error) {
        tx.abort();
        reject(error);
        return;
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('User-preferences write failed.'));
      tx.onabort = () => reject(tx.error ?? new Error('User-preferences write aborted.'));
    });
  } catch (error) {
    console.warn('[Reddit Voice Notes] Could not save user preferences to IndexedDB', error);
    throw error;
  }
}

/** Replace the snapshot directly or through background from a content script. */
export async function replaceUserPrefsDbSnapshot(
  snapshot: UserPrefsDbSnapshot,
): Promise<void> {
  if (!requiresBackgroundRelay()) {
    return replaceUserPrefsDbSnapshotDirect(snapshot);
  }

  const response = (await browser.runtime.sendMessage({
    type: MSG_USER_PREFS_DB_REPLACE,
    snapshotJson: JSON.stringify(snapshot),
  })) as UserPrefsDbReplaceResponse | undefined;
  if (!response?.ok) {
    throw new Error(response?.error ?? 'Background could not save user preferences.');
  }
}

/** Development/QA recovery hook; normal migration never clears a committed v2 snapshot. */
export async function clearUserPrefsDb(): Promise<void> {
  if (requiresBackgroundRelay()) {
    throw new Error('Open an extension page to clear the user-preferences database.');
  }
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(
        [GLOBAL_STORE, PROFILES_STORE, CUSTOM_STYLES_STORE],
        'readwrite',
      );
      tx.objectStore(GLOBAL_STORE).clear();
      tx.objectStore(PROFILES_STORE).clear();
      tx.objectStore(CUSTOM_STYLES_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('User-preferences clear failed.'));
      tx.onabort = () => reject(tx.error ?? new Error('User-preferences clear aborted.'));
    });
  } catch (error) {
    console.warn('[Reddit Voice Notes] Could not clear user preferences IndexedDB', error);
    throw error;
  }
}
