import { MAX_RECORDING_SECONDS } from '@/src/utils/constants';

const DB_NAME = 'rvnLastRecording';
const DB_VERSION = 1;
const STORE_NAME = 'recordings';
const RECORD_KEY = 'last';
// CHANGED: v5.10.0 — persistability bounds exported (were private literals).
// WHY: trim-apply byte-checks the trimmed WebM BEFORE stamping it on the take;
//      saveLastRecording silently no-ops outside these bounds (H13), and a
//      stamp must never describe bytes the store may not hold.
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
 * Overwrites prior entry; failures are silent so recording flow is never blocked.
 */
export async function saveLastRecording(
  blob: Blob,
  durationSeconds: number,
): Promise<void> {
  if (blob.size < LAST_RECORDING_MIN_BYTES || blob.size > LAST_RECORDING_MAX_BYTES) return;

  const record: StoredLastRecording = {
    blob,
    mimeType: blob.type || 'video/webm',
    byteLength: blob.size,
    savedAt: Date.now(),
    durationSeconds: Math.min(MAX_RECORDING_SECONDS, Math.max(0, durationSeconds)),
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
  }
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