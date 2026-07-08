/**
 * v5.7.0 — Partial re-bake SPLICE plan (Phase 2b; docs/v5.6.0-audio-decoupling.md
 * §4.2, the follow-up branch feature/5.7.0-partial-rebake-splice).
 *
 * The pure, construction-level guarantee layer between the intent planner
 * (partial-rebake-coordinator.ts, which snaps dirty windows to an ASSUMED 2 s
 * keyframe grid) and the browser splice executor (Phase 2b, composite-splice.ts).
 * The executor cannot cut anywhere it likes: an H.264/VP9 delta frame references
 * earlier frames in its GOP, so a splice may only replace WHOLE GOPs, cutting on
 * the artifact's REAL keyframe boundaries — which need not coincide with the
 * planner's grid. This module reads those real boundaries (as frame indices) and
 * turns grid spans into keyframe-bounded, frame-exact, gap-free splice regions,
 * then validates them. If the real GOP layout can't support an economical
 * splice, it says so and the caller falls back to a full composite (honest —
 * this is the v5.3.9.1 lesson: never claim composite-ready output without a
 * construction-level guarantee).
 *
 * SPLICE VALIDITY (why the aligned regions are bitstream-safe by construction):
 *   - A re-encode region is expanded to [Kₐ, K_b): Kₐ = the keyframe starting
 *     the GOP that contains the first dirty frame; K_b = the keyframe starting
 *     the first fully-clean GOP after the last dirty frame (or EOS = frameCount).
 *   - The executor FORCES a keyframe at Kₐ when re-encoding, so the region
 *     references only frames within itself.
 *   - The kept run that resumes at K_b begins on a real keyframe, so it decodes
 *     independently of the replaced frames.
 *   - Re-encoding repaints the same PTS grid, so a region's frame count is
 *     unchanged ⇒ total output packet count is preserved (the cheapest lie gate).
 *
 * Pure logic — no DOM, no WebCodecs, no mediabunny. Node-tested
 * (scripts/test-splice-plan.mjs). Frame-native: fps only enters output
 * validation (duration drift). Leaf module.
 *
 * Sync: partial-rebake-coordinator.ts (produces the grid SpliceSpans + the
 *       PARTIAL_REBAKE_MAX_COVERAGE threshold this reuses),
 *       composite-splice.ts (Phase 2b executor — honors the force-keyframe and
 *       frame-count contracts above),
 *       composite-plan.ts (validateCompositeOutput is the drift-check pattern
 *       mirrored in validateSpliceOutput),
 *       timeline.ts (frame math; keyframe frame indices are global frame indices)
 */

import { PARTIAL_REBAKE_MAX_COVERAGE } from './partial-rebake-coordinator';

// ---------------------------------------------------------------------------
// Chronos stages (v5.3.9.1 rule: distinct work never shares a stage string).
// Distinct from partial-rebake-plan (telemetry) and the browser-composite-*
// stages (full composite) — splice execution is its own semantic work.
// ---------------------------------------------------------------------------

export const PARTIAL_SPLICE_STAGES = {
  /** Demux the existing artifact, read packet types, locate real keyframes. */
  scan: 'partial-splice-scan',
  /** Decode → repaint (new cues) → re-encode only the dirty GOP regions. */
  reencode: 'partial-splice-reencode',
  /** Interleave kept + re-encoded packets into the output MP4, then finalize. */
  assemble: 'partial-splice-assemble',
} as const;

export type PartialSpliceStage =
  (typeof PARTIAL_SPLICE_STAGES)[keyof typeof PARTIAL_SPLICE_STAGES];

// ---------------------------------------------------------------------------
// Region model
// ---------------------------------------------------------------------------

/**
 * A contiguous run of frames in the output, either copied bit-exact from the
 * existing artifact ('keep') or decoded/repainted/re-encoded ('reencode').
 * Half-open [startFrame, endFrame) in global frame indices.
 */
export interface SpliceRegion {
  kind: 'keep' | 'reencode';
  startFrame: number;
  endFrame: number;
}

export type SpliceStrategy = 'partial' | 'full';

