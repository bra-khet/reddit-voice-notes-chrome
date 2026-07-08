/**
 * v5.6.0 — Clean-audio accessor (docs/v5.6.0-audio-decoupling.md §3.2).
 *
 * NOT a new store: the raw mic audio already persists as the capture WebM in
 * rvnLastRecording, stamped on the take as `baseRecording` (voice effects are
 * applied at transcode, never at capture — verified ground truth). This module
 * is the single sanctioned door to that blob for audio editing: it enforces
 * the H6 stamp↔store verification before any byte is adopted, and demotes
 * dead stamps honestly on mismatch.
 *
 * Runs on the extension origin (Design Studio) — content scripts must keep
 * using the chunked relay and are not consumers of this module.
 *
 * Sync: take-manager.ts (takeArtifactMatchesStore / clearArtifact — H6),
 *       last-recording-db.ts (the single-slot store),
 *       voice-reapply-plan.ts (CleanAudioUnavailableReason vocabulary)
 */

import {
  getTakeManager,
  takeArtifactMatchesStore,
  type CurrentTake,
} from '@/src/session/take-manager';
import {
  loadLastRecording,
  type LastRecordingMeta,
} from '@/src/storage/last-recording-db';
import { EXTENSION_LOG_PREFIX } from '@/src/utils/constants';
import type { CleanAudioUnavailableReason } from './voice-reapply-plan';

export type CleanAudioResult =
  | { ok: true; blob: Blob; meta: LastRecordingMeta }
  | { ok: false; reason: CleanAudioUnavailableReason };

/**
 * Load the take's raw-audio WebM, H6-verified. On stamp mismatch the dead
 * `baseRecording` stamp is dropped with an honest note (the store is
 * single-slot — a newer capture owns those bytes now).
 */
export async function loadCleanAudioForTake(
  take: CurrentTake | null,
): Promise<CleanAudioResult> {
  if (!take) return { ok: false, reason: 'no-take' };

  const stamp = take.artifacts.baseRecording;
  if (!stamp) return { ok: false, reason: 'no-stamp' };

  const snapshot = await loadLastRecording();
  if (!snapshot) return { ok: false, reason: 'store-empty' };

  if (!takeArtifactMatchesStore(stamp, snapshot.meta)) {
    console.warn(
      `${EXTENSION_LOG_PREFIX} Clean audio: baseRecording stamp does not match the store — dropping stamp (H6).`,
    );
    await getTakeManager().clearArtifact('baseRecording', {
      note: 'Recording superseded — re-record to change the voice.',
    });
    return { ok: false, reason: 'stamp-mismatch' };
  }

  return { ok: true, blob: snapshot.blob, meta: snapshot.meta };
}
