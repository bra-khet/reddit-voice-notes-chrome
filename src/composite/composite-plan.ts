/**
 * v5.5.0 — Browser composite plan helpers (pure logic, no DOM, no WebCodecs).
 *
 * The deterministic core of the browser-side full composite (ADR-0003 /
 * docs/v5.5.0-browser-composite-migration.md): codec/bitrate constants, the
 * honest progress model, output validation, and the fidelity-harness anchor
 * timestamps. Everything here is Node-testable
 * (scripts/test-browser-composite-plan.mjs) — the browser-only orchestration
 * lives in browser-composite.ts.
 *
 * Sync: browser-composite.ts (consumer), browser-composite-support.ts (probe
 *       uses the candidate/bitrate constants), subtitle-canvas-bake.ts
 *       (stage labels), subtitle-bake.ts canvasStageMessage (stage copy)
 */

/**
 * Output video codec candidates in preference order (mediabunny codec ids).
 * AVC first: it is what the legacy x264 composite produced (Reddit-proven MP4
 * contract) and the most uniformly hardware-accelerated VideoEncoder codec.
 * VP9-in-MP4 is the fallback where AVC encode is unavailable.
 */
export const BROWSER_COMPOSITE_VIDEO_CODEC_CANDIDATES = ['avc', 'vp9'] as const;
export type BrowserCompositeVideoCodec =
  (typeof BROWSER_COMPOSITE_VIDEO_CODEC_CANDIDATES)[number];

/**
 * Composite output video bitrate. Pinned at the overlay path's proven
 * OVERLAY_VIDEO_BPS figure — and, decisively, under the ceiling imposed by
 * the 30 MB rvnLastBakedMp4 store cap (R13): saveLastBakedMp4 SILENTLY drops
 * larger blobs, so at the 2:00 recording cap total bitrate must stay below
 * ~2.0 Mbps. 1.5 Mbps video + 128 kbps AAC ≈ 24.5 MB worst case.
 */
export const BROWSER_COMPOSITE_VIDEO_BPS = 1_500_000;

/** Keyframe cadence for the composite output (seconds). Matches web-video norms. */
export const BROWSER_COMPOSITE_KEYFRAME_INTERVAL_SECONDS = 2;

/** rvnLastBakedMp4 hard cap — mirrored from last-baked-mp4-db.ts MAX_BYTES. */
export const BAKED_MP4_MAX_BYTES = 30 * 1024 * 1024;

/** Assumed audio bitrate for the size guard (transcode uses AAC 128k). */
const SIZE_GUARD_AUDIO_BPS = 128_000;
/** Container / mux overhead allowance for the size guard. */
const SIZE_GUARD_OVERHEAD_RATIO = 1.05;

/**
 * Pre-encode size guard (R13): estimated output bytes at the pinned bitrates.
 * A true (over-cap) result should surface an honest warning before encoding —
 * the store would silently drop the artifact after all the work.
 */
export function estimateCompositeOutputBytes(durationSeconds: number): number {
  const safeDuration = Math.max(0, durationSeconds);
  const payloadBits = (BROWSER_COMPOSITE_VIDEO_BPS + SIZE_GUARD_AUDIO_BPS) * safeDuration;
  return Math.round((payloadBits / 8) * SIZE_GUARD_OVERHEAD_RATIO);
}

export function compositeOutputMayExceedStoreCap(durationSeconds: number): boolean {
  return estimateCompositeOutputBytes(durationSeconds) > BAKED_MP4_MAX_BYTES;
}

// ---------------------------------------------------------------------------
// Honest progress model (R8)
// ---------------------------------------------------------------------------

/**
 * Chronos stage labels — distinct semantic stages per the v5.3.9.1 rule
 * (distinct work never shares a stage string) and ADR-0003's honesty
 * requirement. No creep timers exist on this path: every ratio below derives
 * from a real counter.
 */
export const BROWSER_COMPOSITE_STAGES = {
  /** Demux, track resolution, probe, decoder/encoder/muxer setup (discrete ticks). */
  decode: 'browser-composite-decode',
  /**
   * Per-frame pipeline: decoded sample consumed → painter blend → submitted to
   * the encoder. Includes decode wait by construction (a frame cannot blend
   * before it decodes) — documented attribution, not hidden cost.
   */
  paint: 'browser-composite-paint',
  /** Encoder output packets (trails paint; owns the post-loop flush). */
  encode: 'browser-composite-encode',
  /** Muxer finalize (in-memory moov write; discrete before/after ticks). */
  mux: 'browser-composite-mux',
} as const;

export type BrowserCompositeStage =
  (typeof BROWSER_COMPOSITE_STAGES)[keyof typeof BROWSER_COMPOSITE_STAGES];

/**
 * Combined loop ratio from the two real work counters. Monotonic under
 * monotonic inputs; both counters weigh equally because every frame must be
 * both composited (painted+submitted) and encoded (packet emitted) exactly
 * once. Clamped so a stats-vs-stream frame-count mismatch can never push the
 * meter past 1 or backwards.
 */
export function computeBrowserCompositeProgress(
  framesComposited: number,
  packetsEncoded: number,
  totalFrames: number,
): number {
  if (!Number.isFinite(totalFrames) || totalFrames <= 0) return 0;
  const done = Math.max(0, framesComposited) + Math.max(0, packetsEncoded);
  return Math.min(1, done / (2 * totalFrames));
}