export interface SplicePlan {
  strategy: SpliceStrategy;
  /**
   * Contiguous, alternating regions covering [0, frameCount) exactly once.
   * Empty when strategy === 'full' (mirrors planPartialRebake's spans: []).
   */
  regions: SpliceRegion[];
  reencodeFrameCount: number;
  keepFrameCount: number;
  /** Number of 'reencode' regions (independent GOP islands to re-paint). */
  reencodeRegionCount: number;
  /** reencodeFrameCount / frameCount ∈ [0,1] — honest cost of the splice. */
  coverageRatio: number;
  reason: string;
}

export interface SplicePlanInput {
  /** Grid-snapped dirty spans from planPartialRebake (frame-native). */
  spans: readonly { startFrame: number; frameCount: number }[];
  /**
   * Real keyframe frame indices in the EXISTING artifact, ascending & unique,
   * MUST start at 0 (a valid video's first packet is a keyframe). Derived by
   * the executor from EncodedPacket.type === 'key' via timeToFrame.
   */
  keyframeFrames: readonly number[];
  frameCount: number;
  /** Above this aligned coverage, a full composite is cheaper (defaults shared). */
  maxReencodeCoverage?: number;
}

interface FrameInterval {
  start: number;
  end: number;
}

function fullPlan(reason: string, coverageRatio = 1): SplicePlan {
  return {
    strategy: 'full',
    regions: [],
    reencodeFrameCount: 0,
    keepFrameCount: 0,
    reencodeRegionCount: 0,
    coverageRatio,
    reason,
  };
}

/** Largest keyframe frame index ≤ frame. keyframeFrames[0] === 0 guarantees one. */
export function alignFrameToKeyframeStart(
  frame: number,
  keyframeFrames: readonly number[],
): number {
  let aligned = keyframeFrames[0];
  for (const kf of keyframeFrames) {
    if (kf <= frame) aligned = kf;
    else break;
  }
  return aligned;
}

/**
 * Smallest keyframe frame index ≥ frame; frameCount (EOS) when the frame lies
 * in the final GOP. This is the start of the first fully-clean GOP after a
 * dirty region — where a kept run may safely resume.
 */
export function alignFrameToKeyframeEnd(
  frame: number,
  keyframeFrames: readonly number[],
  frameCount: number,
): number {
  for (const kf of keyframeFrames) {
    if (kf >= frame) return kf;
  }
  return frameCount;
}

function keyframesAreWellFormed(
  keyframeFrames: readonly number[],
  frameCount: number,
): boolean {
  if (keyframeFrames.length === 0) return false;
  if (keyframeFrames[0] !== 0) return false;
  for (let i = 0; i < keyframeFrames.length; i += 1) {
    const kf = keyframeFrames[i];
    if (!Number.isInteger(kf) || kf < 0 || kf >= frameCount) return false;
    if (i > 0 && kf <= keyframeFrames[i - 1]) return false; // strictly ascending
  }
  return true;
}

