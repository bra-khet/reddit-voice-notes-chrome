/**
 * v5.6.0 — Voice re-apply orchestrator (docs/v5.6.0-audio-decoupling.md §3.5).
 *
 * "Change Voice" without re-recording: render the take's RAW capture audio
 * through the Dulcet II graph and stream-copy the result under the existing
 * video track(s). Visuals — including a baked MP4's burned-in subtitles — are
 * preserved bit-exact (invariant I6), so a voice change NEVER forces a visual
 * re-composite (decision §9.4).
 *
 * Runs entirely on the Design Studio page: ffmpeg.wasm already runs here
 * (voice audition), mediabunny already runs here (ADR-0003), IDB is
 * same-origin, and every other context learns the outcome through the take
 * snapshot — no new message family (invariant I8).
 *
 * FAILURE POLICY (invariant I7): store writes and stamps happen LAST, after
 * both remuxes validate. Any earlier failure — including a DSP fallback, which
 * would otherwise silently ship raw audio under a claimed voice — throws a
 * VoiceReapplyError and leaves every store and stamp untouched.
 *
 * Preview=bake (invariant I9): this pipeline resolves through the SAME
 * resolveVoiceGraph + processAudioWithGraph as the Studio audition, so the
 * "Test" button is a faithful preview of a re-apply.
 *
 * Sync: voice-reapply-plan.ts (stages/progress/validation),
 *       clean-audio-source.ts (H6 raw-audio door), audio-remux.ts (remux),
 *       take-manager.ts (stamps), voice-controls.ts (Studio action surface)
 */

import {
  createTakeVoiceStamp,
  getTakeManager,
  takeArtifactMatchesStore,
  type TakeArtifactStamp,
} from '@/src/session/take-manager';
import {
  loadLastBaseMp4,
  saveLastBaseMp4,
} from '@/src/storage/last-base-mp4-db';
import {
  loadLastBakedMp4,
  saveLastBakedMp4,
} from '@/src/storage/last-baked-mp4-db';
import { BAKED_MP4_READY_KEY } from '@/src/settings/user-preferences';
import { voiceEffectUserIntentKey } from '@/src/voice/resolve-config';
import { resolveVoiceGraph } from '@/src/voice/dsp';
import { normalizeVoiceEffectConfig, type VoiceEffectConfig } from '@/src/voice/types';
import { processAudioWithGraph } from '@/src/voice/process-audio';
import { snapshotBakeChronos } from '@/src/ui/design-studio/bake-chronos';
import { EXTENSION_LOG_PREFIX } from '@/src/utils/constants';
import { loadCleanAudioForTake } from './clean-audio-source';
import { replaceAudioTrack } from './audio-remux';
import {
  cleanAudioUnavailableMessage,
  computeVoiceReapplyProgress,
  VOICE_REAPPLY_STAGES,
  type VoiceReapplyStage,
  type VoiceReapplyTiming,
} from './voice-reapply-plan';

export type VoiceReapplyErrorCode =
  | 'clean-audio' // raw WebM unavailable (legacy take, superseded slot, …)
  | 'base-unavailable' // baseMp4 missing or H6-mismatched
  | 'dsp-failed' // Dulcet II render fell back — never ship raw audio silently
  | 'superseded'; // another take took over mid-pipeline

export class VoiceReapplyError extends Error {
  readonly code: VoiceReapplyErrorCode;

  constructor(code: VoiceReapplyErrorCode, message: string) {
    super(message);
    this.name = 'VoiceReapplyError';
    this.code = code;
  }
}

export interface VoiceReapplyProgress {
  ratio: number;
  stage: VoiceReapplyStage;
  message: string;
  elapsedMs: number;
  estimatedRemainingMs: number | null;
}

export interface VoiceReapplyOptions {
  /** The voice to apply (the Studio panel's current config, typically). */
  config: VoiceEffectConfig;
  signal?: AbortSignal;
  onProgress?: (progress: VoiceReapplyProgress) => void;
}

export interface VoiceReapplyOutcome {
  intentKey: string;
  /** Provenance revision now recorded on the take. */
  revision: number;
  /** True when the baked artifact's audio was updated too. */
  bakedUpdated: boolean;
  timing: VoiceReapplyTiming;
}

