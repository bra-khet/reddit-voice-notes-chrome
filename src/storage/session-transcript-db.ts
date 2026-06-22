import type { TranscriptResult } from '@/src/transcription/types';

const DB_NAME = 'rvnSessionTranscript';
const DB_VERSION = 1;
const STORE_NAME = 'transcripts';
const RECORD_KEY = 'last';

export interface SessionTranscriptSnapshot {
  result: TranscriptResult;
  jobId?: string;
  capturedAt: number;
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
        reject(request.error ?? new Error('Failed to open session-transcript database.'));
      };
    });
  }

  return dbPromise;
}

interface StoredSessionTranscript {
  result: TranscriptResult;
  jobId?: string;
  capturedAt: number;
}

/**
 * Persist the latest STT result for Design Studio (eloquent-2).
 * Extension-origin IDB — written by background relay from Reddit content script.
 */
export async function saveSessionTranscript(
  result: TranscriptResult,
  jobId?: string,
): Promise<void> {
  const record: StoredSessionTranscript = {
    result,
    jobId,
    capturedAt: Date.now(),
  };

  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(record, RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Session transcript write failed.'));
    });
  } catch (error) {
    console.warn('[Reddit Voice Notes] Session transcript save failed', error);
  }
}

export async function loadSessionTranscript(): Promise<SessionTranscriptSnapshot | null> {
  try {
    const db = await openDatabase();
    const record = await new Promise<StoredSessionTranscript | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(RECORD_KEY);
      request.onsuccess = () => resolve(request.result as StoredSessionTranscript | undefined);
      request.onerror = () => reject(request.error ?? new Error('Session transcript read failed.'));
    });

    if (!record?.result || typeof record.result.text !== 'string') return null;
    return {
      result: record.result,
      jobId: record.jobId,
      capturedAt: record.capturedAt,
    };
  } catch {
    return null;
  }
}

export async function clearSessionTranscriptStore(): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Session transcript clear failed.'));
    });
  } catch {
    // Non-blocking.
  }
}