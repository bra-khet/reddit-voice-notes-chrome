/**
 * Smart Adjust proposal builders — Mode A (minimal fixes) + Mode B (re-splice).
 */

import {
  evaluateCueBakeFitHeuristic,
  type CaptionMetricsContext,
} from '@/src/transcription/subtitle-caption-fit';
import {
  classifyEditedCueSegments,
  countManuallyEditedCues,
} from '@/src/transcription/transcript-edit-diff';
import {
  splitSegmentIntoChunks,
  stripScaffoldPlaceholder,
} from '@/src/transcription/transcript-editing';
import { groupWordsByWidth } from '@/src/utils/text-metrics';
import type { TranscriptResult, TranscriptSegment } from '@/src/transcription/types';

export type SmartAdjustProposalKind =
  | 'shift-word-next'
  | 'shift-word-prev'
  | 'reduce-font-global'
  | 're-splice-preserve'
  | 're-splice-full';

export interface SmartAdjustProposal {
  id: string;
  kind: SmartAdjustProposalKind;
  title: string;
  description: string;
  cueIndex?: number;
  isGlobal?: boolean;
  /** Primary path for new users — full re-splice from Vosk original. */
  recommended?: boolean;
  /** Full segment list after applying this proposal to the modal draft. */
  segments: TranscriptSegment[];
  globalFontSize?: number;
}

function splitWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

function segmentTextFits(text: string, metrics: CaptionMetricsContext): boolean {
  return !evaluateCueBakeFitHeuristic(stripScaffoldPlaceholder(text), metrics).overflows;
}

function cloneSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  return segments.map((segment) => ({ ...segment }));
}

export function proposeShiftLastWordToNext(
  segments: TranscriptSegment[],
  cueIndex: number,
  metrics: CaptionMetricsContext,
): SmartAdjustProposal | null {
  const current = segments[cueIndex];
  const next = segments[cueIndex + 1];
  if (!current || !next) return null;

  const words = splitWords(stripScaffoldPlaceholder(current.text));
  if (words.length < 2) return null;
  const shiftedWord = words[words.length - 1];
  const currentText = words.slice(0, -1).join(' ');
  const nextText = `${shiftedWord} ${stripScaffoldPlaceholder(next.text)}`.trim();

  if (!segmentTextFits(currentText, metrics) || !segmentTextFits(nextText, metrics)) {
    return null;
  }

  const nextSegments = cloneSegments(segments);
  nextSegments[cueIndex] = { ...current, text: currentText };
  nextSegments[cueIndex + 1] = { ...next, text: nextText };

  return {
    id: `shift-next-${cueIndex}`,
    kind: 'shift-word-next',
    title: `Cue ${cueIndex + 1}: move “${shiftedWord}” to next cue`,
    description: 'Shifts one word to the following cue when both sides still fit.',
    cueIndex,
    segments: nextSegments,
  };
}

export function proposeShiftFirstWordToPrevious(
  segments: TranscriptSegment[],
  cueIndex: number,
  metrics: CaptionMetricsContext,
): SmartAdjustProposal | null {
  const current = segments[cueIndex];
  const prev = segments[cueIndex - 1];
  if (!current || !prev) return null;

  const words = splitWords(stripScaffoldPlaceholder(current.text));
  if (words.length < 2) return null;
  const shiftedWord = words[0];
  const currentText = words.slice(1).join(' ');
  const prevText = `${stripScaffoldPlaceholder(prev.text)} ${shiftedWord}`.trim();

  if (!segmentTextFits(currentText, metrics) || !segmentTextFits(prevText, metrics)) {
    return null;
  }

  const nextSegments = cloneSegments(segments);
  nextSegments[cueIndex - 1] = { ...prev, text: prevText };
  nextSegments[cueIndex] = { ...current, text: currentText };

  return {
    id: `shift-prev-${cueIndex}`,
    kind: 'shift-word-prev',
    title: `Cue ${cueIndex + 1}: move “${shiftedWord}” to previous cue`,
    description: 'Shifts one word to the prior cue when both sides still fit.',
    cueIndex,
    segments: nextSegments,
  };
}