/** Honest per-stage copy for the Studio meter (mirrors canvasStageMessage). */
export function voiceReapplyStageMessage(stage: VoiceReapplyStage, ratio: number): string {
  const pct = Math.round(ratio * 100);
  switch (stage) {
    case VOICE_REAPPLY_STAGES.dsp:
      return `Rendering voice… ${pct}%`;
    case VOICE_REAPPLY_STAGES.remuxBase:
      return `Rewriting audio track… ${pct}%`;
    case VOICE_REAPPLY_STAGES.remuxBaked:
      return `Updating baked video… ${pct}%`;
    case VOICE_REAPPLY_STAGES.save:
      return `Saving… ${pct}%`;
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException('Voice re-apply cancelled.', 'AbortError');
  }
}

/**
 * Re-apply a voice to the current take. Resolves with provenance + timing, or
 * throws (VoiceReapplyError / AbortError / plain Error from the remux layer).
 */
export async function reapplyVoiceToCurrentTake(
  options: VoiceReapplyOptions,
): Promise<VoiceReapplyOutcome> {
  const startedAt = performance.now();
  throwIfAborted(options.signal);

  const manager = getTakeManager();
  const take = await manager.getCurrentTake();

  // ---- source resolution (all H6-verified before any work) ----
  const clean = await loadCleanAudioForTake(take);
  if (!clean.ok) {
    throw new VoiceReapplyError('clean-audio', cleanAudioUnavailableMessage(clean.reason));
  }
  // loadCleanAudioForTake(null) already rejected — take is non-null here.
  const takeId = take!.id;

  const base = await loadLastBaseMp4();
  if (!take!.artifacts.baseMp4 || !base || !takeArtifactMatchesStore(take!.artifacts.baseMp4, base.meta)) {
    if (take!.artifacts.baseMp4 && base) {
      await manager.clearArtifact('baseMp4', {
        note: 'Base video superseded — re-record to change the voice.',
      });
    }
    throw new VoiceReapplyError(
      'base-unavailable',
      'This take’s base video is unavailable — re-record to change the voice.',
    );
  }

  // Baked leg is best-effort: an H6 mismatch demotes the stamp and the
  // re-apply proceeds on the base artifact alone (honest, not fatal).
  let baked: Awaited<ReturnType<typeof loadLastBakedMp4>> = null;
  if (take!.artifacts.bakedMp4) {
    baked = await loadLastBakedMp4();
    if (!baked || !takeArtifactMatchesStore(take!.artifacts.bakedMp4, baked.meta)) {
      await manager.clearArtifact('bakedMp4', {
        note: 'Baked video superseded — bake again after changing the voice.',
      });
      baked = null;
    }
  }
  const hasBakedLeg = baked !== null;

  const report = (stage: VoiceReapplyStage, stageRatio: number): void => {
    const ratio = computeVoiceReapplyProgress(stage, stageRatio, hasBakedLeg);
    const chronos = snapshotBakeChronos(startedAt, ratio);
    options.onProgress?.({
      ratio,
      stage,
      message: voiceReapplyStageMessage(stage, ratio),
      ...chronos,
    });
  };

  // ---- DSP: render the new voice track from the RAW capture audio ----
  report(VOICE_REAPPLY_STAGES.dsp, 0);
  const normalized = normalizeVoiceEffectConfig(options.config);
  const intentKey = voiceEffectUserIntentKey(normalized);
  const graph = resolveVoiceGraph(normalized);
  const dspStartedAt = performance.now();
  const rendered = await processAudioWithGraph(
    clean.blob,
    graph,
    (ratio) => {
      report(VOICE_REAPPLY_STAGES.dsp, ratio);
    },
    // forceRender: voice-OFF re-applies still extract a clean AAC track (§3.3).
    { forceRender: true },
  );
  const dspMs = Math.round(performance.now() - dspStartedAt);
  throwIfAborted(options.signal);
  if (rendered.fallback || !rendered.applied) {
    throw new VoiceReapplyError(
      'dsp-failed',
      'Voice render failed — the take was left unchanged. Try again or pick another voice.',
    );
  }

  // ---- remux legs (validated; no store is touched yet) ----
  report(VOICE_REAPPLY_STAGES.remuxBase, 0);
  const remuxBaseStartedAt = performance.now();
  const newBase = await replaceAudioTrack({
    video: base.blob,
    audio: rendered.blob,
    signal: options.signal,
    onProgress: (ratio) => {
      report(VOICE_REAPPLY_STAGES.remuxBase, ratio);
    },
  });
  const remuxBaseMs = Math.round(performance.now() - remuxBaseStartedAt);

  let newBaked: Awaited<ReturnType<typeof replaceAudioTrack>> | null = null;
  let remuxBakedMs: number | null = null;
  if (baked) {
    report(VOICE_REAPPLY_STAGES.remuxBaked, 0);
    const remuxBakedStartedAt = performance.now();
    newBaked = await replaceAudioTrack({
      video: baked.blob,
      audio: rendered.blob,
      signal: options.signal,
      onProgress: (ratio) => {
        report(VOICE_REAPPLY_STAGES.remuxBaked, ratio);
      },
    });
    remuxBakedMs = Math.round(performance.now() - remuxBakedStartedAt);
  }

  // ---- commit (writes are last; H6 protects consumers if we die mid-way) ----
  report(VOICE_REAPPLY_STAGES.save, 0);
  const saveStartedAt = performance.now();

  // A concurrent capture may have taken over while we worked — overwriting the
  // single-slot stores now would clobber the NEWER take's artifacts.
  const takeBeforeCommit = await manager.getCurrentTake();
  if (!takeBeforeCommit || takeBeforeCommit.id !== takeId) {
    throw new VoiceReapplyError(
      'superseded',
      'A newer take replaced this one while the voice was rendering — nothing was changed.',
    );
  }

  await saveLastBaseMp4(newBase.blob, base.meta.durationSeconds);
  const baseStamp: TakeArtifactStamp = {
    savedAt: Date.now(),
    byteLength: newBase.blob.size,
    durationSeconds: base.meta.durationSeconds,
  };

  let bakedStamp: TakeArtifactStamp | undefined;
  if (newBaked && baked) {
    await saveLastBakedMp4(newBaked.blob, baked.meta.durationSeconds);
    bakedStamp = {
      savedAt: Date.now(),
      byteLength: newBaked.blob.size,
      durationSeconds: baked.meta.durationSeconds,
    };
  }

  const voiceStamp = createTakeVoiceStamp({
    intentKey,
    config: normalized as unknown as Record<string, unknown>,
    origin: 'reapply',
    previous: takeBeforeCommit.voice,
  });

  await manager.updateCurrentTake(
    {
      artifacts: { baseMp4: baseStamp, ...(bakedStamp ? { bakedMp4: bakedStamp } : {}) },
      voice: voiceStamp,
    },
    { expectId: takeId },
  );

  if (bakedStamp) {
    // Same "new baked bytes available" signal the bake path fires — the Reddit
    // panel's attach flow refreshes from it.
    await browser.storage.local.set({ [BAKED_MP4_READY_KEY]: Date.now() });
  }
  const saveMs = Math.round(performance.now() - saveStartedAt);
  report(VOICE_REAPPLY_STAGES.save, 1);

  const timing: VoiceReapplyTiming = {
    dspMs,
    remuxBaseMs,
    remuxBakedMs,
    saveMs,
    totalMs: Math.round(performance.now() - startedAt),
    audioBytes: rendered.blob.size,
    baseBytes: newBase.blob.size,
    bakedBytes: newBaked ? newBaked.blob.size : null,
  };
  console.log(
    `${EXTENSION_LOG_PREFIX} Voice re-apply: revision ${voiceStamp.revision} in ${timing.totalMs}ms ` +
      `(dsp ${dspMs}ms, remux base ${remuxBaseMs}ms` +
      `${remuxBakedMs !== null ? `, remux baked ${remuxBakedMs}ms` : ''}, save ${saveMs}ms).`,
  );

  return {
    intentKey,
    revision: voiceStamp.revision,
    bakedUpdated: Boolean(bakedStamp),
    timing,
  };
}
