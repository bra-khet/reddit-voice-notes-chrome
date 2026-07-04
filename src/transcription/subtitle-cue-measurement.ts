/**
 * Bake-accurate cue fit — backdrop plate vs frame edge (Phase 1 / v5.3.6 QA fix).
 * WHY: LONG badge must match baked output (640×360), not Smart Split ink budget (320 heuristic).
 * Sync: subtitle-overlay-renderer.ts BACKDROP_BOX_BORDER_W, FRAME_EDGE_INSET_PX
 */

import type { HeuristicMeasureTier } from '@/src/utils/text-metrics';
import { CANVAS_WIDTH } from '@/src/utils/constants';

export type CueFitStatus = 'comfortable' | 'marginal' | 'overflow';

/** Sync: subtitle-overlay-renderer.ts BACKDROP_BOX_BORDER_W */
export const CUE_BACKDROP_BOX_BORDER_W = 12;

/** Min inset before backdrop is treated as clipping the bake frame. */
export const BAKE_FRAME_SAFE_PADDING_PX = 4;

/** Min margin from frame edge for "comfortable" (still readable, not "needs fix"). */
export const BAKE_COMFORT_MARGIN_PX = 12;

export interface BackdropFrameFit {
  backdropLeft: number;
  backdropRight: number;
  backdropWidth: number;
  comfortMarginPx: number;
  overflows: boolean;
  overflowPx: number;
  fitStatus: CueFitStatus;
}

export interface CueRenderedSizeResult {
  backdropLeft: number;
  backdropRight: number;
  backdropWidth: number;
  comfortMarginPx: number;
  bakeWidth: number;
  /** True when backdrop plate crosses the safe frame inset — bake will clip. */
  overflows: boolean;
  overflowPx: number;
  frameClipped: boolean;
  fitStatus: CueFitStatus;
  lineCount: number;
}

/** Max ink width (px) before centered backdrop touches safe frame padding. */
export function bakeSafeInkMaxWidth(
  canvasWidth: number = CANVAS_WIDTH,
  backdropBorderW: number = CUE_BACKDROP_BOX_BORDER_W,
  safePadding: number = BAKE_FRAME_SAFE_PADDING_PX,
): number {
  return canvasWidth - 2 * safePadding - 2 * backdropBorderW;
}

export function estimateCenteredBackdropSpan(
  inkWidthPx: number,
  canvasWidth: number,
  backdropBorderW: number = CUE_BACKDROP_BOX_BORDER_W,
): { left: number; right: number; width: number } {
  const centerX = canvasWidth / 2;
  const halfInk = inkWidthPx / 2;
  const left = centerX - halfInk - backdropBorderW;
  const right = centerX + halfInk + backdropBorderW;
  return { left, right, width: right - left };
}

export function classifyBackdropFrameFit(
  backdropLeft: number,
  backdropRight: number,
  canvasWidth: number,
  safePaddingPx: number = BAKE_FRAME_SAFE_PADDING_PX,
  comfortMarginPx?: number,
): BackdropFrameFit {
  const margin =
    comfortMarginPx ?? Math.min(backdropLeft, canvasWidth - backdropRight);
  const leftViolation = safePaddingPx - backdropLeft;
  const rightViolation = backdropRight - (canvasWidth - safePaddingPx);
  const overflows = leftViolation > 0 || rightViolation > 0;
  const overflowPx = Math.max(0, leftViolation, rightViolation);
  let fitStatus: CueFitStatus = 'comfortable';
  if (overflows) {
    fitStatus = 'overflow';
  } else if (margin < BAKE_COMFORT_MARGIN_PX) {
    fitStatus = 'marginal';
  }
  return {
    backdropLeft,
    backdropRight,
    backdropWidth: backdropRight - backdropLeft,
    comfortMarginPx: margin,
    overflows,
    overflowPx,
    fitStatus,
  };
}

export function buildCueRenderedSizeResult(
  fit: BackdropFrameFit,
  canvasWidth: number = CANVAS_WIDTH,
  lineCount = 1,
): CueRenderedSizeResult {
  return {
    backdropLeft: fit.backdropLeft,
    backdropRight: fit.backdropRight,
    backdropWidth: fit.backdropWidth,
    comfortMarginPx: fit.comfortMarginPx,
    bakeWidth: canvasWidth,
    overflows: fit.overflows,
    overflowPx: fit.overflowPx,
    frameClipped: fit.overflows,
    fitStatus: fit.fitStatus,
    lineCount,
  };
}

/** Map heuristic tier to whether real-canvas measurement is required. */
export function heuristicTierNeedsRealCanvas(tier: HeuristicMeasureTier): boolean {
  return tier === 'marginal' || tier === 'overflow';
}