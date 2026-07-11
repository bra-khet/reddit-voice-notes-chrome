/**
 * v5.6.0 — Timeline primitives (docs/v5.6.0-audio-decoupling.md §4.3).
 *
 * First-class vocabulary for editing operations: a `Timeline` (duration + fps
 * + exact frame↔time mapping), `TimelineSegment` spans (from encoded overlay
 * segment metadata or synthesized uniformly), and frame-snapped `TrimRange`
 * validation. The frame↔time mapping uses the SAME serial expression as the
 * painter contract (`frame / fps` — see the overlay encoding backbone seam):
 * a timeline frame index here IS the global frame index there.
 *
 * Pure logic — no DOM, no WebCodecs, no storage. Node-tested
 * (scripts/test-timeline.mjs). Leaf module: type-only import from the
 * encoding layer.
 *
 * Sync: encoded-segment.ts (EncodedOverlaySegmentMeta → TimelineSegment),
 *       editing/segment-dirty-tracker.ts + editing/partial-rebake-coordinator.ts
 *       (consumers), editing/trim.ts (TrimRange validation),
 *       take-manager.ts TakeTrimEdit (the persisted form of a TrimRange)
 */

import type { EncodedOverlaySegmentMeta } from '@/src/encoding/encoded-segment';

export interface Timeline {
  durationSeconds: number;
  fps: number;
  /** Total whole frames — ceil so a partial trailing frame period still counts. */
  frameCount: number;
}

/** A contiguous frame span on a timeline (the editing unit). */
export interface TimelineSegment {
  index: number;
  /** Global frame index of the first frame (inclusive). */
  startFrame: number;
  frameCount: number;
  /** startFrame / fps — exact global seconds (painter contract). */
  startSeconds: number;
  /** frameCount / fps — exact span duration. */
  durationSeconds: number;
}

/** Frame-snapped in/out points (seconds); in < out guaranteed by clamp. */
export interface TrimRange {
  inSeconds: number;
  outSeconds: number;
}

export function createTimeline(durationSeconds: number, fps: number): Timeline {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error(`Timeline duration must be positive (got ${durationSeconds}).`);
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(`Timeline fps must be positive (got ${fps}).`);
  }
  return {
    durationSeconds,
    fps,
    frameCount: Math.ceil(durationSeconds * fps - 1e-6),
  };
}

/**
 * Time → containing frame index (floor — the frame being displayed at t).
 * The epsilon only absorbs float error from frame-PTS round trips
 * (frameToTime(n)·fps landing a few ulps under n) — it must stay far smaller
 * than any real sub-frame offset.
 */
export function timeToFrame(timeSeconds: number, fps: number): number {
  return Math.floor(timeSeconds * fps + 1e-9);
}

/** Frame index → its exact presentation time. THE global-PTS expression. */
export function frameToTime(frameIndex: number, fps: number): number {
  return frameIndex / fps;
}

/** Snap a time to its frame's exact PTS (floor semantics, clamped to ≥ 0). */
export function snapTimeToFrame(timeSeconds: number, fps: number): number {
  return frameToTime(Math.max(0, timeToFrame(timeSeconds, fps)), fps);
}

/**
 * Lift encoded overlay segment metadata into timeline segments. The encoding
 * backbone's frame bookkeeping is exact by construction, so this is a pure
 * re-projection — no re-derivation from the bitstream.
 */
export function segmentsFromEncodedMeta(
  metas: readonly EncodedOverlaySegmentMeta[],
): TimelineSegment[] {
  return metas.map((meta) => ({
    index: meta.index,
    startFrame: meta.startFrame,
    frameCount: meta.frameCount,
    startSeconds: meta.startSeconds,
    durationSeconds: meta.durationSeconds,
  }));
}

/**
 * Synthesize uniform segments over a timeline (e.g. keyframe-cadence spans for
 * artifacts that never went through the chunk planner). The final segment
 * absorbs the remainder so coverage is exact.
 */
export function uniformSegments(
  timeline: Timeline,
  targetSegmentSeconds: number,
): TimelineSegment[] {
  if (!Number.isFinite(targetSegmentSeconds) || targetSegmentSeconds <= 0) {
    throw new Error(`Segment length must be positive (got ${targetSegmentSeconds}).`);
  }
  const framesPerSegment = Math.max(1, Math.round(targetSegmentSeconds * timeline.fps));
  const segments: TimelineSegment[] = [];
  let startFrame = 0;
  while (startFrame < timeline.frameCount) {
    const remaining = timeline.frameCount - startFrame;
    // Absorb a short tail into the last segment instead of emitting a sliver.
    const frameCount =
      remaining < framesPerSegment * 2 ? remaining : framesPerSegment;
    segments.push({
      index: segments.length,
      startFrame,
      frameCount,
      startSeconds: frameToTime(startFrame, timeline.fps),
      durationSeconds: frameCount / timeline.fps,
    });
    startFrame += frameCount;
  }
  return segments;
}

/** Minimum surviving clip length after a trim — sub-second clips are unusable. */
export const TRIM_MIN_DURATION_SECONDS = 1;

/**
 * Clamp + frame-snap a requested trim range against a timeline. Returns null
 * when no valid range survives (inverted, out of bounds, or shorter than the
 * minimum). A full-span result (0 → duration) also returns null — trimming
 * nothing is not an edit.
 *
 * OUT at (or past) the clip end keeps the true duration — floor-snapping the
 * end of a non-frame-aligned clip would otherwise shave a partial frame and
 * turn a "keep everything" request into a silent micro-trim.
 */
export function clampTrimRange(
  range: { inSeconds: number; outSeconds: number },
  timeline: Timeline,
  minDurationSeconds: number = TRIM_MIN_DURATION_SECONDS,
): TrimRange | null {
  if (!Number.isFinite(range.inSeconds) || !Number.isFinite(range.outSeconds)) return null;

  const inSnapped = Math.max(0, snapTimeToFrame(range.inSeconds, timeline.fps));
  // BUG FIX: trim full-span / tail keep broken on fractional clip lengths
  // Fix: when the request reaches the clip end, preserve durationSeconds
  //      instead of floor-snapping below it (e.g. 13.529s @ 24fps → 13.5s).
  // Sync: subtitle-timeline-editor setTrimMode default OUT = clip duration;
  //       planTrim / applyTrimToCurrentTake use the same gate.
  const outAtClipEnd = range.outSeconds >= timeline.durationSeconds - 1e-6;
  const outSnapped = outAtClipEnd
    ? timeline.durationSeconds
    : Math.min(
        timeline.durationSeconds,
        Math.max(0, snapTimeToFrame(range.outSeconds, timeline.fps)),
      );

  if (outSnapped - inSnapped < minDurationSeconds - 1e-6) return null;
  if (inSnapped <= 1e-6 && outSnapped >= timeline.durationSeconds - 1e-6) return null;

  return { inSeconds: inSnapped, outSeconds: outSnapped };
}
