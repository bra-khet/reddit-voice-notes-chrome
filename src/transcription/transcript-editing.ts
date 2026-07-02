import {
  transcriptResultsEqual,
  type TranscriptResult,
  type TranscriptSegment,
} from '@/src/transcription/types';

/** Deep-clone a transcript for editable working copy. */
export function cloneTranscriptResult(result: TranscriptResult): TranscriptResult {
  return {
    text: result.text,
    source: result.source,
    language: result.language,
    segments: result.segments.map((segment) => ({ ...segment })),
    // CHANGED: carry duration through clones (v5.3) — otherwise the scaffold's
    // clip length is lost on every snapshot clone. Equality checks ignore it.
    duration: result.duration,
  };
}

const MIN_CUE_DURATION_SECONDS = 0.5;
const DEFAULT_NEW_CUE_SECONDS = 3;

function normalizeCueSeconds(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** Stable chronological order for burn-in / preview. */
export function sortSegmentsByStart(segments: TranscriptSegment[]): TranscriptSegment[] {
  return segments
    .map((segment, index) => ({ segment, index }))
    .sort((a, b) => a.segment.start - b.segment.start || a.index - b.index)
    .map(({ segment }) => ({ ...segment }));
}

/**
 * Default timing for a newly added cue — appended after existing segments.
 * Start = previous cue end (or 0); end = clip duration when known, else start + 3s.
 */
export function buildDefaultNewSegment(
  existingSegments: TranscriptSegment[],
  clipDurationSeconds?: number | null,
): TranscriptSegment {
  const ordered = sortSegmentsByStart(existingSegments);
  const last = ordered[ordered.length - 1];
  const start = last ? normalizeCueSeconds(last.end) : 0;

  const clipDuration =
    typeof clipDurationSeconds === 'number' &&
    Number.isFinite(clipDurationSeconds) &&
    clipDurationSeconds > 0
      ? clipDurationSeconds
      : null;

  let end: number;
  if (clipDuration !== null && clipDuration > start) {
    end = clipDuration;
  } else if (clipDuration !== null && clipDuration <= start) {
    end = start + MIN_CUE_DURATION_SECONDS;
  } else {
    end = start + DEFAULT_NEW_CUE_SECONDS;
  }

  if (end <= start) {
    end = start + MIN_CUE_DURATION_SECONDS;
  }

  return { start, end, text: '' };
}

/**
 * Remove soft-hyphen scaffold placeholders so the text can be displayed, typed
 * into, or rendered cleanly. Soft hyphen (U+00AD) is NOT whitespace, so plain
 * `.trim()` does not strip it — callers must use this first.
 */
export function stripScaffoldPlaceholder(text: string): string {
  return text.split(SCAFFOLD_SOFT_HYPHEN).join('');
}

/**
 * A cue is "blank" when nothing but scaffold placeholders / whitespace remains.
 * Used everywhere emptiness matters (preview "(empty)", SRT skip, bake filter)
 * so soft-hyphen scaffold slots read as empty — they persist in storage but bake
 * to nothing.
 */
export function cueTextIsBlank(text: string): boolean {
  return stripScaffoldPlaceholder(text).trim().length === 0;
}

/** Minimum on-screen cue window for bake + canvas overlay (mirrors drawtext segmentTiming). */
export const MIN_BAKE_CUE_DURATION_SECONDS = 0.35;

/**
 * Single source of truth for subtitle bake / canvas overlay segment prep (v5.3.4 Phase 5.2).
 * Drops blank scaffold slots, strips placeholders, enforces min cue duration, spreads missing
 * Vosk timings, and clamps ends to clip length when known.
 * Sync: subtitle-burnin.ts normalizeSegmentsForBurnIn; subtitle-overlay-renderer.ts
 */
export function prepareSegmentsForSubtitleBake(
  segments: TranscriptSegment[],
  videoDurationSeconds?: number,
): TranscriptSegment[] {
  const duration =
    typeof videoDurationSeconds === 'number' && Number.isFinite(videoDurationSeconds) && videoDurationSeconds > 0
      ? Math.max(1, videoDurationSeconds)
      : null;

  const usable = sortSegmentsByStart(segments)
    .filter((segment) => !cueTextIsBlank(segment.text))
    .map((segment) => ({
      ...segment,
      text: stripScaffoldPlaceholder(segment.text).trim(),
      start: normalizeCueSeconds(segment.start),
      end: normalizeCueSeconds(segment.end),
    }))
    .filter((segment) => segment.text.length > 0);

  if (usable.length === 0) return [];

  const missingTimings = usable.every((segment) => segment.end <= segment.start);

  if (missingTimings && duration !== null) {
    const slot = duration / usable.length;
    return usable.map((segment, index) => {
      const start = index * slot;
      const end = Math.min(duration, (index + 1) * slot - 0.05);
      return { ...segment, start, end: Math.max(start + MIN_BAKE_CUE_DURATION_SECONDS, end) };
    });
  }

  return usable
    .map((segment) => {
      const start = Math.max(0, segment.start);
      let end = Math.max(start + MIN_BAKE_CUE_DURATION_SECONDS, segment.end);
      if (duration !== null) {
        end = Math.min(end, duration);
      }
      return { ...segment, start, end };
    })
    .filter((segment) => duration === null || segment.start < duration);
}

/** Rebuild full transcript text from segment lines (single space join). */
export function rebuildTextFromSegments(segments: TranscriptSegment[]): string {
  return segments
    .map((segment) => stripScaffoldPlaceholder(segment.text).trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

/** Keep aggregate text aligned with segment edits. */
export function normalizeEditedTranscriptResult(
  base: TranscriptResult,
  segments: TranscriptSegment[],
  options?: { keepEmptyTimedSegments?: boolean },
): TranscriptResult {
  // CHANGED: keepEmptyTimedSegments preserves empty-but-timed scaffold slots (v5.3
  // Phase 4). WHY: a scaffold's empty slots ARE the feature — stripping them on
  // apply would destroy the template. Empty cues still bake to nothing (srt-builder
  // skips them + subtitle-bake.ts filters segment.text.trim()), so this is output-safe.
  const keepEmpty = options?.keepEmptyTimedSegments === true;
  const cleaned = sortSegmentsByStart(
    segments
      .map((segment) => ({
        start: normalizeCueSeconds(segment.start),
        end: normalizeCueSeconds(segment.end),
        text: segment.text.trim(),
      }))
      .filter((segment) => (keepEmpty ? segment.end > segment.start : segment.text.length > 0)),
  );

  return {
    ...base,
    text: rebuildTextFromSegments(cleaned),
    segments: cleaned,
    source: 'manual',
  };
}

export function isTranscriptDirty(
  original: TranscriptResult | null | undefined,
  edited: TranscriptResult | null | undefined,
): boolean {
  if (!original && !edited) return false;
  if (!original || !edited) return Boolean(edited);
  return !transcriptResultsEqual(original, edited);
}

/** YouTube-style cue timestamp — m:ss or h:mm:ss with tenths when under one minute. */
export function formatCueTimestamp(seconds: number): string {
  const safe = Math.max(0, seconds);
  const whole = Math.floor(safe);
  const tenths = Math.round((safe - whole) * 10);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  if (minutes > 0) {
    return `${minutes}:${String(secs).padStart(2, '0')}`;
  }
  return `0:${String(secs).padStart(2, '0')}.${tenths}`;
}

export function formatCueRange(start: number, end: number): string {
  return `${formatCueTimestamp(start)} → ${formatCueTimestamp(end)}`;
}

// ════════════════════════════════════════════════════════════════════════════
// v5.3 Subtitle QoL — Timecode Scaffolding (design doc §6)
// ════════════════════════════════════════════════════════════════════════════

// CHANGED: default scaffold slot 5s → 3s (QA: 5s feels long for the short phrase
// that fits on one subtitle line without multi-line wrapping). v5.3 subtitle QoL.
// Revisit upward if/when burn-in gains multi-line wrapping (Phase 7 follow-up).
/** Default minimum slot length for evenly-timed scaffolding (design doc §6). */
export const DEFAULT_SCAFFOLD_MIN_SEGMENT_SECONDS = 3;

/**
 * Soft hyphen — an *invisible* placeholder character. Unlike '', it survives
 * "is this slot empty?" filters (e.g. rebuildTextFromSegments) so scaffold slots
 * aren't silently stripped on normalize. Burn-in/preview render it as nothing.
 */
export const SCAFFOLD_SOFT_HYPHEN = '­';

/**
 * Generate evenly-timed empty subtitle slots covering a full clip.
 *
 * Turns a Vosk failure (or a manual "give me a template" click) into a usable
 * editor scaffold: a contiguous, gap-free, non-overlapping set of timed segments
 * spanning [0, clipDuration], each carrying `placeholder` text.
 *
 * CONTRACT — asserted by scripts/test-scaffold.mjs:
 *  - clipDuration <= 0 / non-finite        → []
 *  - segments[0].start === 0
 *  - contiguous: segments[i].end === segments[i+1].start (no gaps, no overlaps)
 *  - last segment .end === clipDuration EXACTLY (clamp float drift)
 *  - every segment.text === placeholder
 *  - clipDuration <= minSegmentSec         → exactly one slot [0, clipDuration]
 *
 * @param clipDuration  full clip length in seconds (from recording metadata)
 * @param minSegmentSec target slot length; also the floor for slot count
 * @param placeholder   '' (truly empty) or SCAFFOLD_SOFT_HYPHEN
 */
export function generateTranscriptScaffold(
  clipDuration: number,
  minSegmentSec: number = DEFAULT_SCAFFOLD_MIN_SEGMENT_SECONDS,
  placeholder: string = '',
): TranscriptSegment[] {
  // Guard: nothing to scaffold for empty / invalid / non-finite durations.
  if (!Number.isFinite(clipDuration) || clipDuration <= 0) return [];

  // Guard: a nonsensical min collapses to a single full-clip slot.
  const minSeg =
    Number.isFinite(minSegmentSec) && minSegmentSec > 0 ? minSegmentSec : clipDuration;

  const segments: TranscriptSegment[] = [];

  // Strategy C — fixed `minSeg` chunks on round boundaries, then fold a runt
  // final tail (< ½·minSeg) back into its predecessor so there's no awkward
  // tiny slot. Round boundaries AND no stub; a merged tail can reach ~1.5×minSeg,
  // which Phase 6 Smart Split handles if the user wants it shorter.
  const slotCount = Math.ceil(clipDuration / minSeg);
  for (let i = 0; i < slotCount; i++) {
    const start = i * minSeg;
    const end = Math.min((i + 1) * minSeg, clipDuration);
    segments.push({ start, end, text: placeholder });
  }

  // Merge a runt final slot into the one before it (only when >1 slot exists).
  const last = segments[segments.length - 1];
  if (segments.length > 1 && last.end - last.start < minSeg / 2) {
    segments.pop();
  }

  // Clamp the final slot's end to EXACTLY clipDuration — kills float drift so
  // the OOB check (segment-timing.ts) never sees a phantom end > clip length.
  segments[segments.length - 1].end = clipDuration;

  return segments;
}

/**
 * Wrap a fresh scaffold into a persistable TranscriptResult (source: 'manual').
 * Used by the failure path (Phase 2) and the manual "Generate scaffolding"
 * button (Phase 5). The aggregate text is empty — nothing is transcribed yet.
 */
export function buildScaffoldTranscriptResult(
  clipDuration: number,
  options?: { minSegmentSec?: number; placeholder?: string; language?: string },
): TranscriptResult {
  // CHANGED: default placeholder is the soft hyphen, not '' (v5.3 QA fix).
  // WHY: empty-text slots get scrubbed by normalize's length>0 filter; a soft
  // hyphen is non-empty so the slots persist intrinsically (independent of the
  // editor's scaffold-mode detection), yet read as blank everywhere via
  // cueTextIsBlank, so they still bake to nothing.
  const segments = generateTranscriptScaffold(
    clipDuration,
    options?.minSegmentSec ?? DEFAULT_SCAFFOLD_MIN_SEGMENT_SECONDS,
    options?.placeholder ?? SCAFFOLD_SOFT_HYPHEN,
  );
  return {
    text: '',
    segments,
    source: 'manual',
    language: options?.language,
    duration: Number.isFinite(clipDuration) && clipDuration > 0 ? clipDuration : undefined,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// v5.3 Subtitle QoL — Phase 6: Long-Segment Smart Split (design doc §9–§10)
// ════════════════════════════════════════════════════════════════════════════

/** Round cue seconds to 0.01s — tidy editor values without visible float drift. */
function roundCueSeconds(value: number): number {
  return Math.round(normalizeCueSeconds(value) * 100) / 100;
}

/**
 * Split one segment into N sub-segments carrying `chunks`, dividing the original
 * time span PROPORTIONALLY to each chunk's character length (design doc §10:
 * "word split → proportional char-length time interpolation"). Longer text gets
 * proportionally more screen time. Pure + node-tested (scripts/test-smart-split.mjs).
 *
 * The caller (segment editor) computes `chunks` via the canvas width measurer
 * (text-metrics.groupWordsByWidth) so each chunk fits one caption line; this
 * function only owns the timing math, which keeps it canvas-free and testable.
 *
 * CONTRACT — asserted by scripts/test-smart-split.mjs:
 *  - chunks.length <= 1                       → [{ ...segment }] (nothing to split)
 *  - non-positive span (start >= end)         → single cue with chunks rejoined
 *  - sub-segments are contiguous + gap-free + non-overlapping
 *  - first.start === segment.start; last.end === segment.end EXACTLY (drift clamp)
 *  - weight = chunk trimmed length, floored at 1 so a near-empty chunk still gets time
 */
export function splitSegmentIntoChunks(
  segment: TranscriptSegment,
  chunks: string[],
): TranscriptSegment[] {
  if (chunks.length <= 1) return [{ ...segment }];

  const start = normalizeCueSeconds(segment.start);
  const end = normalizeCueSeconds(segment.end);
  const span = end - start;
  if (span <= 0) {
    // No interpolable span — collapse to a single cue with the text rejoined.
    return [{ ...segment, text: chunks.join(' ') }];
  }

  const weights = chunks.map((chunk) => Math.max(1, chunk.trim().length));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  // Cumulative proportional boundaries: boundaries[i] = end of chunk i (interior
  // only, rounded). Computing from the original start (not a running cursor) keeps
  // boundaries exact before rounding and guarantees contiguity.
  const boundaries: number[] = [];
  let acc = 0;
  for (let i = 0; i < chunks.length - 1; i += 1) {
    acc += weights[i];
    boundaries.push(roundCueSeconds(start + (span * acc) / totalWeight));
  }

  const out: TranscriptSegment[] = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const cueStart = i === 0 ? start : boundaries[i - 1];
    const cueEnd = i === chunks.length - 1 ? end : boundaries[i];
    out.push({ start: cueStart, end: cueEnd, text: chunks[i] });
  }
  return out;
}