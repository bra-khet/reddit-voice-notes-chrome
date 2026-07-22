/**
 * The artifact commit choke points: persist → signal → stamp, in that order.
 *
 * H13 ("persist-before-stamp") established that a take snapshot must never
 * claim a blob the store does not hold. The rule is enforced by shape: the
 * `saveLast*` writers throw on size rejection or IDB failure, and the stamp is
 * built from the **persisted meta they return**, never from a manufactured
 * `Date.now()`. If the write throws, nothing downstream runs — no ready signal,
 * no artifact stamp.
 *
 * Extracted from entrypoints/background.ts (v6.0 Track D Phase 1) because the
 * hosted Design Studio has no background service worker to relay to and must
 * therefore run the same sequence itself. H13's whole point was that this
 * sequence exists once; a second host with its own copy would be exactly the
 * regression that bug was closed to prevent.
 *
 * Host-neutral: `browser.storage.local` and IndexedDB only, both shimmed on the
 * hosted surface. Callers: the background relay handlers, and the relay
 * fallbacks in last-recording-relay.ts / last-base-mp4-relay.ts.
 */

import { saveLastBaseMp4 } from '@/src/storage/last-base-mp4-db';
import { saveLastRecording } from '@/src/storage/last-recording-db';
import { getTakeManager } from '@/src/session/take-manager';
import { LAST_RECORDING_READY_KEY } from '@/src/settings/user-preferences';

/*
 * The stamp is dispatched, not awaited — deliberately, and identically to the
 * background handlers this was lifted from. Ordering is already guaranteed by
 * the take manager's serialized write queue, and awaiting here would delay the
 * relay's ACK, which is a behavioural change to the extension that Track D is
 * not permitted to make. The only addition is a rejection handler: the promise
 * was previously unhandled, so logging a failure costs nothing and turns a
 * silent lost stamp into something an operator can see.
 */
function stampArtifact(
  kind: 'baseRecording' | 'baseMp4',
  meta: { savedAt: number; byteLength: number; durationSeconds: number },
): void {
  void getTakeManager()
    .recordArtifact(kind, meta)
    .catch((error) => {
      console.warn(`[Reddit Voice Notes] Take artifact stamp failed (${kind})`, error);
    });
}

/**
 * Persist a raw capture, signal the Studio, then stamp `baseRecording`.
 *
 * Throws if the write fails — the caller reports that honestly rather than
 * letting a take advertise bytes that were never stored.
 */
export async function commitLastRecording(blob: Blob, durationSeconds: number): Promise<void> {
  const savedMeta = await saveLastRecording(blob, durationSeconds);

  // Signals the Design Studio to reload its voice preview without needing a tab
  // visibility flip (the recording may finish while the Studio sits open).
  await browser.storage.local.set({ [LAST_RECORDING_READY_KEY]: Date.now() });

  stampArtifact('baseRecording', savedMeta);
}

/**
 * Persist the base MP4 export, then stamp `baseMp4`.
 *
 * No ready-key signal here: `recordArtifact` writes the take snapshot, and the
 * Studio already watches that through `storage.onChanged` (ADR-0002).
 */
export async function commitLastBaseMp4(blob: Blob, durationSeconds: number): Promise<void> {
  const savedMeta = await saveLastBaseMp4(blob, durationSeconds);

  stampArtifact('baseMp4', savedMeta);
}
