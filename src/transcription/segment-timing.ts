import type { TranscriptSegment } from '@/src/transcription/types';

/** Coerce cue seconds — invalid inputs become 0. */
export function normalizeSegmentSeconds(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** True when a cue end extends past the known clip length (burn-in will clip it). */
export function isSegmentEndOutOfBounds(end: number, clipDurationSeconds: number): boolean {
  if (!Number.isFinite(clipDurationSeconds) || clipDurationSeconds <= 0) return false;
  return normalizeSegmentSeconds(end) > clipDurationSeconds + 0.05;
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

/** Best-known clip length — prefer decoded audio, fall back to recording meta. */
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