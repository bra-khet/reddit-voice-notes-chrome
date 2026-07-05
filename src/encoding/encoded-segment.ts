/**
 * v5.3.10 — Encoded overlay segment model (pure logic, no DOM, no WebCodecs).
 *
 * The output of the encoding backbone is "a set of timed, self-describing
 * encoded segments + lightweight metadata", not "a finished video file".
 * The v5.3.9 chunk planner already partitions the timeline; this module makes
 * the segment mental model explicit so future editing features (selective
 * re-encode, frame-accurate operations, timeline-aware exports) can reason
 * about segments without re-deriving anything from the bitstream.
 *
 * Leaf module (type-only planner import) so scripts/test-encoded-segment.mjs
 * can bundle it for Node without pulling browser APIs.
 *
 * Sync: overlay-chunk-planner.ts (segment boundaries), ivf.ts (bitstream
 *       container), overlay-webcodecs-encoder.ts (producer),
 *       subtitle-overlay-webcodecs.ts (consumer/aggregator)
 */

import type { OverlayChunkCutQuality } from '@/src/transcription/overlay-chunk-planner';

/** Which capture/encode strategy produced an overlay stream. */
export type OverlayEncoderType = 'mediarecorder' | 'webcodecs';

/** Cues that overlap a segment's time window — the future selective-re-encode key. */
export interface OverlaySegmentCueSpan {
  /** Number of cues active at any point inside the segment window. */
  cueCount: number;
  /** Global start of the earliest overlapping cue (null when no cues overlap). */
  firstCueStartSeconds: number | null;
  /** Global end of the latest overlapping cue (null when no cues overlap). */
  lastCueEndSeconds: number | null;
}

/**
 * Self-describing metadata for one encoded overlay segment. Everything a
 * future editing feature needs to decide "can I keep this segment as-is, or
 * must I re-encode it?" without decoding the bitstream:
 * timing (startFrame/frameCount/fps are exact by construction), content
 * (cueSpan), provenance (encoderType/codec/cutQuality), and cost telemetry
 * (encodeMs/paintMs/bytes) for perf regressions.
 */
export interface EncodedOverlaySegmentMeta {
  index: number;
  /** Global frame index of the segment's first frame (inclusive). */
  startFrame: number;
  frameCount: number;
  fps: number;
  /** startFrame / fps — global seconds. */
  startSeconds: number;
  /** frameCount / fps — exact segment duration. */
  durationSeconds: number;
  /** Quality of the boundary this segment starts at (planner diagnostics). */
  cutQuality: OverlayChunkCutQuality;
  encoderType: OverlayEncoderType;
  /** WebCodecs codec string, e.g. 'vp8'. */
  codec: string;
  cueSpan: OverlaySegmentCueSpan;
  /** Wall time spent painting frames for this segment. */
  paintMs: number;
  /** Wall time from first frame submitted to encoder flush complete. */
  encodeMs: number;
  colorBytes: number;
  alphaBytes: number;
}

export interface EncodedSegmentSummary {
  segmentCount: number;
  totalFrames: number;
  totalColorBytes: number;
  totalAlphaBytes: number;
  totalPaintMs: number;
  /** Sum of per-segment encode walls — overlapping when segments run concurrently. */
  totalEncodeMs: number;
  maxEncodeMs: number;
}

interface CueLike {
  start: number;
  end: number;
}

/**
 * Cues overlapping [startFrame/fps, (startFrame+frameCount)/fps). Uses the
 * same half-open overlap semantics as the renderer's cuesAtTimestamp: a cue
 * ending exactly at the segment start does not overlap.
 */
export function computeSegmentCueSpan(
  cues: CueLike[],
  startFrame: number,
  frameCount: number,
  fps: number,
): OverlaySegmentCueSpan {
  const safeFps = Math.max(1, fps);
  const segStart = startFrame / safeFps;
  const segEnd = (startFrame + frameCount) / safeFps;

  let cueCount = 0;
  let first: number | null = null;
  let last: number | null = null;
  for (const cue of cues) {
    if (cue.start < segEnd && cue.end > segStart) {
      cueCount += 1;
      if (first === null || cue.start < first) first = cue.start;
      if (last === null || cue.end > last) last = cue.end;
    }
  }
  return { cueCount, firstCueStartSeconds: first, lastCueEndSeconds: last };
}

/** Aggregate per-segment telemetry for timing logs / Overlay Lab summaries. */
export function summarizeEncodedSegments(
  segments: EncodedOverlaySegmentMeta[],
): EncodedSegmentSummary {
  const summary: EncodedSegmentSummary = {
    segmentCount: segments.length,
    totalFrames: 0,
    totalColorBytes: 0,
    totalAlphaBytes: 0,
    totalPaintMs: 0,
    totalEncodeMs: 0,
    maxEncodeMs: 0,
  };
  for (const segment of segments) {
    summary.totalFrames += segment.frameCount;
    summary.totalColorBytes += segment.colorBytes;
    summary.totalAlphaBytes += segment.alphaBytes;
    summary.totalPaintMs += segment.paintMs;
    summary.totalEncodeMs += segment.encodeMs;
    summary.maxEncodeMs = Math.max(summary.maxEncodeMs, segment.encodeMs);
  }
  return summary;
}
