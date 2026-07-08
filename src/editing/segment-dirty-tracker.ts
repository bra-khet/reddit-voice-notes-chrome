/**
 * v5.6.0 — Segment dirty tracking (docs/v5.6.0-audio-decoupling.md §4.1).
 *
 * Answers "which parts of the baked visual layer does this edit invalidate?"
 * without decoding anything: diff two prepared cue lists (+ a global style
 * flag) into dirty TIME WINDOWS, then map those windows onto encoded segments
 * using the same half-open overlap semantics as computeSegmentCueSpan.
 *
 * Identity model: cues are content-keyed (start · end · text) — the transcript
 * layer has no stable cue ids, and a cue whose timing OR text changed must
 * dirty both its old and new windows anyway, which multiset symmetric
 * difference gives for free.
 *
 * Pure logic — Node-tested (scripts/test-segment-dirty-tracker.mjs).
 *
 * Sync: encoded-segment.ts (segment window semantics),
 *       partial-rebake-coordinator.ts (consumes the dirty windows),
 *       subtitle-overlay-renderer.ts glow/fade envelope (the padding below
 *       must cover every pixel a cue can influence outside [start,end])
 */

export interface DirtyCueLike {
  start: number;
  end: number;
  text: string;
}

export interface DirtyWindow {
  startSeconds: number;
  endSeconds: number;
}

export interface SegmentWindowLike {
  index: number;
  startSeconds: number;
  durationSeconds: number;
}

export interface CueDiffInput {
  before: readonly DirtyCueLike[];
  after: readonly DirtyCueLike[];
  /** Style config changed — every painted pixel may differ (global dirty). */
  styleChanged?: boolean;
}

export interface DirtySegmentsResult {
  /** True when the whole timeline must re-composite (style change). */
  allDirty: boolean;
  /** Merged, padded dirty time windows (empty when nothing changed). */
  windows: DirtyWindow[];
  /** Indices of segments overlapped by any dirty window. */
  dirtySegmentIndices: number[];
}

/**
 * A cue influences pixels beyond its [start,end]: glow tails outlast the cue
 * (the fidelity harness probes +0.3 s past cue end) and entrance effects lead
 * it. Dirty windows are padded symmetrically by this envelope so a re-bake
 * can never leave a stale glow frame behind.
 */
export const DIRTY_WINDOW_PADDING_SECONDS = 0.35;

/** Windows closer than this merge — re-encoding a tiny gap is pure overhead. */
export const DIRTY_WINDOW_MERGE_GAP_SECONDS = 0.5;

function cueContentKey(cue: DirtyCueLike): string {
  return `${cue.start.toFixed(4)}·${cue.end.toFixed(4)}·${cue.text}`;
}

/** Merge overlapping/near-adjacent windows (input need not be sorted). */
export function mergeDirtyWindows(
  windows: readonly DirtyWindow[],
  mergeGapSeconds: number = DIRTY_WINDOW_MERGE_GAP_SECONDS,
): DirtyWindow[] {
  const sorted = [...windows].sort((a, b) => a.startSeconds - b.startSeconds);
  const merged: DirtyWindow[] = [];
  for (const window of sorted) {
    const last = merged[merged.length - 1];
    if (last && window.startSeconds <= last.endSeconds + mergeGapSeconds) {
      last.endSeconds = Math.max(last.endSeconds, window.endSeconds);
    } else {
      merged.push({ ...window });
    }
  }
  return merged;
}

/**
 * Symmetric multiset difference of the two cue lists → padded, merged dirty
 * windows. A cue present in only one side (added, removed, or the old/new half
 * of an edit) contributes its padded span. Unchanged cues contribute nothing.
 */
export function diffCueWindows(
  before: readonly DirtyCueLike[],
  after: readonly DirtyCueLike[],
  durationSeconds: number,
  paddingSeconds: number = DIRTY_WINDOW_PADDING_SECONDS,
): DirtyWindow[] {
  const counts = new Map<string, { cue: DirtyCueLike; count: number }>();
  for (const cue of before) {
    const key = cueContentKey(cue);
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { cue, count: 1 });
  }
  for (const cue of after) {
    const key = cueContentKey(cue);
    const entry = counts.get(key);
    if (entry) entry.count -= 1;
    else counts.set(key, { cue, count: -1 });
  }

  const windows: DirtyWindow[] = [];
  for (const { cue, count } of counts.values()) {
    if (count === 0) continue; // present in both — unchanged
    windows.push({
      startSeconds: Math.max(0, cue.start - paddingSeconds),
      endSeconds: Math.min(durationSeconds, cue.end + paddingSeconds),
    });
  }
  return mergeDirtyWindows(windows);
}

/**
 * Segments overlapped by any window — half-open span semantics matching
 * computeSegmentCueSpan (a window ending exactly at a segment start does not
 * dirty that segment).
 */
export function mapWindowsToSegments(
  windows: readonly DirtyWindow[],
  segments: readonly SegmentWindowLike[],
): number[] {
  const dirty: number[] = [];
  for (const segment of segments) {
    const segStart = segment.startSeconds;
    const segEnd = segment.startSeconds + segment.durationSeconds;
    const overlaps = windows.some(
      (window) => window.startSeconds < segEnd && window.endSeconds > segStart,
    );
    if (overlaps) dirty.push(segment.index);
  }
  return dirty;
}

/** The full pipeline: diff → windows → segment indices (+ global-dirty gate). */
export function computeDirtySegments(
  input: CueDiffInput,
  segments: readonly SegmentWindowLike[],
  durationSeconds: number,
): DirtySegmentsResult {
  if (input.styleChanged) {
    // Honest global invalidation: style fields feed every painted pixel.
    return {
      allDirty: true,
      windows: [{ startSeconds: 0, endSeconds: durationSeconds }],
      dirtySegmentIndices: segments.map((segment) => segment.index),
    };
  }
  const windows = diffCueWindows(input.before, input.after, durationSeconds);
  return {
    allDirty: false,
    windows,
    dirtySegmentIndices: mapWindowsToSegments(windows, segments),
  };
}