// ---------------------------------------------------------------------------
// Output validation (R10)
// ---------------------------------------------------------------------------

export interface CompositeOutputCheckInput {
  /** Frames actually composited + encoded. */
  framesComposited: number;
  packetsEncoded: number;
  /** Frame count expected from the base track's packet stats. */
  expectedFrames: number;
  /** Base video duration (seconds) and output fps for the ≤1-frame tolerance. */
  baseDurationSeconds: number;
  outputDurationSeconds: number;
  fps: number;
}

/**
 * Post-mux sanity gate: every failure here means the artifact must NOT be
 * adopted (the caller falls back to the legacy pipeline). Duration tolerance
 * is one frame period, per ADR-0003's verification strategy.
 */
export function validateCompositeOutput(input: CompositeOutputCheckInput): string | null {
  if (input.framesComposited !== input.expectedFrames) {
    return (
      `Composited ${input.framesComposited} frames but the base track has ` +
      `${input.expectedFrames}.`
    );
  }
  if (input.packetsEncoded !== input.expectedFrames) {
    return (
      `Encoder emitted ${input.packetsEncoded} packets for ` +
      `${input.expectedFrames} frames.`
    );
  }
  const framePeriod = input.fps > 0 ? 1 / input.fps : 0;
  const drift = Math.abs(input.outputDurationSeconds - input.baseDurationSeconds);
  if (framePeriod > 0 && drift > framePeriod + 1e-6) {
    return (
      `Output duration ${input.outputDurationSeconds.toFixed(3)}s drifts ` +
      `${drift.toFixed(3)}s from base ${input.baseDurationSeconds.toFixed(3)}s ` +
      `(> 1 frame @ ${input.fps}fps).`
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fidelity harness anchors (R9)
// ---------------------------------------------------------------------------

export interface CompositeFidelityCueLike {
  start: number;
  end: number;
}

/** Cap on probe points so a 200-cue clip still yields a reviewable set. */
export const COMPOSITE_FIDELITY_MAX_TIMESTAMPS = 48;

/** Glow tails outlast the cue window; probe shortly after cue end (seconds). */
export const COMPOSITE_FIDELITY_GLOW_TAIL_OFFSET_SECONDS = 0.3;

function snapToFrame(timeSeconds: number, fps: number): number {
  return Math.round(timeSeconds * fps) / fps;
}

/**
 * Deterministic, frame-aligned output timestamps at which the fidelity harness
 * extracts frames from BOTH composite paths' final MP4s (identical indices by
 * construction — the ADR-0003 comparison contract). Anchors: clip start/end,
 * every cue's first and last frame, cue midpoints, glow-tail probes past each
 * cue end. Downsampled evenly (always keeping clip start/end) when the cue set
 * would exceed the cap.
 */
export function selectCompositeFidelityTimestamps(
  cues: CompositeFidelityCueLike[],
  durationSeconds: number,
  fps: number,
): number[] {
  if (!(fps > 0) || !(durationSeconds > 0)) return [];
  const lastFrameTime = snapToFrame(
    Math.max(0, durationSeconds - 1 / fps),
    fps,
  );

  const anchors = new Set<number>([0, lastFrameTime]);
  for (const cue of cues) {
    const start = snapToFrame(cue.start, fps);
    const end = snapToFrame(cue.end, fps);
    const mid = snapToFrame((cue.start + cue.end) / 2, fps);
    const glowTail = snapToFrame(cue.end + COMPOSITE_FIDELITY_GLOW_TAIL_OFFSET_SECONDS, fps);
    for (const t of [start, end, mid, glowTail]) {
      if (t >= 0 && t <= lastFrameTime) anchors.add(t);
    }
  }

  const sorted = [...anchors].sort((a, b) => a - b);
  if (sorted.length <= COMPOSITE_FIDELITY_MAX_TIMESTAMPS) return sorted;

  // Even downsample, pinning first and last anchors.
  const picked: number[] = [];
  const step = (sorted.length - 1) / (COMPOSITE_FIDELITY_MAX_TIMESTAMPS - 1);
  for (let i = 0; i < COMPOSITE_FIDELITY_MAX_TIMESTAMPS; i += 1) {
    picked.push(sorted[Math.round(i * step)]);
  }
  return [...new Set(picked)];
}

// ---------------------------------------------------------------------------
// Audio passthrough timestamp rebasing (mediabunny muxer contract)
// ---------------------------------------------------------------------------

/**
 * Our transcode AAC track can expose encoder-priming packets with slightly
 * negative PTS (e.g. −11.4 ms). mediabunny's MP4 muxer rejects negative
 * timestamps on output; video frames already sit on a non-negative timeline.
 */
export function computeAudioPassthroughOffset(firstPacketTimestampSeconds: number): number {
  return firstPacketTimestampSeconds < 0 ? firstPacketTimestampSeconds : 0;
}

/** Shift audio PTS onto the muxer's non-negative timeline. */
export function rebaseAudioPassthroughTimestamp(
  timestampSeconds: number,
  offsetSeconds: number,
): number {
  return timestampSeconds - offsetSeconds;
}

/**
 * Priming-only packets whose entire span is still ≤ 0 after rebasing are not
 * presented (EncodedPacket contract) — skip them instead of muxing.
 */
export function shouldSkipAudioPassthroughPacket(
  rebasedTimestampSeconds: number,
  durationSeconds: number,
): boolean {
  return rebasedTimestampSeconds + durationSeconds <= 0;
}
