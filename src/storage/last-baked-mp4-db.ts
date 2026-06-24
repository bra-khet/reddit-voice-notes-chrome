import { MAX_RECORDING_SECONDS } from '@/src/utils/constants';

const DB_NAME = 'rvnLastBakedMp4';
const DB_VERSION = 1;
const STORE_NAME = 'exports';
const RECORD_KEY = 'last';
const MAX_BYTES = 30 * 1024 * 1024;

export interface LastBakedMp4Meta {
  byteLength: number;
  mimeType: string;
  savedAt: number;
  durationSeconds: number;
}

export interface LastBakedMp4Snapshot {
  blob: Blob;
  meta: LastBakedMp4Meta;
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
        reject(request.error ?? new Error('Failed to open last-baked-mp4 database.'));
      };
    });
  }

  return dbPromise;
}

interface StoredLastBakedMp4 {
  blob: Blob;
  mimeType: string;
  byteLength: number;
  savedAt: number;
  durationSeconds: number;
}

export async function saveLastBakedMp4(blob: Blob, durationSeconds: number): Promise<void> {
  if (blob.size < 256 || blob.size > MAX_BYTES) return;

  const record: StoredLastBakedMp4 = {
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
      tx.onerror = () => reject(tx.error ?? new Error('Last baked MP4 write failed.'));
    });
  } catch (error) {
    console.warn('[Reddit Voice Notes] Could not save baked MP4', error);
    throw error;
  }
}

export async function loadLastBakedMp4(): Promise<LastBakedMp4Snapshot | null> {
  try {
    const db = await openDatabase();
    const record = await new Promise<StoredLastBakedMp4 | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(RECORD_KEY);
      request.onsuccess = () => resolve(request.result as StoredLastBakedMp4 | undefined);
      request.onerror = () => reject(request.error ?? new Error('Last baked MP4 read failed.'));
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
  } catch {
    return null;
  }
}