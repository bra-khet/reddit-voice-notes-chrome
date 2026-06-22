import { MAX_RECORDING_SECONDS } from '@/src/utils/constants';

const DB_NAME = 'rvnLastBaseMp4';
const DB_VERSION = 1;
const STORE_NAME = 'exports';
const RECORD_KEY = 'last';
/** Typical 2:00 base MP4 after transcode — reject oversized blobs before IDB write. */
const MAX_BYTES = 25 * 1024 * 1024;

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
 */
export async function saveLastBaseMp4(blob: Blob, durationSeconds: number): Promise<void> {
  if (blob.size < 256 || blob.size > MAX_BYTES) return;

  const record: StoredLastBaseMp4 = {
    blob,
    mimeType: blob.type || 'video/mp4',
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
      tx.onerror = () => reject(tx.error ?? new Error('Last base MP4 write failed.'));
    });
  } catch (error) {
    console.warn('[Reddit Voice Notes] Could not save last base MP4 for subtitle bake', error);
  }
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