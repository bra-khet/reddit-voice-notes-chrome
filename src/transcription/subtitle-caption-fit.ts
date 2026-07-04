/**
 * Two-tier caption fit — bake-frame authority + Smart Split budget kept separate (Phase 1).
 */

import { measureCueRenderedSize } from '@/src/transcription/subtitle-overlay-renderer';
import type { CueFitStatus } from '@/src/transcription/subtitle-cue-measurement';
import {
  bakeSafeInkMaxWidth,
  BAKE_COMFORT_MARGIN_PX,
  classifyBackdropFrameFit,
  CUE_BACKDROP_BOX_BORDER_W,
  estimateCenteredBackdropSpan,
} from '@/src/transcription/subtitle-cue-measurement';
import type { SubtitleStyleConfig } from '@/src/transcription/types';
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '@/src/utils/constants';
import {
  classifyHeuristicMeasureTier,
  heuristicNeedsRealCanvasMeasure,
  heuristicSkipsRealCanvasMeasure,
  PREVIEW_CANVAS_WIDTH,
  smartSplitCaptionMaxWidth,
  type MeasureWidth,
} from '@/src/utils/text-metrics';

export const CAPTION_FIT_DEBOUNCE_MS = 200;

export interface CaptionMetricsContext {
  measure: MeasureWidth;
  /** Smart Split / word-shift budget only — NOT used for LONG badge. */
  splitBudget: number;
  fontSize: number;
  bakeWidth: number;
  bakeSafeInkMax: number;
}

export type CueFitSource = 'heuristic' | 'canvas';

export interface CueFitEvaluation {
  overflows: boolean;
  fitStatus: CueFitStatus;
  overflowPx: number;
  comfortMarginPx?: number;
  heuristicWidth: number;
  source: CueFitSource;
  frameClipped?: boolean;
}

export function buildCaptionMetricsContext(
  style: SubtitleStyleConfig | undefined,
  measure: MeasureWidth,
): CaptionMetricsContext {
  const fontSize =
    typeof style?.fontSize === 'number' && Number.isFinite(style.fontSize)
      ? style.fontSize
      : 22;
  const backdropEnabled = style?.backdrop?.enabled !== false;
  const backdropBorder = backdropEnabled ? CUE_BACKDROP_BOX_BORDER_W : 0;
  return {
    measure,
    splitBudget: smartSplitCaptionMaxWidth(PREVIEW_CANVAS_WIDTH, fontSize),
    fontSize,
    bakeWidth: CANVAS_WIDTH,
    bakeSafeInkMax: bakeSafeInkMaxWidth(CANVAS_WIDTH, backdropBorder),
  };
}

function evaluateBakeFitFromInkWidth(
  inkWidthPx: number,
  metrics: CaptionMetricsContext,
  backdropBorderW: number,
): CueFitEvaluation {
  const span = estimateCenteredBackdropSpan(inkWidthPx, metrics.bakeWidth, backdropBorderW);
  const fit = classifyBackdropFrameFit(span.left, span.right, metrics.bakeWidth);
  return {
    overflows: fit.overflows,
    fitStatus: fit.fitStatus,
    overflowPx: fit.overflowPx,
    comfortMarginPx: fit.comfortMarginPx,
    heuristicWidth: inkWidthPx,
    source: 'heuristic',
  };
}

/** LONG badge / Validate All — ink vs bake frame (640px), not Smart Split budget. */
export function evaluateCueBakeFitHeuristic(
  text: string,
  metrics: CaptionMetricsContext,
  style?: SubtitleStyleConfig,
): CueFitEvaluation {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      overflows: false,
      fitStatus: 'comfortable',
      overflowPx: 0,
      comfortMarginPx: metrics.bakeWidth,
      heuristicWidth: 0,
      source: 'heuristic',
    };
  }
  const inkWidth = metrics.measure(trimmed);
  const backdropBorder =
    style?.backdrop?.enabled === false ? 0 : CUE_BACKDROP_BOX_BORDER_W;
  return evaluateBakeFitFromInkWidth(inkWidth, metrics, backdropBorder);
}

export function cueFitNeedsCanvasMeasure(
  text: string,
  metrics: CaptionMetricsContext,
  style?: SubtitleStyleConfig,
): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const inkWidth = metrics.measure(trimmed);
  if (heuristicSkipsRealCanvasMeasure(inkWidth, metrics.bakeSafeInkMax)) return false;
  return heuristicNeedsRealCanvasMeasure(inkWidth, metrics.bakeSafeInkMax);
}

export async function evaluateCueFitCanvas(
  text: string,
  style: SubtitleStyleConfig,
  metrics: CaptionMetricsContext,
  themeBarColor?: string,
): Promise<CueFitEvaluation> {
  const trimmed = text.trim();
  if (!trimmed) {
    return evaluateCueBakeFitHeuristic(text, metrics, style);
  }
  const heuristic = evaluateCueBakeFitHeuristic(text, metrics, style);
  const canvas = await measureCueRenderedSize({
    text: trimmed,
    style,
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    themeBarColor,
    timestampSeconds: 0,
  });
  return {
    overflows: canvas.overflows,
    fitStatus: canvas.fitStatus,
    overflowPx: canvas.overflowPx,
    comfortMarginPx: canvas.comfortMarginPx,
    heuristicWidth: heuristic.heuristicWidth,
    frameClipped: canvas.frameClipped,
    source: 'canvas',
  };
}

/** Instant heuristic, then canvas (debounced caller). */
export async function resolveCueFit(
  text: string,
  style: SubtitleStyleConfig,
  metrics: CaptionMetricsContext,
  options?: { forceCanvas?: boolean; themeBarColor?: string },
): Promise<CueFitEvaluation> {
  const heuristic = evaluateCueBakeFitHeuristic(text, metrics, style);
  if (!options?.forceCanvas && !cueFitNeedsCanvasMeasure(text, metrics, style)) {
    return heuristic;
  }
  try {
    return await evaluateCueFitCanvas(text, style, metrics, options?.themeBarColor);
  } catch (error) {
    console.warn('[Reddit Voice Notes] Real-canvas cue measure failed; using heuristic', error);
    return heuristic;
  }
}

export function formatFitStatusLabel(evaluation: CueFitEvaluation): string {
  if (!evaluation.overflows && evaluation.fitStatus === 'comfortable') {
    return 'Fits comfortably';
  }
  if (evaluation.overflows) {
    const px = Math.max(1, Math.round(evaluation.overflowPx));
    return `Needs fix (+${px}px past edge)`;
  }
  const margin = evaluation.comfortMarginPx ?? 0;
  return `Near edge (${Math.max(0, Math.round(margin))}px margin)`;
}

/** Two-tier band against bake-safe ink width (for canvas gating). */
export function classifyInkMeasureTier(
  inkWidthPx: number,
  bakeSafeInkMax: number,
): ReturnType<typeof classifyHeuristicMeasureTier> {
  return classifyHeuristicMeasureTier(inkWidthPx, bakeSafeInkMax);
}

export { BAKE_COMFORT_MARGIN_PX };