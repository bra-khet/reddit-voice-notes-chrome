/**
 * v5.9.0 — Trim apply orchestrator (docs/v5.9.0-trim-apply-roadmap.md §4).
 *
 * Materializes a trim onto the CURRENT TAKE: H6-verified base → mediabunny
 * container trim → cue shift (both transcript copies) → commit-last writes.
 * Structurally parallel to voice-reapply.ts (the proven artifact-mutation
 * template): source resolution first, transform with no store touched, a
 * superseded guard, then every write grouped at the end (invariant I7 — any
 * earlier failure leaves the take untouched).
 *
 * Deliberately a SEPARATE module from trim.ts so scripts/test-timeline.mjs can
 * keep bundling the pure trim logic without the storage/preferences graph.
 *
 * Consequences committed here (roadmap §3):
 * - §3C: bakedMp4 stamp is DROPPED, status baked → ready — the next bake is a
 *   full composite from the trimmed base (computePartialRebakePlan's duration
 *   guard makes a splice into the stale baked MP4 impossible). No
 *   BAKED_MP4_READY_KEY: no baked bytes were produced; the take-snapshot
 *   storage.onChanged broadcast is the update channel.
 * - §3H: BOTH session-transcript copies shift — revert must never resurrect
 *   pre-trim cue times.
 * - v5.10.0 (supersedes v5.9 §3I): the raw capture WebM is TRIMMED WITH the
 *   MP4 (audio-only, planRawTrimLeg → applyTrimToWebM) and re-stamped, so
 *   voice re-apply / Change Voice stay available on the trimmed timeline.
 *   Only when the raw leg cannot run (no stamp, store mismatch, conversion
 *   failure, unpersistable size) does the stamp drop — the v5.9 outcome:
 *   voice locks honestly through the existing clean-audio door. A raw-leg
 *   problem is never fatal to the trim itself.
 *
 * Sync: trim.ts (planTrim gate, applyTrimToMp4, applyTrimToWebM,
 *       planRawTrimLeg, shiftCuesForTrim),
 *       take-manager.ts (artifacts null-delete patch, H6),
 *       last-recording-db.ts (saveLastRecording persistability bounds — H13),
 *       session-transcript-db.ts (replaceSessionTranscriptResults),
 *       ui/design-studio/subtitle-segment-editor.ts (the Studio caller — owns
 *       the post-apply in-memory refresh + undo-stack reset)
 */

import {
  getTakeManager,
  takeArtifactMatchesStore,
  type TakeArtifactStamp,
} from '@/src/session/take-manager';
import { loadLastBaseMp4, saveLastBaseMp4 } from '@/src/storage/last-base-mp4-db';
import {
  LAST_RECORDING_MAX_BYTES,
  LAST_RECORDING_MIN_BYTES,
  loadLastRecording,
  saveLastRecording,
} from '@/src/storage/last-recording-db';
import {
  loadSessionTranscript,
  replaceSessionTranscriptResults,
} from '@/src/storage/session-transcript-db';
import {
  cloneTranscriptResult,
  rebuildTextFromSegments,
} from '@/src/transcription/transcript-editing';
import type { TranscriptResult } from '@/src/transcription/types';
import type { TrimRange } from '@/src/timeline/timeline';
import { EXTENSION_LOG_PREFIX } from '@/src/utils/constants';
import {
  applyTrimToMp4,
  applyTrimToWebM,
  planRawTrimLeg,
  planTrim,
  shiftCuesForTrim,
} from './trim';

export type TrimApplyErrorCode =
  | 'invalid-range' // planTrim rejected the request (or no clip duration)
  | 'base-unavailable' // baseMp4 missing or H6-mismatched
  | 'superseded'; // another take took over mid-trim

export class TrimApplyError extends Error {
  readonly code: TrimApplyErrorCode;

  constructor(code: TrimApplyErrorCode, message: string) {
    super(message);
    this.name = 'TrimApplyError';
    this.code = code;
  }
}

