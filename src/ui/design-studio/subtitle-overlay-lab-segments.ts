import type { TranscriptResult, TranscriptSegment } from '@/src/transcription/types';

/** Synthetic QA segment sets for the v5.3.4 Subtitle Overlay Lab (Phase 5.4). */
export type OverlayLabSegmentSetId = 'session' | 'short' | 'medium' | 'long';

export interface OverlayLabSegmentSetMeta {
  id: OverlayLabSegmentSetId;
  label: string;
  cueCount: number;
  durationSeconds: number;
}

export const OVERLAY_LAB_SEGMENT_SETS: OverlayLabSegmentSetMeta[] = [
  { id: 'session', label: 'Session transcript', cueCount: 0, durationSeconds: 0 },
  { id: 'short', label: 'Short — 3 cues · 10s', cueCount: 3, durationSeconds: 10 },
  { id: 'medium', label: 'Medium — 8 cues · 30s', cueCount: 8, durationSeconds: 30 },
  { id: 'long', label: 'Long — 16 cues · 60s', cueCount: 16, durationSeconds: 60 },
];

const SHORT_CUE_TEXTS = [
  'Hello from the overlay lab',
  'Short clip — three cues',
  'Glow + gradient QA',
];

const MEDIUM_CUE_TEXTS = [
  'Medium set — eight evenly spaced cues',
  'Halo diffusion check',
  'Dual contrasting border',
  'Text gradient with wave',
  'Rainbow hue rotate at 45°/s',
  'Backdrop plate rounding',
  'Drawtext vs canvas compare',
  'End of medium clip',
];

const LONG_CUE_TEXTS = [
  'Long set — sixteen cues over sixty seconds',
  'Stress test for render perf guard',
  'Multiple effects stacked together',
  'Short cue',
  'This is a deliberately longer caption to exercise per-cue glow clipping and backdrop bar width at the edges of the frame without VP8 bleed artifacts',
  'Cue six',
  'Cue seven',
  'Cue eight',
  'Cue nine',
  'Cue ten',
  'Cue eleven',
  'Cue twelve',
  'Cue thirteen',
  'Cue fourteen',
  'Cue fifteen',
  'Final cue — long clip end',
];

function buildEvenSegments(texts: readonly string[], durationSeconds: number): TranscriptSegment[] {
  const count = texts.length;
  if (count === 0) return [];
  const slot = durationSeconds / count;
  return texts.map((text, index) => ({
    start: Number((index * slot).toFixed(3)),
    end: Number((Math.min(durationSeconds, (index + 1) * slot - 0.05)).toFixed(3)),
    text,
  }));
}

export function buildOverlayLabSegments(setId: OverlayLabSegmentSetId): TranscriptSegment[] {
  switch (setId) {
    case 'short':
      return buildEvenSegments(SHORT_CUE_TEXTS, 10);
    case 'medium':
      return buildEvenSegments(MEDIUM_CUE_TEXTS, 30);
    case 'long':
      return buildEvenSegments(LONG_CUE_TEXTS, 60);
    default:
      return [];
  }
}

export function resolveOverlayLabTranscriptResult(
  setId: OverlayLabSegmentSetId,
  sessionEdited: TranscriptResult | null | undefined,
): TranscriptResult | null {
  if (setId === 'session') {
    if (!sessionEdited?.segments?.length) return null;
    return sessionEdited;
  }

  const segments = buildOverlayLabSegments(setId);
  const meta = OVERLAY_LAB_SEGMENT_SETS.find((entry) => entry.id === setId);
  const duration = meta?.durationSeconds ?? segments.at(-1)?.end ?? 10;
  return {
    text: segments.map((segment) => segment.text).join(' '),
    segments,
    source: 'manual',
    duration,
  };
}

export function overlayLabDurationSeconds(
  setId: OverlayLabSegmentSetId,
  edited: TranscriptResult | null,
): number {
  if (setId === 'session') {
    if (typeof edited?.duration === 'number' && edited.duration > 0) return edited.duration;
    const segments = edited?.segments ?? [];
    if (segments.length > 0) {
      const lastEnd = Math.max(...segments.map((segment) => segment.end));
      if (lastEnd > 0) return lastEnd;
    }
    return 10;
  }
  const meta = OVERLAY_LAB_SEGMENT_SETS.find((entry) => entry.id === setId);
  return meta?.durationSeconds ?? 10;
}