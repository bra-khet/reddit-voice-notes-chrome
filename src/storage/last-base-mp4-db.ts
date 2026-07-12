import { MAX_RECORDING_SECONDS } from '@/src/utils/constants';

const DB_NAME = 'rvnLastBaseMp4';
const DB_VERSION = 1;
const STORE_NAME = 'exports';
const RECORD_KEY = 'last';
// CHANGED: H13 — persistability bounds exported (were private literals).
// WHY: callers and Node tests need the exact gate the save function enforces;
//      mirrors LAST_RECORDING_MIN/MAX_BYTES (v5.10 precedent).
export const LAST_BASE_MP4_MIN_BYTES = 256;
/** Typical 2:00 base MP4 after transcode — reject oversized blobs before IDB write. */
export const LAST_BASE_MP4_MAX_BYTES = 25 * 1024 * 1024;

export interface LastBaseMp4Meta {
  byteLength: number;
  mimeType: string;
  savedAt: number;
  durationSeconds: number;
}

export interface LastBaseMp4Snapshot {
  blob: Blob;
  meta: LastBaseMp4Meta;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable.'));
  }

  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbPromise = null;
        reject(request.error ?? new Error('Failed to open last-base-mp4 database.'));
      };
    });
  }

  return dbPromise;
}

interface StoredLastBaseMp4 {
  blob: Blob;
  mimeType: string;
  byteLength: number;
  savedAt: number;
  durationSeconds: number;
}

/**
 * Persist the latest base MP4 (pre burn-in) for Design Studio subtitle baking (eloquent-4).
 *
 * H13 contract (persist-before-stamp): throws on an unpersistable size or any
 * IDB failure, and resolves with the authoritative meta of the record that was
 * actually written. Callers MUST stamp/signal only from that returned meta —
 * a resolved promise is the proof of persistence, never an assumption.
 */
// BUG FIX: H13 false-success artifact publication (hardening backlog v2.6)
// Fix: save silently returned on size rejection and swallowed IDB errors, so
//      callers stamped/signaled artifacts the store never wrote. Now the size
//      gate throws, IDB failures propagate, and the persisted meta is returned.
// Sync: last-baked-mp4-db.ts + last-recording-db.ts (same contract),
//       entrypoints/background.ts, ui/design-studio/subtitle-bake.ts,
//       audio/voice-reapply.ts, editing/trim-apply.ts (consume returned meta).
export async function saveLastBaseMp4(
  blob: Blob,
  durationSeconds: number,
): Promise<LastBaseMp4Meta> {
  if (blob.size < LAST_BASE_MP4_MIN_BYTES || blob.size > LAST_BASE_MP4_MAX_BYTES) {
    throw new Error(
      `Base MP4 not persistable (${blob.size} bytes; allowed ` +
        `${LAST_BASE_MP4_MIN_BYTES}..${LAST_BASE_MP4_MAX_BYTES}).`,
    );
  }

  const record: StoredLastBaseMp4 = {
    blob,
    mimeType: blob.type || 'video/mp4',
    byteLength: blob.size,
    savedAt: Date.now(),
    // Non-finite input (legacy callers without a known duration) persists as 0
    // rather than NaN — the meta must stay JSON-safe for stamps.
    durationSeconds: Number.isFinite(durationSeconds)
      ? Math.min(MAX_RECORDING_SECONDS, Math.max(0, durationSeconds))
      : 0,
  };

  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(record, RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Last base MP4 write failed.'));
    });
  } catch (error) {
    console.warn('[Reddit Voice Notes] Could not save last base MP4 for subtitle bake', error);
    throw error;
  }

  return {
    byteLength: record.byteLength,
    mimeType: record.mimeType,
    savedAt: record.savedAt,
    durationSeconds: record.durationSeconds,
  };
}

export async function loadLastBaseMp4(): Promise<LastBaseMp4Snapshot | null> {
  try {
    const db = await openDatabase();
    const record = await new Promise<StoredLastBaseMp4 | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(RECORD_KEY);
      request.onsuccess = () => resolve(request.result as StoredLastBaseMp4 | undefined);
      request.onerror = () => reject(request.error ?? new Error('Last base MP4 read failed.'));
    });

    if (!record?.blob || record.byteLength <= 0) return null;

    return {
      blob: record.blob,
      meta: {
        byteLength: record.byteLength,
        mimeType: record.mimeType,
        savedAt: record.savedAt,
        durationSeconds: record.durationSeconds,
      },
    };
  } catch (error) {
    console.warn('[Reddit Voice Notes] Could not load last base MP4', error);
    return null;
  }
}

export async function clearLastBaseMp4(): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Last base MP4 delete failed.'));
    });
  } catch {
    // Best-effort cleanup.
  }
}