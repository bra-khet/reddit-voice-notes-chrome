/**
 * v5.6.0 — Trim backend (docs/v5.6.0-audio-decoupling.md §4.4).
 *
 * NON-DESTRUCTIVE FIRST: a trim is stored as intent on the take snapshot
 * (`edits.trim`, ADR-0002-compatible additive field) and only materializes
 * when applyTrimToMp4 runs. The apply itself is mediabunny's Conversion API —
 * sample-accurate, stream-copying where the codec allows and re-encoding only
 * what it must.
 *
 * DELIBERATELY NOT WIRED to artifact mutation in this branch: applying a trim
 * to baseMp4/bakedMp4 also shifts every subtitle cue and the take duration,
 * which needs its own QA gate (design doc §7 Phase 3). The backend contract —
 * validate, store intent, produce a trimmed container — is complete here.
 *
 * planTrim is pure (Node-tested via scripts/test-timeline.mjs).
 *
 * Sync: timeline.ts (clampTrimRange / TrimRange), take-manager.ts
 *       (TakeTrimEdit + edits patch), voice-reapply-plan.ts (stage naming
 *       convention if trim ever gains chronos stages)
 */

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
} from 'mediabunny';
import { getTakeManager } from '@/src/session/take-manager';
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