export interface TrimApplyOptions {
  /** Raw marker positions from the trim strip — planTrim snaps and validates. */
  requested: { inSeconds: number; outSeconds: number };
  fps: number;
  /**
   * Best-known media length from the editor (typically max(meta, decoded)).
   * When present and longer than base store meta, planTrim uses it so a legacy
   * whole-second-floored stamp cannot force the OUT marker below real audio.
   */
  clipDurationSeconds?: number;
  /**
   * The LIVE draft as an edited TranscriptResult. Preview = apply: the ghost
   * bars project the open draft, so the shift must consume it too (the store's
   * editedResult may be stale against unsaved modal edits). Null falls back to
   * the stored editedResult; if neither exists the transcript leg is skipped.
   */
  editedResult: TranscriptResult | null;
  signal?: AbortSignal;
  /** Overall [0,1] — the container trim dominates. */
  onProgress?: (ratio: number) => void;
}

export interface TrimApplyOutcome {
  range: TrimRange;
  newDurationSeconds: number;
  /** The transcript copies as persisted (null when the take has no transcript). */
  shiftedOriginal: TranscriptResult | null;
  shiftedEdited: TranscriptResult | null;
  /** Cues that fell entirely outside the kept window (vs the edited source). */
  removedCueCount: number;
  /** True when a bakedMp4 stamp existed and was dropped (re-bake needed). */
  bakedCleared: boolean;
  /**
   * v5.10.0 — the raw-recording leg's honest outcome (replaces v5.9's
   * `voiceLocked`): 'trimmed' = baseRecording was cut with the MP4 and
   * re-stamped (voice re-apply stays available) · 'dropped' = the stamp
   * existed but the leg could not run (voice locked, the v5.9 behavior) ·
   * 'none' = the take never had a raw-recording stamp.
   */
  rawAudio: 'trimmed' | 'dropped' | 'none';
}

/** Mechanical shift of one TranscriptResult onto the post-trim timeline. */
function shiftTranscriptResult(
  result: TranscriptResult,
  range: TrimRange,
  newDurationSeconds: number,
): TranscriptResult {
  const clone = cloneTranscriptResult(result);
  const segments = shiftCuesForTrim(clone.segments, range);
  return {
    ...clone,
    segments,
    text: rebuildTextFromSegments(segments),
    duration: newDurationSeconds,
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException('Trim apply cancelled.', 'AbortError');
  }
}

/**
 * Apply a trim to the current take. Resolves with the committed outcome, or
 * throws (TrimApplyError / AbortError / plain Error from the container trim).
 * Every failure before the commit block leaves stores and stamps untouched.
 */
