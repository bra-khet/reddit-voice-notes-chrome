/**
 * Bake-accurate cue fit — backdrop plate vs frame edge (Phase 1 / v5.3.6 QA fix).
 * WHY: LONG badge must match baked output (640×360), not Smart Split ink budget (320 heuristic).
 * Sync: subtitle-overlay-renderer.ts BACKDROP_BOX_BORDER_W, FRAME_EDGE_INSET_PX
 */

import type { HeuristicMeasureTier } from '@/src/utils/text-metrics';
import { CANVAS_WIDTH } from '@/src/utils/constants';
import type { SubtitleStyleConfig } from '@/src/transcription/types';

export type CueFitStatus = 'comfortable' | 'marginal' | 'overflow';

/** Sync: subtitle-overlay-renderer.ts BACKDROP_BOX_BORDER_W */
export const CUE_BACKDROP_BOX_BORDER_W = 12;

/** Min inset before backdrop is treated as clipping the bake frame. */
export const BAKE_FRAME_SAFE_PADDING_PX = 4;

/** Min margin from frame edge for "comfortable" (still readable, not "needs fix"). */
export const BAKE_COMFORT_MARGIN_PX = 12;

/** Sync: subtitle-preview.ts drawSubtitlePreview block geometry. */
export const SUBTITLE_PREVIEW_MARGIN_FRACTION = 0.08;
export const SUBTITLE_PREVIEW_LINE_HEIGHT_FACTOR = 1.25;
export const SUBTITLE_PREVIEW_PADDING_Y = 10;

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

export function subtitlePreviewBlockTopY(
  position: SubtitleStyleConfig['position'],
  canvasHeight: number,
  blockHeight: number,
): number {
  const margin = Math.round(canvasHeight * SUBTITLE_PREVIEW_MARGIN_FRACTION);
  if (position === 'top') return margin;
  if (position === 'center') return Math.round((canvasHeight - blockHeight) / 2);
  return canvasHeight - blockHeight - margin;
}

export function subtitlePreviewSafeBandNormalized(
  position: SubtitleStyleConfig['position'],
  fontSize = 22,
  canvasHeight = 360,
  lineCount = 2,
): { start: number; end: number } {
  // CHANGED: expose the preview caption's vertical footprint as normalized layout guidance.
  // WHY: Background safe-text locking and the rendered caption must share one placement equation.
  const height = Math.max(1, canvasHeight);
  const lineHeight = Math.round(Math.max(1, fontSize) * SUBTITLE_PREVIEW_LINE_HEIGHT_FACTOR);
  const blockHeight = Math.min(
    height,
    Math.max(1, Math.round(lineCount)) * lineHeight + SUBTITLE_PREVIEW_PADDING_Y * 2,
  );
  const top = subtitlePreviewBlockTopY(position, height, blockHeight);
  return {
    start: Math.max(0, top / height),
    end: Math.min(1, (top + blockHeight) / height),
  };
}
