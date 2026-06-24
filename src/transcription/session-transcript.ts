import type { TranscriptResult } from './types';

const SESSION_STORAGE_KEY = 'rvn:lastTranscriptJson';

export interface SessionTranscriptRecord {
  result: TranscriptResult;
  jobId?: string;
  capturedAt: number;
}

let inMemory: SessionTranscriptRecord | null = null;

function readSessionStorage(): SessionTranscriptRecord | null {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionTranscriptRecord;
    if (!parsed?.result || typeof parsed.result.text !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSessionStorage(record: SessionTranscriptRecord | null): void {
  try {
    if (!record) {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // sessionStorage may be unavailable in some extension contexts.
  }
}

/** Latest transcript for the active recorder tab session (eloquent-1). */
export function getSessionTranscript(): SessionTranscriptRecord | null {
  return inMemory ?? readSessionStorage();
}

export function setSessionTranscript(result: TranscriptResult, jobId?: string): void {
  const record: SessionTranscriptRecord = {
    result,
    jobId,
    capturedAt: Date.now(),
  };
  inMemory = record;
  writeSessionStorage(record);
}

export function clearSessionTranscript(): void {
  inMemory = null;
  writeSessionStorage(null);
}