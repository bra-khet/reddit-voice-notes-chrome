/**
 * v5.6.0 — Trim backend (docs/v5.6.0-audio-decoupling.md §4.4).
 *
 * NON-DESTRUCTIVE FIRST: a trim is stored as intent on the take snapshot
 * (`edits.trim`, ADR-0002-compatible additive field) and only materializes
 * when applyTrimToMp4 runs. The apply itself is mediabunny's Conversion API —
 * sample-accurate, stream-copying where the codec allows and re-encoding only
 * what it must.
 *
 * v5.9.0 — artifact wiring lives in trim-apply.ts (applyTrimToCurrentTake),
 * kept OUT of this module so scripts/test-timeline.mjs can keep bundling it
 * without the storage/preferences graph. This module stays: the planTrim gate,
 * intent CRUD, the mediabunny container trim, and the pure cue shift.
 *
 * v5.10.0 — raw capture WebM trim joins the same split: applyTrimToWebM
 * (audio-only output, roadmap §3B addendum) mirrors applyTrimToMp4, and the
 * pure planRawTrimLeg gate decides the raw leg ('skip'/'drop-stamp'/'trim').
 *
 * planTrim + shiftCuesForTrim + planRawTrimLeg are pure (Node-tested via
 * scripts/test-timeline.mjs).
 *
 * Sync: timeline.ts (clampTrimRange / TrimRange), take-manager.ts
 *       (TakeTrimEdit + edits patch), trim-apply.ts (the v5.9.0 consumer),
 *       ui/design-studio/timeline-geometry.ts projectCueThroughTrim (the ghost
 *       PREVIEW math shiftCuesForTrim must mirror — preview = apply),
 *       voice-reapply-plan.ts (stage naming convention if trim ever gains
 *       chronos stages)
 */

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
} from 'mediabunny';
import {
  getTakeManager,
  takeArtifactMatchesStore,
  type ArtifactStoreMeta,
  type TakeArtifactStamp,
} from '@/src/session/take-manager';
import {
  clampTrimRange,
  createTimeline,
  TRIM_MIN_DURATION_SECONDS,
  type TrimRange,
} from '@/src/timeline/timeline';
import { EXTENSION_LOG_PREFIX } from '@/src/utils/constants';

export type PlanTrimResult =
  | { ok: true; range: TrimRange }
  | { ok: false; error: string };

/**
 * Validate + frame-snap a requested trim against a clip. Pure — the single
 * gate both the intent store and the apply path use.
 */
export function planTrim(
  requested: { inSeconds: number; outSeconds: number },
  durationSeconds: number,
  fps: number,
): PlanTrimResult {
  let timeline;
  try {
    timeline = createTimeline(durationSeconds, fps);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const range = clampTrimRange(requested, timeline);
  if (!range) {
    return {
      ok: false,
      error:
        `Trim must keep at least ${TRIM_MIN_DURATION_SECONDS}s, stay inside the clip, ` +
        'and actually remove something.',
    };
  }
  return { ok: true, range };
}

/** Persist a validated trim as non-destructive intent on the current take. */
export async function storeTrimIntent(range: TrimRange): Promise<void> {
  await getTakeManager().updateCurrentTake({
    edits: { trim: { inSeconds: range.inSeconds, outSeconds: range.outSeconds } },
  });
}

/** Read any stored trim intent from the current take (null when none). */
export async function loadTrimIntent(): Promise<TrimRange | null> {
  const take = await getTakeManager().getCurrentTake();
  const trim = take?.edits?.trim;
  return trim ? { inSeconds: trim.inSeconds, outSeconds: trim.outSeconds } : null;
}

/** Clear any pending trim intent. */
export async function clearTrimIntent(): Promise<void> {
  await getTakeManager().updateCurrentTake({ edits: { trim: null } });
}

// ─── Cue shift (v5.9.0 — roadmap §3B) ────────────────────────────────────────

/** Structural cue shape — TranscriptSegment satisfies it; extra fields survive. */
export interface ShiftableCue {
  start: number;
  end: number;
}

/**
 * Same epsilon as timeline-geometry's TRIM_EPSILON: a zero-length survivor is
 * a removed cue, and float dust must not resurrect it.
 */
const CUE_SHIFT_EPSILON = 1e-6;

/**
 * Project cues onto the post-trim timeline: keep the overlap with [in, out),
 * shifted by -inSeconds. Cues fully outside the kept window are dropped;
 * partial overlaps are clamped. MIRRORS projectCueThroughTrim (the ghost-bar
 * preview) exactly — half-open overlap, inverted spans normalized, and NO
 * frame-snapping: cue times were never frame-aligned, and snapping here would
 * move bars relative to the preview users saw. Pure; input order preserved.
 */
export function shiftCuesForTrim<T extends ShiftableCue>(
  cues: readonly T[],
  range: TrimRange,
): T[] {
  const shifted: T[] = [];
  for (const cue of cues) {
    const start = Math.min(cue.start, cue.end);
    const end = Math.max(cue.start, cue.end);
    const keptStart = Math.max(start, range.inSeconds);
    const keptEnd = Math.min(end, range.outSeconds);
    if (keptEnd - keptStart <= CUE_SHIFT_EPSILON) continue;
    shifted.push({
      ...cue,
      start: keptStart - range.inSeconds,
      end: keptEnd - range.inSeconds,
    });
  }
  return shifted;
}

export interface ApplyTrimOptions {
  signal?: AbortSignal;
  /** Conversion progress [0,1] (mediabunny's own processed-time ratio). */
  onProgress?: (ratio: number) => void;
}

/**
 * Materialize a trim: produce a new MP4 covering [inSeconds, outSeconds).
 * The caller owns what happens to the result (download, artifact update +
 * cue shift — Phase 3 integration). Throws on cancel/failure; never returns
 * a partial container.
 */
export async function applyTrimToMp4(
  source: Blob,
  range: TrimRange,
  options?: ApplyTrimOptions,
): Promise<Blob> {
  if (options?.signal?.aborted) {
    throw new DOMException('Trim cancelled.', 'AbortError');
  }

  const input = new Input({ source: new BlobSource(source), formats: ALL_FORMATS });
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget(),
  });

  try {
    const conversion = await Conversion.init({
      input,
      output,
      trim: { start: range.inSeconds, end: range.outSeconds },
    });
    if (!conversion.isValid) {
      const reasons = conversion.discardedTracks
        .map((track) => track.reason)
        .join(', ');
      throw new Error(`Trim conversion invalid${reasons ? ` (${reasons})` : ''}.`);
    }
    conversion.onProgress = (progress) => {
      options?.onProgress?.(Math.min(1, Math.max(0, progress)));
    };
    const onAbort = (): void => {
      void conversion.cancel();
    };
    options?.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      await conversion.execute();
    } finally {
      options?.signal?.removeEventListener('abort', onAbort);
    }

    const buffer = output.target.buffer;
    if (!buffer || buffer.byteLength < 256) {
      throw new Error('Trim produced an empty MP4 buffer.');
    }
    console.log(
      `${EXTENSION_LOG_PREFIX} Trim: [${range.inSeconds.toFixed(3)}s → ` +
        `${range.outSeconds.toFixed(3)}s] → ${Math.round(buffer.byteLength / 1024)} KiB.`,
    );
    return new Blob([buffer], { type: 'video/mp4' });
  } finally {
    input.dispose();
  }
}