/** Normalize spans → clamped, sorted, merged half-open frame intervals. */
function normalizeSpans(
  spans: readonly { startFrame: number; frameCount: number }[],
  frameCount: number,
): FrameInterval[] {
  const usable: FrameInterval[] = [];
  for (const span of spans) {
    const start = Math.max(0, Math.floor(span.startFrame));
    const end = Math.min(frameCount, start + Math.max(0, Math.floor(span.frameCount)));
    if (end > start) usable.push({ start, end });
  }
  usable.sort((a, b) => a.start - b.start);
  const merged: FrameInterval[] = [];
  for (const interval of usable) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

/**
 * Turn grid-snapped dirty spans into keyframe-bounded splice regions. Pure and
 * deterministic. Returns strategy 'full' (with empty regions) whenever a
 * construction-level splice can't be justified: bad timeline, malformed
 * keyframe layout, or aligned coverage past the break-even threshold.
 */
export function planSplice(input: SplicePlanInput): SplicePlan {
  const {
    spans,
    keyframeFrames,
    frameCount,
    maxReencodeCoverage = PARTIAL_REBAKE_MAX_COVERAGE,
  } = input;

  if (!Number.isFinite(frameCount) || frameCount <= 0) {
    return fullPlan('Invalid frame count — full composite is the only safe answer.');
  }
  if (!keyframesAreWellFormed(keyframeFrames, frameCount)) {
    return fullPlan(
      'Artifact keyframe layout is unreadable or does not start at frame 0 — ' +
        'not splice-friendly; full composite.',
    );
  }

  const dirty = normalizeSpans(spans, frameCount);
  if (dirty.length === 0) {
    return fullPlan('No dirty spans to splice.', 0);
  }

  // Expand each dirty interval outward to its enclosing GOP boundaries.
  const reencodeIntervals: FrameInterval[] = dirty.map((interval) => ({
    start: alignFrameToKeyframeStart(interval.start, keyframeFrames),
    end: alignFrameToKeyframeEnd(interval.end, keyframeFrames, frameCount),
  }));

  // Merge reencode intervals that now overlap or touch (a zero-length keep run
  // between two reencode regions is invalid — fold them together).
  reencodeIntervals.sort((a, b) => a.start - b.start);
  const mergedReencode: FrameInterval[] = [];
  for (const interval of reencodeIntervals) {
    const last = mergedReencode[mergedReencode.length - 1];
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
    } else {
      mergedReencode.push({ ...interval });
    }
  }

  // Walk the timeline emitting alternating keep/reencode regions.
  const regions: SpliceRegion[] = [];
  let cursor = 0;
  for (const interval of mergedReencode) {
    if (interval.start > cursor) {
      regions.push({ kind: 'keep', startFrame: cursor, endFrame: interval.start });
    }
    regions.push({ kind: 'reencode', startFrame: interval.start, endFrame: interval.end });
    cursor = interval.end;
  }
  if (cursor < frameCount) {
    regions.push({ kind: 'keep', startFrame: cursor, endFrame: frameCount });
  }

  const reencodeFrameCount = mergedReencode.reduce(
    (sum, interval) => sum + (interval.end - interval.start),
    0,
  );
  const keepFrameCount = frameCount - reencodeFrameCount;
  const coverageRatio = reencodeFrameCount / frameCount;

  if (coverageRatio > maxReencodeCoverage) {
    return fullPlan(
      `Keyframe-aligned re-encode covers ${(coverageRatio * 100).toFixed(0)}% of the ` +
        `timeline (> ${(maxReencodeCoverage * 100).toFixed(0)}%) — full composite is cheaper.`,
      coverageRatio,
    );
  }

  return {
    strategy: 'partial',
    regions,
    reencodeFrameCount,
    keepFrameCount,
    reencodeRegionCount: mergedReencode.length,
    coverageRatio,
    reason:
      `${mergedReencode.length} keyframe-aligned re-encode region(s), ` +
      `${reencodeFrameCount}/${frameCount} frames (${(coverageRatio * 100).toFixed(0)}%).`,
  };
}

/**
 * Construction-level check on a region list before the executor runs: contiguous
 * cover of [0, frameCount), alternating kinds, and every cut on a real keyframe.
 * Returns a human reason on failure (caller falls back to full), null when safe.
 */
