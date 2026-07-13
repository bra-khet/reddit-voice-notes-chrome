/**
 * v5.4.0 — Studio tab return recovery after mid-processing close.
 *
 * When the Design Studio tab is closed during post-stop transcode, the
 * snapshot may stay 'processing' (async saveDraft on pagehide) while the
 * audition UI can orphan `active` without a host. On reopen we reconcile
 * against the background transcode queue, demote/promote the take, and
 * resume MP4 conversion from the preserved WebM when needed.
 */

import { transcodeWebmToMp4 } from '@/src/ffmpeg';
import {
  MSG_QUERY_TRANSCODE_INFLIGHT,
  type QueryTranscodeInflightResponse,
} from '@/src/messaging/types';
import { loadUserPreferences } from '@/src/settings/user-preferences';
import {
  createTakeVoiceStamp,
  getTakeManager,
  takeArtifactMatchesStore,
} from '@/src/session/take-manager';
import { relaySaveLastBaseMp4 } from '@/src/storage/last-base-mp4-relay';
import { loadLastRecording } from '@/src/storage/last-recording-db';
import { EXTENSION_LOG_PREFIX } from '@/src/utils/constants';
import { voiceEffectUserIntentKey } from '@/src/voice/resolve-config';
import { normalizeVoiceEffectConfig, type VoiceEffectConfig } from '@/src/voice/types';

const MIN_RESUME_WEBM_BYTES = 256;

async function isTranscodeInflight(): Promise<boolean> {
  try {
    const response = (await browser.runtime.sendMessage({
      type: MSG_QUERY_TRANSCODE_INFLIGHT,
    })) as QueryTranscodeInflightResponse | undefined;
    return response?.ok === true && response.inflight === true;
  } catch {
    // Non-blocking — assume idle so the deck is not stuck on phantom processing.
    return false;
  }
}

let recoveryChain: Promise<void> = Promise.resolve();

function enqueueRecovery(operation: () => Promise<void>): Promise<void> {
  const next = recoveryChain.then(operation, operation);
  recoveryChain = next.catch(() => undefined);
  return next;
}

async function resumeDraftTranscodeInner(): Promise<void> {
  if (await isTranscodeInflight()) return;

  const take = await getTakeManager().getCurrentTake();
  if (!take || take.status !== 'draft') return;
  if (!take.artifacts.baseRecording || take.artifacts.baseMp4) return;

  const recording = await loadLastRecording();
  if (!recording?.blob || recording.blob.size < MIN_RESUME_WEBM_BYTES) return;

  // BUG FIX: H6 stale-artifact adoption
  // Fix: verify the draft's stamp against the single-slot store meta before
  //      re-transcoding — after a crash, a newer capture may have overwritten
  //      rvnLastRecording, and resuming would author the WRONG take's MP4.
  // Sync: takeArtifactMatchesStore in take-manager.ts; recorder-panel.ts
  //       attach mode; current-take-status.ts Download CTA.
  if (!takeArtifactMatchesStore(take.artifacts.baseRecording, recording.meta)) {
    await getTakeManager().clearArtifact('baseRecording', {
      note: 'Recording superseded — re-record.',
    });
    return;
  }

  // BUG FIX: recovery resume saved base MP4 with duration 0
  // Fix: duration lives at recording.meta.durationSeconds — the top-level
  //      access never existed on LastRecordingSnapshot (TS2339), so the
  //      fallback always resolved undefined → 0.
  const durationSeconds = take.meta.durationSeconds ?? recording.meta.durationSeconds ?? undefined;

  await getTakeManager().updateCurrentTake({
    status: 'processing',
    meta: { note: undefined },
  });

  try {
    // BUG FIX: H8 recovery voice provenance
    // Fix: resume from the take's capture-time config; only legacy drafts that
    //      lack the additive field consult current prefs, and that fallback is
    //      surfaced honestly in the ready deck note.
    // Sync: voice-recorder.ts capture writer; take-manager.ts intent parser.
    const captureIntent = take.captureVoiceIntent;
    const legacyVoiceFallback = !captureIntent;
    const voiceConfig = captureIntent
      ? normalizeVoiceEffectConfig(captureIntent.config as unknown as VoiceEffectConfig)
      : normalizeVoiceEffectConfig((await loadUserPreferences()).voiceEffect);
    const intentKey = captureIntent?.intentKey ?? voiceEffectUserIntentKey(voiceConfig);
    const result = await transcodeWebmToMp4(
      recording.blob,
      undefined,
      undefined,
      voiceConfig,
    );
    await relaySaveLastBaseMp4(result.mp4, durationSeconds ?? recording.meta.durationSeconds ?? 0);
    // BUG FIX: H8 recovery voice provenance
    // Fix: promote the recovered render's actual voice/fallback provenance in
    //      the same ready patch, matching the normal capture completion path.
    // Sync: voice-recorder.ts createTakeVoiceStamp capture path.
    const voiceStamp = createTakeVoiceStamp({
      intentKey,
      config: voiceConfig as unknown as Record<string, unknown>,
      origin: 'capture',
      fallback: result.voiceEffectFallback === true,
    });
    await getTakeManager().updateCurrentTake({
      status: 'ready',
      voice: voiceStamp,
      meta: {
        note: legacyVoiceFallback
          ? 'Recovered with current voice settings because this legacy draft did not save capture-time voice intent.'
          : undefined,
      },
    });
  } catch (error) {
    console.warn(`${EXTENSION_LOG_PREFIX} Draft transcode resume failed`, error);
    await getTakeManager().saveDraft({
      meta: {
        note: 'MP4 conversion paused — captured WebM is still available in Voice preview.',
      },
    });
  }
}

/**
 * Draft with a relayed WebM but no base MP4 — kick off transcode again.
 * Safe to call from Studio mount or Reddit panel open (serialized).
 */
export async function resumeDraftTranscodeIfNeeded(): Promise<void> {
  return enqueueRecovery(() => resumeDraftTranscodeInner());
}

/** Call when the Studio shell mounts (and before opening a new audition). */
export async function reconcileStudioTakeAfterTabReturn(): Promise<void> {
  return enqueueRecovery(async () => {
    const inflight = await isTranscodeInflight();
    await getTakeManager().reconcileInterruptedProcessing({ transcodeInflight: inflight });
    if (!inflight) {
      await resumeDraftTranscodeInner();
    }
  });
}
