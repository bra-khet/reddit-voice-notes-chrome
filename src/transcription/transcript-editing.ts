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

/** Rebuild full transcript text from segment lines (single space join). */
export function rebuildTextFromSegments(segments: TranscriptSegment[]): string {
  return segments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

/** Keep aggregate text aligned with segment edits. */
export function normalizeEditedTranscriptResult(
  base: TranscriptResult,
  segments: TranscriptSegment[],
): TranscriptResult {
  const cleaned = sortSegmentsByStart(
    segments
      .map((segment) => ({
        start: normalizeCueSeconds(segment.start),
        end: normalizeCueSeconds(segment.end),
        text: segment.text.trim(),
      }))
      .filter((segment) => segment.text.length > 0),
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