export function proposeGlobalFontReduction(
  segments: TranscriptSegment[],
  currentFontSize: number,
  metrics: CaptionMetricsContext,
  minFontSize = 16,
): SmartAdjustProposal | null {
  const nextSize = currentFontSize - 1;
  if (nextSize < minFontSize) return null;

  const scale = nextSize / currentFontSize;
  const scaledMetrics: CaptionMetricsContext = {
    ...metrics,
    fontSize: nextSize,
    splitBudget: Math.round(metrics.splitBudget * scale),
    bakeSafeInkMax: Math.round(metrics.bakeSafeInkMax * scale),
    measure: (text: string) => metrics.measure(text) * scale,
  };

  const stillOverflow = segments.some((segment) => {
    const text = stripScaffoldPlaceholder(segment.text).trim();
    if (!text) return false;
    return evaluateCueBakeFitHeuristic(text, scaledMetrics).overflows;
  });
  if (stillOverflow) return null;

  return {
    id: `font-${nextSize}`,
    kind: 'reduce-font-global',
    title: `Reduce subtitle font to ${nextSize}px`,
    description:
      'Global style change — lowers font size by 1px so every cue fits at the relaxed width budget.',
    isGlobal: true,
    segments: cloneSegments(segments),
    globalFontSize: nextSize,
  };
}

function reSplitOriginalSegment(
  segment: TranscriptSegment,
  metrics: CaptionMetricsContext,
): TranscriptSegment[] {
  const text = stripScaffoldPlaceholder(segment.text).trim();
  if (!text) return [{ ...segment }];
  const chunks = groupWordsByWidth(text, metrics.splitBudget, metrics.measure);
  if (chunks.length <= 1) return [{ ...segment, text }];
  return splitSegmentIntoChunks({ ...segment, text }, chunks);
}

function segmentsOverlapTime(a: TranscriptSegment, b: TranscriptSegment): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Mode B — rebuild cue list from originalResult splits; optionally preserve hand-edited cues.
 */
export function buildReSpliceProposal(
  original: TranscriptResult,
  edited: TranscriptResult,
  metrics: CaptionMetricsContext,
  mode: 'preserve' | 'full',
): SmartAdjustProposal {
  const manualRows = classifyEditedCueSegments(edited, original);
  const preserved = mode === 'preserve'
    ? manualRows.filter((row) => row.manuallyEdited).map((row) => ({ ...row.segment }))
    : [];

  const reSplit: TranscriptSegment[] = [];
  for (const segment of original.segments) {
    reSplit.push(...reSplitOriginalSegment(segment, metrics));
  }

  let merged = reSplit;
  if (preserved.length > 0) {
    merged = [];
    const used = new Set<number>();
    for (const kept of preserved) {
      merged.push({ ...kept });
      reSplit.forEach((segment, index) => {
        if (segmentsOverlapTime(segment, kept)) used.add(index);
      });
    }
    reSplit.forEach((segment, index) => {
      if (!used.has(index)) merged.push({ ...segment });
    });
    merged.sort((a, b) => a.start - b.start || a.end - b.end);
  }

  const manualCount = countManuallyEditedCues(edited, original);
  const title =
    mode === 'preserve'
      ? 'Re-splice from original (preserve hand-edited cues)'
      : 'Full re-splice from original transcript';
  const description =
    mode === 'preserve'
      ? `Re-runs Smart Split on the Vosk baseline and keeps ${manualCount} hand-edited cue(s).`
      : 'Discards current split boundaries and rebuilds cues from the original transcript.';

  return {
    id: mode === 'preserve' ? 're-splice-preserve' : 're-splice-full',
    kind: mode === 'preserve' ? 're-splice-preserve' : 're-splice-full',
    title: mode === 'full' ? 'Auto-fix — re-splice from original' : title,
    description,
    segments: merged,
    recommended: mode === 'full',
  };
}

export function collectMinimalFixProposals(
  segments: TranscriptSegment[],
  overflowingIndices: number[],
  metrics: CaptionMetricsContext,
  currentFontSize: number,
): SmartAdjustProposal[] {
  const proposals: SmartAdjustProposal[] = [];
  const seen = new Set<string>();

  for (const index of overflowingIndices) {
    for (const builder of [
      () => proposeShiftLastWordToNext(segments, index, metrics),
      () => proposeShiftFirstWordToPrevious(segments, index, metrics),
    ]) {
      const proposal = builder();
      if (proposal && !seen.has(proposal.id)) {
        proposals.push(proposal);
        seen.add(proposal.id);
      }
    }
  }

  const fontProposal = proposeGlobalFontReduction(segments, currentFontSize, metrics);
  if (fontProposal && !seen.has(fontProposal.id)) {
    proposals.push(fontProposal);
    seen.add(fontProposal.id);
  }

  return proposals;
}

export function findOverflowingCueIndices(
  segments: TranscriptSegment[],
  metrics: CaptionMetricsContext,
): number[] {
  const indices: number[] = [];
  segments.forEach((segment, index) => {
    const text = stripScaffoldPlaceholder(segment.text).trim();
    if (!text) return;
    if (evaluateCueBakeFitHeuristic(text, metrics).overflows) {
      indices.push(index);
    }
  });
  return indices;
}