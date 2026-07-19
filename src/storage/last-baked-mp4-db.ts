import { MAX_RECORDING_SECONDS } from '@/src/utils/constants';

const DB_NAME = 'rvnLastBakedMp4';
const DB_VERSION = 1;
const STORE_NAME = 'exports';
const RECORD_KEY = 'last';
// CHANGED: H13 — persistability bounds exported (were private literals).
// WHY: callers and Node tests need the exact gate the save function enforces;
//      mirrors LAST_RECORDING_MIN/MAX_BYTES (v5.10 precedent). The 30 MB cap
//      is load-bearing for BROWSER_COMPOSITE_VIDEO_BPS (composite-plan.ts).
export const LAST_BAKED_MP4_MIN_BYTES = 256;
// CHANGED: 30 → 40 MiB per QA-6.0.0 Pass A §8-12 operator decision.
// WHY: matches the raised base cap; the composite bitrate pin (BAKED_MP4_MAX_BYTES in
//      composite-plan.ts) stays at 30 MiB so bakes still target the smaller budget and
//      the raise acts as protective headroom, not an invitation to grow.
// Sync: LAST_BASE_MP4_MAX_BYTES (last-base-mp4-db.ts), VISUAL_SIZE_QA_*_MAX_BYTES
//       (scripts/visual-size-qa-core.mjs), qa/QA-6.0.0 checklist caps.
export const LAST_BAKED_MP4_MAX_BYTES = 40 * 1024 * 1024;

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

/**
 * H13 contract (persist-before-stamp): throws on an unpersistable size or any
 * IDB failure, and resolves with the authoritative meta of the record that was
 * actually written. Callers MUST stamp/signal only from that returned meta.
 */
// BUG FIX: H13 false-success artifact publication (hardening backlog v2.6)
// Fix: save silently returned on size rejection (IDB errors already rethrew),
//      so a >30 MB bake published BAKED_MP4_READY + a baked stamp over the
//      previous artifact's bytes. Size gate now throws; persisted meta returned.
// Sync: last-base-mp4-db.ts + last-recording-db.ts (same contract),
//       ui/design-studio/subtitle-bake.ts, audio/voice-reapply.ts (consumers).
export async function saveLastBakedMp4(
  blob: Blob,
  durationSeconds: number,
): Promise<LastBakedMp4Meta> {
  if (blob.size < LAST_BAKED_MP4_MIN_BYTES || blob.size > LAST_BAKED_MP4_MAX_BYTES) {
    throw new Error(
      `Baked MP4 not persistable (${blob.size} bytes; allowed ` +
        `${LAST_BAKED_MP4_MIN_BYTES}..${LAST_BAKED_MP4_MAX_BYTES}).`,
    );
  }

  const record: StoredLastBakedMp4 = {
    blob,
    mimeType: blob.type || 'video/mp4',
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
      tx.onerror = () => reject(tx.error ?? new Error('Last baked MP4 write failed.'));
    });
  } catch (error) {
    console.warn('[Reddit Voice Notes] Could not save baked MP4', error);
    throw error;
  }

  return {
    byteLength: record.byteLength,
    mimeType: record.mimeType,
    savedAt: record.savedAt,
    durationSeconds: record.durationSeconds,
  };
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