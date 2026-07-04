/**
 * Pure cue fit classification for real-canvas measurement (Phase 1 / v5.3.6 refactor).
 * WHY: shared between subtitle-overlay-renderer measureCueRenderedSize and editor UI.
 */

import {
  SMART_SPLIT_HEURISTIC_COMFORT_RATIO,
  type HeuristicMeasureTier,
} from '@/src/utils/text-metrics';

export type CueFitStatus = 'comfortable' | 'marginal' | 'overflow';

export interface CueRenderedSizeResult {
  /** Painted horizontal extent (ink + glow bleed), px. */
  renderedWidthPx: number;
  /** Painted vertical extent (ink + glow bleed), px. */
  renderedHeightPx: number;
  /** Line count from wrap simulation — Phase 1 stays single-line (1). */
  lineCount: number;
  /** Budget compared against (smartSplitCaptionMaxWidth at measure time). */
  maxWidthPx: number;
  /** True when width exceeds budget or bleeds past frame rim. */
  overflows: boolean;
  /** Pixels over budget; negative when under. */
  overflowPx: number;
  /** Glow/stroke clipped by frame edge insets. */
  frameClipped: boolean;
  fitStatus: CueFitStatus;
}

export function classifyCueFitStatus(
  renderedWidthPx: number,
  maxWidthPx: number,
  overflows: boolean,
): CueFitStatus {
  if (overflows || renderedWidthPx > maxWidthPx) return 'overflow';
  if (renderedWidthPx <= maxWidthPx * SMART_SPLIT_HEURISTIC_COMFORT_RATIO) {
    return 'comfortable';
  }
  return 'marginal';
}

export function buildCueRenderedSizeResult(input: {
  renderedWidthPx: number;
  renderedHeightPx: number;
  maxWidthPx: number;
  frameClipped: boolean;
  lineCount?: number;
}): CueRenderedSizeResult {
  const lineCount = input.lineCount ?? 1;
  const overflows = input.renderedWidthPx > input.maxWidthPx || input.frameClipped;
  const overflowPx = input.renderedWidthPx - input.maxWidthPx;
  const fitStatus = classifyCueFitStatus(
    input.renderedWidthPx,
    input.maxWidthPx,
    overflows,
  );
  return {
    renderedWidthPx: input.renderedWidthPx,
    renderedHeightPx: input.renderedHeightPx,
    lineCount,
    maxWidthPx: input.maxWidthPx,
    overflows,
    overflowPx,
    frameClipped: input.frameClipped,
    fitStatus,
  };
}

/** Map heuristic tier to whether real-canvas measurement is required. */
export function heuristicTierNeedsRealCanvas(tier: HeuristicMeasureTier): boolean {
  return tier === 'marginal' || tier === 'overflow';
}