export async function applyTrimToCurrentTake(
  options: TrimApplyOptions,
): Promise<TrimApplyOutcome> {
  throwIfAborted(options.signal);
  const report = (ratio: number): void => {
    options.onProgress?.(Math.min(1, Math.max(0, ratio)));
  };
  report(0);

  const manager = getTakeManager();
  const take = await manager.getCurrentTake();
  if (!take) {
    throw new TrimApplyError('base-unavailable', 'No current take — nothing was trimmed.');
  }
  const takeId = take.id;

  // ---- source resolution (all H6-verified before any work) ----
  const base = await loadLastBaseMp4();
  if (
    !take.artifacts.baseMp4 ||
    !base ||
    !takeArtifactMatchesStore(take.artifacts.baseMp4, base.meta)
  ) {
    if (take.artifacts.baseMp4 && base) {
      await manager.clearArtifact('baseMp4', {
        note: 'Base video superseded — nothing was trimmed.',
      });
    }
    throw new TrimApplyError(
      'base-unavailable',
      'This take’s base video is unavailable — nothing was trimmed.',
    );
  }

  // CHANGED: v5.10.0 — raw-recording leg resolved up front (roadmap §4 step 3).
  // WHY: the WebM must be trimmed WITH the MP4 so post-trim voice re-apply
  //      stays available; a mismatched/absent raw source demotes to the v5.9
  //      drop-stamp outcome instead of failing the trim.
  const recording = await loadLastRecording();
  let rawLeg = planRawTrimLeg(take.artifacts.baseRecording, recording?.meta ?? null);

  // The SAME gate Save-intent uses — apply never trusts raw marker positions.
  // BUG FIX: trim OUT forced to whole second (floored recorder meta)
  // Fix: plan against max(store meta, editor clip length) so legacy floored
  //      stamps cannot clamp OUT below decoded/waveform length.
  // Sync: subtitle-segment-editor onSaveTrimIntent / getClipDurationSeconds.
  const editorClip =
    typeof options.clipDurationSeconds === 'number' &&
    Number.isFinite(options.clipDurationSeconds) &&
    options.clipDurationSeconds > 0
      ? options.clipDurationSeconds
      : 0;
  const durationGate = Math.max(base.meta.durationSeconds, editorClip);
  const plan = planTrim(options.requested, durationGate, options.fps);
  if (!plan.ok) {
    throw new TrimApplyError('invalid-range', plan.error);
  }
  const range = plan.range;
  const newDurationSeconds = range.outSeconds - range.inSeconds;
  report(0.02);

  // ---- transform (no store touched yet) ----
  // Progress budget: the MP4 cut dominates; when the raw leg runs it takes the
  // 0.72–0.90 span so the meter never jumps backwards between legs.
  const mp4Span = rawLeg === 'trim' ? 0.68 : 0.88;
  const trimmedBlob = await applyTrimToMp4(base.blob, range, {
    signal: options.signal,
    onProgress: (ratio) => {
      report(0.02 + ratio * mp4Span);
    },
  });
  throwIfAborted(options.signal);

  // ---- raw-recording leg (v5.10.0; still no store touched) ----
  let trimmedRawBlob: Blob | null = null;
  if (rawLeg === 'trim' && recording) {
    try {
      const rawBlob = await applyTrimToWebM(recording.blob, range, {
        signal: options.signal,
        onProgress: (ratio) => {
          report(0.72 + ratio * 0.18);
        },
      });
      // Early demote: saveLastRecording would throw on these bounds anyway
      // (H13 store gate), but rejecting here keeps the failure inside the
      // transform phase — before ANY store write — instead of mid-commit.
      if (rawBlob.size >= LAST_RECORDING_MIN_BYTES && rawBlob.size <= LAST_RECORDING_MAX_BYTES) {
        trimmedRawBlob = rawBlob;
      } else {
        console.warn(
          `${EXTENSION_LOG_PREFIX} Raw audio trim result not persistable ` +
            `(${rawBlob.size} bytes) — dropping baseRecording stamp instead.`,
        );
        rawLeg = 'drop-stamp';
      }
    } catch (error) {
      // A cancel aborts the whole apply (nothing written yet); any other
      // raw-leg failure demotes to the v5.9 outcome — the trim itself proceeds.
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error;
      }
      console.warn(`${EXTENSION_LOG_PREFIX} Raw audio trim failed — voice stays locked.`, error);
      rawLeg = 'drop-stamp';
    }
  }
  throwIfAborted(options.signal);

  // Cue shift, computed in memory for BOTH copies (§3H). The live draft is the
  // edited source; the stored baseline shifts independently.
  const snapshot = await loadSessionTranscript();
  const sourceEdited = options.editedResult ?? snapshot?.editedResult ?? null;
  const sourceOriginal = snapshot?.originalResult ?? null;
  const shiftedEdited = sourceEdited
    ? shiftTranscriptResult(sourceEdited, range, newDurationSeconds)
    : null;
  // No stored baseline (in-session scaffold): re-base onto the shifted edited
  // copy — the same fallback saveSessionTranscriptEdits uses for new records.
  const shiftedOriginal = sourceOriginal
    ? shiftTranscriptResult(sourceOriginal, range, newDurationSeconds)
    : shiftedEdited;
  const removedCueCount = sourceEdited
    ? sourceEdited.segments.length - (shiftedEdited?.segments.length ?? 0)
    : 0;
  report(0.92);

  // ---- superseded guard: never clobber a newer take's single-slot blobs ----
  const takeBeforeCommit = await manager.getCurrentTake();
  if (!takeBeforeCommit || takeBeforeCommit.id !== takeId) {
    throw new TrimApplyError(
      'superseded',
      'A newer take replaced this one while trimming — nothing was changed.',
    );
  }
  const bakedCleared = Boolean(takeBeforeCommit.artifacts.bakedMp4);

  // ---- commit block (writes last, I7; H6 protects consumers if we die here) ----
  // BUG FIX: H13 false-success artifact publication
  // Fix: both stamps were manufactured with Date.now() after saves that could
  //      silently no-op (size) or swallow IDB failure — a failed write still
  //      shipped a fresh stamp over the previous artifact's bytes. Saves now
  //      throw: a base-save failure aborts the apply before anything else is
  //      written (old stamp still describes the old record); a raw-save
  //      failure demotes to the honest v5.9 stamp-drop (I19) and never fails
  //      the trim. Stamps carry the store's returned persisted meta.
  // Sync: src/storage/last-base-mp4-db.ts + last-recording-db.ts (contract),
  //       audio/voice-reapply.ts + subtitle-bake.ts (same pattern).
  const baseMeta = await saveLastBaseMp4(trimmedBlob, newDurationSeconds);
  const baseStamp: TakeArtifactStamp = {
    savedAt: baseMeta.savedAt,
    byteLength: baseMeta.byteLength,
    durationSeconds: baseMeta.durationSeconds,
  };

  if (shiftedEdited) {
    await replaceSessionTranscriptResults(shiftedOriginal ?? shiftedEdited, shiftedEdited);
  }

  // v5.10.0 — the trimmed raw WebM replaces the single-slot recording; its
  // fresh stamp rides the SAME updateCurrentTake write as the base stamp.
  let rawStamp: TakeArtifactStamp | null = null;
  if (trimmedRawBlob) {
    try {
      const rawMeta = await saveLastRecording(trimmedRawBlob, newDurationSeconds);
      rawStamp = {
        savedAt: rawMeta.savedAt,
        byteLength: rawMeta.byteLength,
        durationSeconds: rawMeta.durationSeconds,
      };
    } catch (error) {
      // The pure size pre-check above already demoted unpersistable blobs;
      // this catches the IDB-failure half of H13. Same honest outcome.
      console.warn(
        `${EXTENSION_LOG_PREFIX} Raw audio save failed — dropping baseRecording stamp instead.`,
        error,
      );
      rawLeg = 'drop-stamp';
    }
  }
  const rawAudio: TrimApplyOutcome['rawAudio'] =
    rawStamp !== null ? 'trimmed' : rawLeg === 'skip' ? 'none' : 'dropped';

  const durationLabel = newDurationSeconds.toFixed(1);
  const note =
    bakedCleared && rawAudio === 'trimmed'
      ? `Trimmed to ${durationLabel}s — bake again for the new timeline; voice changes stay available.`
      : bakedCleared
        ? `Trimmed to ${durationLabel}s — bake again to burn subtitles on the new timeline.`
        : rawAudio === 'trimmed'
          ? `Trimmed to ${durationLabel}s — voice changes stay available.`
          : `Trimmed to ${durationLabel}s.`;

  await manager.updateCurrentTake(
    {
      // A trimmed take needs a fresh bake — 'ready' is the honest capability.
      status: takeBeforeCommit.status === 'baked' ? 'ready' : undefined,
      meta: {
        durationSeconds: newDurationSeconds,
        note,
      },
      artifacts: { baseMp4: baseStamp, bakedMp4: null, baseRecording: rawStamp },
      edits: { trim: null },
    },
    { expectId: takeId },
  );
  report(1);

  console.log(
    `${EXTENSION_LOG_PREFIX} Trim applied: [${range.inSeconds.toFixed(3)}s → ` +
      `${range.outSeconds.toFixed(3)}s] · new duration ${newDurationSeconds.toFixed(3)}s · ` +
      `${removedCueCount} cue(s) removed` +
      `${bakedCleared ? ' · baked cleared (re-bake needed)' : ''}` +
      `${
        rawAudio === 'trimmed'
          ? ' · raw audio trimmed (voice re-apply available)'
          : rawAudio === 'dropped'
            ? ' · voice locked in (raw audio dropped)'
            : ''
      }.`,
  );

  return {
    range,
    newDurationSeconds,
    shiftedOriginal: shiftedOriginal ?? null,
    shiftedEdited,
    removedCueCount,
    bakedCleared,
    rawAudio,
  };
}
