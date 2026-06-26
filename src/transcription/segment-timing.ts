import type { TranscriptSegment } from '@/src/transcription/types';

/** Coerce cue seconds — invalid inputs become 0. */
export function normalizeSegmentSeconds(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

// BUG FIX: phantom OOB badge on the last cue from floored recording duration
// Fix: meta.durationSeconds is Math.floor'd to a whole second in
//      voice-recorder.ts (drops up to ~0.999s), while Vosk's final cue end keeps
//      sub-second precision — so a legit last cue read as OOB. Tolerance raised
//      0.25 → 1.25s = 1.0s floor-truncation budget + 0.25s genuine cue slack.
// Sync: voice-recorder.ts:300 (Math.floor on elapsedSeconds is the source of the
//       <1s truncation this absorbs). If that floor is ever made sub-second,
//       this can drop back toward 0.25.
const OOB_TOLERANCE_SECONDS = 1.25;

/** True when a cue end extends past the known clip length (burn-in will clip it). */
export function isSegmentEndOutOfBounds(end: number, clipDurationSeconds: number): boolean {
  if (!Number.isFinite(clipDurationSeconds) || clipDurationSeconds <= 0) return false;
  return normalizeSegmentSeconds(end) > clipDurationSeconds + OOB_TOLERANCE_SECONDS;
}

export function segmentHasOutOfBoundsEnd(
  segment: Pick<TranscriptSegment, 'end'>,
  clipDurationSeconds: number,
): boolean {
  return isSegmentEndOutOfBounds(segment.end, clipDurationSeconds);
}

export interface SegmentPlaybackWindow {
  start: number;
  end: number;
  /** End was clamped to clip duration for preview. */
  clamped: boolean;
}

/**
 * Resolve a playable [start, end) window for cue preview.
 * Returns null when the cue is entirely past the clip or has no positive duration.
 */
export function resolveSegmentPlaybackWindow(
  start: number,
  end: number,
  clipDurationSeconds: number | null | undefined,
): SegmentPlaybackWindow | null {
  const safeStart = normalizeSegmentSeconds(start);
  const safeEnd = normalizeSegmentSeconds(end);

  if (safeEnd <= safeStart) return null;

  const clipDuration =
    typeof clipDurationSeconds === 'number' && Number.isFinite(clipDurationSeconds) && clipDurationSeconds > 0
      ? clipDurationSeconds
      : null;

  if (clipDuration === null) {
    return { start: safeStart, end: safeEnd, clamped: false };
  }

  if (safeStart >= clipDuration) return null;

  const playableEnd = Math.min(safeEnd, clipDuration);
  if (playableEnd <= safeStart) return null;

  return {
    start: safeStart,
    end: playableEnd,
    clamped: safeEnd > clipDuration,
  };
}

/** Session recording length for OOB checks — recorder timer, not decode quirks. */
export function resolveClipDurationForOobCheck(
  metaDurationSeconds: number | null | undefined,
  decodedDurationSeconds?: number | null | undefined,
): number | null {
  const meta =
    typeof metaDurationSeconds === 'number' && Number.isFinite(metaDurationSeconds) && metaDurationSeconds > 0
      ? metaDurationSeconds
      : null;
  if (meta !== null) return meta;

  const decoded =
    typeof decodedDurationSeconds === 'number' &&
    Number.isFinite(decodedDurationSeconds) &&
    decodedDurationSeconds > 0
      ? decodedDurationSeconds
      : null;
  return decoded;
}

/** Best-known clip length for playback clamp — meta + decoded whichever is longer. */
export function resolveClipDurationSeconds(
  metaDurationSeconds: number | null | undefined,
  decodedDurationSeconds: number | null | undefined,
): number | null {
  const meta =
    typeof metaDurationSeconds === 'number' && Number.isFinite(metaDurationSeconds) && metaDurationSeconds > 0
      ? metaDurationSeconds
      : null;
  const decoded =
    typeof decodedDurationSeconds === 'number' &&
    Number.isFinite(decodedDurationSeconds) &&
    decodedDurationSeconds > 0
      ? decodedDurationSeconds
      : null;

  if (meta !== null && decoded !== null) {
    return Math.max(meta, decoded);
  }
  return meta ?? decoded;
}