export function validateSplicePlan(
  regions: readonly SpliceRegion[],
  frameCount: number,
  keyframeFrames: readonly number[],
): string | null {
  if (regions.length === 0) return 'Splice plan has no regions.';
  if (regions[0].startFrame !== 0) return 'First region does not start at frame 0.';
  if (regions[regions.length - 1].endFrame !== frameCount) {
    return `Last region ends at ${regions[regions.length - 1].endFrame}, expected ${frameCount}.`;
  }

  const keyframeSet = new Set(keyframeFrames);
  for (let i = 0; i < regions.length; i += 1) {
    const region = regions[i];
    if (region.endFrame <= region.startFrame) {
      return `Region ${i} is empty or inverted ([${region.startFrame}, ${region.endFrame})).`;
    }
    if (i > 0) {
      if (regions[i - 1].endFrame !== region.startFrame) {
        return `Gap/overlap between region ${i - 1} and ${i}.`;
      }
      if (regions[i - 1].kind === region.kind) {
        return `Adjacent regions ${i - 1} and ${i} share kind '${region.kind}' (unmerged).`;
      }
    }
    // Every cut point (a region start > 0) must be a real keyframe so the run
    // beginning there decodes independently of anything before it.
    if (region.startFrame > 0 && !keyframeSet.has(region.startFrame)) {
      return `Region ${i} starts at frame ${region.startFrame}, which is not a keyframe.`;
    }
    // A reencode region must also END on a keyframe (next GOP) or at EOS.
    if (
      region.kind === 'reencode' &&
      region.endFrame !== frameCount &&
      !keyframeSet.has(region.endFrame)
    ) {
      return `Reencode region ${i} ends at frame ${region.endFrame}, which is not a keyframe.`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Honest progress model (real counters only, mirroring voice-reapply-plan.ts)
// ---------------------------------------------------------------------------

const SCAN_BAND_END = 0.05;
const REENCODE_BAND_END = 0.85;

export function spliceStageBand(stage: PartialSpliceStage): { start: number; end: number } {
  switch (stage) {
    case PARTIAL_SPLICE_STAGES.scan:
      return { start: 0, end: SCAN_BAND_END };
    case PARTIAL_SPLICE_STAGES.reencode:
      return { start: SCAN_BAND_END, end: REENCODE_BAND_END };
    case PARTIAL_SPLICE_STAGES.assemble:
      return { start: REENCODE_BAND_END, end: 1 };
  }
}

/** Map a stage-local ratio into the pipeline's overall [0,1] space (clamped). */
export function computeSpliceProgress(stage: PartialSpliceStage, stageRatio: number): number {
  const band = spliceStageBand(stage);
  const clamped = Math.min(1, Math.max(0, stageRatio));
  return band.start + clamped * (band.end - band.start);
}

/** Re-encode leg ratio from the real repainted-frame counter (clamped). */
export function computeSpliceReencodeRatio(
  framesReencoded: number,
  totalReencodeFrames: number,
): number {
  if (!(totalReencodeFrames > 0)) return 0;
  return Math.min(1, Math.max(0, framesReencoded) / totalReencodeFrames);
}

/** Assemble leg ratio from the real muxed-packet counter (clamped). */
export function computeSpliceAssembleRatio(
  packetsMuxed: number,
  totalOutputPackets: number,
): number {
  if (!(totalOutputPackets > 0)) return 0;
  return Math.min(1, Math.max(0, packetsMuxed) / totalOutputPackets);
}

// ---------------------------------------------------------------------------
// Output validation (the "partial never lies" gate)
// ---------------------------------------------------------------------------

export interface SpliceOutputCheckInput {
  /** Packets copied bit-exact from the existing artifact. */
  keptPackets: number;
  /** Packets emitted by the re-encoder for the dirty regions. */
  reencodedPackets: number;
  /** Total video packets written to the output track. */
  outputVideoPackets: number;
  /** Video packet count of the EXISTING artifact (from computePacketStats). */
  expectedVideoPackets: number;
  /** Output vs. existing-artifact duration, and fps for the ≤1-frame tolerance. */
  outputDurationSeconds: number;
  baseDurationSeconds: number;
  fps: number;
}

/**
 * Post-assemble sanity gate. A splice REPLACES frames, never adds or drops them,
 * so the output must carry exactly the artifact's original packet count and
 * duration (within one frame). Any failure ⇒ do NOT adopt the artifact; the
 * caller falls back to a full composite. Mirrors validateCompositeOutput.
 */
export function validateSpliceOutput(input: SpliceOutputCheckInput): string | null {
  if (input.keptPackets + input.reencodedPackets !== input.outputVideoPackets) {
    return (
      `Kept ${input.keptPackets} + re-encoded ${input.reencodedPackets} packets ` +
      `≠ ${input.outputVideoPackets} written.`
    );
  }
  if (input.outputVideoPackets !== input.expectedVideoPackets) {
    return (
      `Spliced output has ${input.outputVideoPackets} video packets but the ` +
      `artifact had ${input.expectedVideoPackets} — a splice must preserve frame count.`
    );
  }
  const framePeriod = input.fps > 0 ? 1 / input.fps : 0;
  const drift = Math.abs(input.outputDurationSeconds - input.baseDurationSeconds);
  if (framePeriod > 0 && drift > framePeriod + 1e-6) {
    return (
      `Output duration ${input.outputDurationSeconds.toFixed(3)}s drifts ` +
      `${drift.toFixed(3)}s from the artifact ${input.baseDurationSeconds.toFixed(3)}s ` +
      `(> 1 frame @ ${input.fps}fps).`
    );
  }
  return null;
}
