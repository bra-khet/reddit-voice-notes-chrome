/**
 * Per-cue manual-edit detection for Smart Adjust Full Re-Splice (Phase 1).
 * WHY: sessionTranscriptIsDirty() is transcript-wide; re-splice needs per-cue
 *      "preserve hand edits" vs "reset" without a new persisted schema field.
 */

import { stripScaffoldPlaceholder } from '@/src/transcription/transcript-editing';
import type { TranscriptResult, TranscriptSegment } from '@/src/transcription/types';

export interface CueEditClassification {
  index: number;
  segment: TranscriptSegment;
  manuallyEdited: boolean;
  /** Overlapping original segment when one exists; null for new/out-of-range cues. */
  matchedOriginal: TranscriptSegment | null;
}

/** Normalize cue text for verbatim diff (scaffold placeholders + whitespace). */
export function normalizeCueTextForDiff(text: string): string {
  return stripScaffoldPlaceholder(text).replace(/\s+/g, ' ').trim();
}

function segmentOverlapSeconds(
  a: Pick<TranscriptSegment, 'start' | 'end'>,
  b: Pick<TranscriptSegment, 'start' | 'end'>,
): number {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return Math.max(0, end - start);
}

/**
 * Original cue with maximum time overlap — tie-break by smallest start delta.
 */
export function findOverlappingOriginalSegment(
  editedSegment: TranscriptSegment,
  originalSegments: TranscriptSegment[],
): TranscriptSegment | null {
  let best: TranscriptSegment | null = null;
  let bestOverlap = 0;
  let bestStartDelta = Number.POSITIVE_INFINITY;

  for (const candidate of originalSegments) {
    const overlap = segmentOverlapSeconds(editedSegment, candidate);
    if (overlap <= 0) continue;
    const startDelta = Math.abs(candidate.start - editedSegment.start);
    if (
      overlap > bestOverlap ||
      (overlap === bestOverlap && startDelta < bestStartDelta)
    ) {
      best = candidate;
      bestOverlap = overlap;
      bestStartDelta = startDelta;
    }
  }

  return best;
}

export function isCueManuallyEdited(
  editedSegment: TranscriptSegment,
  originalSegments: TranscriptSegment[],
): boolean {
  const matched = findOverlappingOriginalSegment(editedSegment, originalSegments);
  if (!matched) return true;
  return (
    normalizeCueTextForDiff(editedSegment.text) !== normalizeCueTextForDiff(matched.text)
  );
}

export function classifyEditedCueSegments(
  edited: TranscriptResult,
  original: TranscriptResult,
): CueEditClassification[] {
  const originalSegments = original.segments;
  return edited.segments.map((segment, index) => {
    const matchedOriginal = findOverlappingOriginalSegment(segment, originalSegments);
    const manuallyEdited = matchedOriginal
      ? normalizeCueTextForDiff(segment.text) !== normalizeCueTextForDiff(matchedOriginal.text)
      : true;
    return { index, segment, manuallyEdited, matchedOriginal };
  });
}

export function countManuallyEditedCues(
  edited: TranscriptResult,
  original: TranscriptResult,
): number {
  return classifyEditedCueSegments(edited, original).filter((row) => row.manuallyEdited).length;
}