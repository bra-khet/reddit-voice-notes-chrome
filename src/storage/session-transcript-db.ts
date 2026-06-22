import {
  cloneTranscriptResult,
  isTranscriptDirty,
} from '@/src/transcription/transcript-editing';
import type { TranscriptResult } from '@/src/transcription/types';

const DB_NAME = 'rvnSessionTranscript';
const DB_VERSION = 1;
const STORE_NAME = 'transcripts';
const RECORD_KEY = 'last';

export interface SessionTranscriptSnapshot {
  /** Immutable Vosk baseline for dirty detection. */
  originalResult: TranscriptResult;
  /** User working copy — may diverge after segment edits. */
  editedResult: TranscriptResult;
  jobId?: string;
  capturedAt: number;
  lastEditedAt?: number;
  /** Set when user explicitly saves transcript edits in Design Studio. */
  confirmedAt?: number;
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

interface StoredSessionTranscriptV2 {
  originalResult: TranscriptResult;
  editedResult: TranscriptResult;
  jobId?: string;
  capturedAt: number;
  lastEditedAt?: number;
  confirmedAt?: number;
}

/** Legacy eloquent-2 shape — migrated on read. */
interface StoredSessionTranscriptLegacy {
  result: TranscriptResult;
  jobId?: string;
  capturedAt: number;
}

type StoredSessionTranscript = StoredSessionTranscriptV2 | StoredSessionTranscriptLegacy;

function isLegacyRecord(record: StoredSessionTranscript): record is StoredSessionTranscriptLegacy {
  return 'result' in record && !('editedResult' in record);
}

function normalizeStoredRecord(record: StoredSessionTranscript): SessionTranscriptSnapshot | null {
  if (!record || typeof record.capturedAt !== 'number') return null;

  if (isLegacyRecord(record)) {
    if (!record.result || typeof record.result.text !== 'string') return null;
    const baseline = cloneTranscriptResult(record.result);
    return {
      originalResult: baseline,
      editedResult: cloneTranscriptResult(record.result),
      jobId: record.jobId,
      capturedAt: record.capturedAt,
    };
  }

  if (
    !record.originalResult ||
    !record.editedResult ||
    typeof record.originalResult.text !== 'string' ||
    typeof record.editedResult.text !== 'string'
  ) {
    return null;
  }

  return {
    originalResult: cloneTranscriptResult(record.originalResult),
    editedResult: cloneTranscriptResult(record.editedResult),
    jobId: record.jobId,
    capturedAt: record.capturedAt,
    lastEditedAt: record.lastEditedAt,
    confirmedAt: record.confirmedAt,
  };
}

export function sessionTranscriptIsDirty(snapshot: SessionTranscriptSnapshot | null): boolean {
  if (!snapshot) return false;
  return isTranscriptDirty(snapshot.originalResult, snapshot.editedResult);
}

export function sessionTranscriptIsConfirmed(snapshot: SessionTranscriptSnapshot | null): boolean {
  if (!snapshot) return false;
  return typeof snapshot.confirmedAt === 'number' && snapshot.confirmedAt > 0;
}

/**
 * Persist the latest STT result for Design Studio (eloquent-2+).
 * Extension-origin IDB — written by background relay from Reddit content script.
 */
export async function saveSessionTranscript(
  result: TranscriptResult,
  jobId?: string,
): Promise<void> {
  const baseline = cloneTranscriptResult(result);
  const record: StoredSessionTranscriptV2 = {
    originalResult: baseline,
    editedResult: cloneTranscriptResult(result),
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

/** Persist user-edited segments from Design Studio (eloquent-4). */
export async function saveSessionTranscriptEdits(
  editedResult: TranscriptResult,
  options?: { confirmed?: boolean },
): Promise<void> {
  const existing = await loadSessionTranscript();
  if (!existing) {
    const manual = cloneTranscriptResult(editedResult);
    manual.source = 'manual';
    const record: StoredSessionTranscriptV2 = {
      originalResult: manual,
      editedResult: cloneTranscriptResult(editedResult),
      capturedAt: Date.now(),
      lastEditedAt: Date.now(),
      confirmedAt: options?.confirmed ? Date.now() : undefined,
    };
    await writeRecord(record);
    return;
  }

  const record: StoredSessionTranscriptV2 = {
    originalResult: existing.originalResult,
    editedResult: cloneTranscriptResult(editedResult),
    jobId: existing.jobId,
    capturedAt: existing.capturedAt,
    lastEditedAt: Date.now(),
    confirmedAt: options?.confirmed ? Date.now() : existing.confirmedAt,
  };
  await writeRecord(record);
}

async function writeRecord(record: StoredSessionTranscriptV2): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(record, RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Session transcript write failed.'));
    });
  } catch (error) {
    console.warn('[Reddit Voice Notes] Session transcript edit save failed', error);
    throw error;
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

    return normalizeStoredRecord(record as StoredSessionTranscript);
  } catch {
    return null;
  }
}

/** Discard working edits — restore edited copy to Vosk baseline. */
export async function revertSessionTranscriptEdits(): Promise<void> {
  const existing = await loadSessionTranscript();
  if (!existing) return;

  const record: StoredSessionTranscriptV2 = {
    originalResult: existing.originalResult,
    editedResult: cloneTranscriptResult(existing.originalResult),
    jobId: existing.jobId,
    capturedAt: existing.capturedAt,
    lastEditedAt: undefined,
    confirmedAt: undefined,
  };
  await writeRecord(record);
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