// ─── Raw capture WebM trim (v5.10.0 — roadmap §3B/§3C/§4) ────────────────────

/**
 * Decide the raw-recording leg of a trim apply. Pure — Node-tested truth table.
 * A raw-leg problem is never fatal to the trim itself: the MP4 cut is the
 * product action; this leg only decides whether post-trim voice re-apply stays
 * available ('trim'), is honestly locked ('drop-stamp' — the v5.9 outcome), or
 * was never possible ('skip' — legacy take without a stamp).
 */
export type RawTrimLegPlan = 'skip' | 'drop-stamp' | 'trim';

export function planRawTrimLeg(
  stamp: TakeArtifactStamp | undefined,
  storeMeta: ArtifactStoreMeta | null | undefined,
): RawTrimLegPlan {
  if (!stamp) return 'skip';
  return takeArtifactMatchesStore(stamp, storeMeta) ? 'trim' : 'drop-stamp';
}

/**
 * Materialize a trim of the raw capture WebM: produce an AUDIO-ONLY WebM
 * covering [inSeconds, outSeconds). The video track is discarded by design
 * (roadmap §3B addendum): every post-trim consumer of `baseRecording` is an
 * audio consumer, and keeping the VP8 canvas track would force a whole-clip
 * video re-encode nothing ever reads. Opus boundaries are sample-accurate —
 * mediabunny decodes, trims the edge sample, and re-encodes.
 *
 * Browser-only (WebCodecs), like applyTrimToMp4. Throws on cancel/failure;
 * never returns a partial container.
 */
export async function applyTrimToWebM(
  source: Blob,
  range: TrimRange,
  options?: ApplyTrimOptions,
): Promise<Blob> {
  if (options?.signal?.aborted) {
    throw new DOMException('Trim cancelled.', 'AbortError');
  }

  const input = new Input({ source: new BlobSource(source), formats: ALL_FORMATS });
  const output = new Output({
    format: new WebMOutputFormat(),
    target: new BufferTarget(),
  });

  try {
    const conversion = await Conversion.init({
      input,
      output,
      trim: { start: range.inSeconds, end: range.outSeconds },
      video: { discard: true },
      showWarnings: false, // our own video discard is intentional, not a warning
    });
    if (!conversion.isValid) {
      // Only unintentional discards explain the failure — the video track is
      // discarded by us on purpose and must not masquerade as the reason.
      const reasons = conversion.discardedTracks
        .filter((entry) => entry.reason !== 'discarded_by_user')
        .map((entry) => entry.reason)
        .join(', ');
      throw new Error(`Raw audio trim invalid${reasons ? ` (${reasons})` : ''}.`);
    }
    conversion.onProgress = (progress) => {
      options?.onProgress?.(Math.min(1, Math.max(0, progress)));
    };
    const onAbort = (): void => {
      void conversion.cancel();
    };
    options?.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      await conversion.execute();
    } finally {
      options?.signal?.removeEventListener('abort', onAbort);
    }

    const buffer = output.target.buffer;
    if (!buffer || buffer.byteLength < 256) {
      throw new Error('Raw audio trim produced an empty WebM buffer.');
    }
    console.log(
      `${EXTENSION_LOG_PREFIX} Raw audio trim: [${range.inSeconds.toFixed(3)}s → ` +
        `${range.outSeconds.toFixed(3)}s] → ${Math.round(buffer.byteLength / 1024)} KiB (audio-only).`,
    );
    return new Blob([buffer], { type: 'audio/webm' });
  } finally {
    input.dispose();
  }
}
