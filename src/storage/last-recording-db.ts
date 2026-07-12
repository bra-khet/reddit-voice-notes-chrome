import { MAX_RECORDING_SECONDS } from '@/src/utils/constants';

const DB_NAME = 'rvnLastRecording';
const DB_VERSION = 1;
const STORE_NAME = 'recordings';
const RECORD_KEY = 'last';
// CHANGED: v5.10.0 — persistability bounds exported (were private literals).
// WHY: trim-apply byte-checks the trimmed WebM BEFORE stamping it on the take;
//      a stamp must never describe bytes the store may not hold. Since H13
//      (2026-07-12) saveLastRecording also THROWS outside these bounds — the
//      caller pre-check is an early demote, the store gate is the enforcement.
export const LAST_RECORDING_MIN_BYTES = 256;
/** Slightly above typical 2:00 WebM cap — reject oversized blobs before IDB write. */
export const LAST_RECORDING_MAX_BYTES = 18 * 1024 * 1024;

export interface LastRecordingMeta {
  byteLength: number;
  mimeType: string;
  savedAt: number;
  durationSeconds: number;
}

export interface LastRecordingSnapshot {
  blob: Blob;
  meta: LastRecordingMeta;
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
        reject(request.error ?? new Error('Failed to open last-recording database.'));
      };
    });
  }

  return dbPromise;
}

interface StoredLastRecording {
  blob: Blob;
  mimeType: string;
  byteLength: number;
  savedAt: number;
  durationSeconds: number;
}

/**
 * Persist the most recent successful take for Design Studio voice preview (dulcet-2).
 * Overwrites the prior entry.
 *
 * H13 contract (persist-before-stamp): throws on an unpersistable size or any
 * IDB failure, and resolves with the authoritative meta of the record that was
 * actually written. Callers MUST stamp/signal only from that returned meta;
 * callers on flows that must never block (capture stop) own their own
 * catch-and-continue — the store no longer hides failure for them.
 */
// BUG FIX: H13 false-success artifact publication (hardening backlog v2.6)
// Fix: save silently returned on size rejection and swallowed IDB errors, so
//      the background stamped baseRecording + fired LAST_RECORDING_READY over
//      bytes the store never wrote. Size gate now throws; IDB failures
//      propagate; the persisted meta is returned. Supersedes the v5.10
//      caller-side bounds pre-check as the enforcement point (trim-apply keeps
//      its pre-check as an early demote, no longer as the only defense).
// Sync: last-base-mp4-db.ts + last-baked-mp4-db.ts (same contract),
//       entrypoints/background.ts, editing/trim-apply.ts (consume returned meta).
export async function saveLastRecording(
  blob: Blob,
  durationSeconds: number,
): Promise<LastRecordingMeta> {
  if (blob.size < LAST_RECORDING_MIN_BYTES || blob.size > LAST_RECORDING_MAX_BYTES) {
    throw new Error(
      `Recording not persistable (${blob.size} bytes; allowed ` +
        `${LAST_RECORDING_MIN_BYTES}..${LAST_RECORDING_MAX_BYTES}).`,
    );
  }

  const record: StoredLastRecording = {
    blob,
    mimeType: blob.type || 'video/webm',
    byteLength: blob.size,
    savedAt: Date.now(),
    // Non-finite input persists as 0 rather than NaN — meta must stay JSON-safe.
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
      tx.onerror = () => reject(tx.error ?? new Error('Last recording write failed.'));
    });
  } catch (error) {
    console.warn('[Reddit Voice Notes] Could not save last recording for voice preview', error);
    throw error;
  }

  return {
    byteLength: record.byteLength,
    mimeType: record.mimeType,
    savedAt: record.savedAt,
    durationSeconds: record.durationSeconds,
  };
}

export async function loadLastRecording(): Promise<LastRecordingSnapshot | null> {
  try {
    const db = await openDatabase();
    const record = await new Promise<StoredLastRecording | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(RECORD_KEY);
      request.onsuccess = () => resolve(request.result as StoredLastRecording | undefined);
      request.onerror = () => reject(request.error ?? new Error('Last recording read failed.'));
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
    console.warn('[Reddit Voice Notes] Could not load last recording', error);
    return null;
  }
}

export async function clearLastRecording(): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Last recording delete failed.'));
    });
  } catch {
    // Best-effort cleanup.
  }
}