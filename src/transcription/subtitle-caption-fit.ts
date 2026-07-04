/**
 * Two-tier caption fit evaluation — heuristic pre-filter + real-canvas authority (Phase 1).
 */

import { measureCueRenderedSize } from '@/src/transcription/subtitle-overlay-renderer';
import type { CueFitStatus } from '@/src/transcription/subtitle-cue-measurement';
import type { SubtitleStyleConfig } from '@/src/transcription/types';
import {
  heuristicNeedsRealCanvasMeasure,
  heuristicSkipsRealCanvasMeasure,
  PREVIEW_CANVAS_HEIGHT,
  PREVIEW_CANVAS_WIDTH,
  smartSplitCaptionMaxWidth,
  type MeasureWidth,
} from '@/src/utils/text-metrics';

export const CAPTION_FIT_DEBOUNCE_MS = 200;

export interface CaptionMetricsContext {
  measure: MeasureWidth;
  maxWidth: number;
  fontSize: number;
}

export type CueFitSource = 'heuristic' | 'canvas';

export interface CueFitEvaluation {
  overflows: boolean;
  fitStatus: CueFitStatus;
  overflowPx: number;
  heuristicWidth: number;
  renderedWidthPx?: number;
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
  return {
    measure,
    maxWidth: smartSplitCaptionMaxWidth(PREVIEW_CANVAS_WIDTH, fontSize),
    fontSize,
  };
}

export function evaluateCueFitHeuristic(
  text: string,
  metrics: CaptionMetricsContext,
): CueFitEvaluation {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      overflows: false,
      fitStatus: 'comfortable',
      overflowPx: 0,
      heuristicWidth: 0,
      source: 'heuristic',
    };
  }
  const heuristicWidth = metrics.measure(trimmed);
  const overflows = heuristicWidth > metrics.maxWidth;
  const overflowPx = heuristicWidth - metrics.maxWidth;
  let fitStatus: CueFitStatus = 'comfortable';
  if (overflows) {
    fitStatus = 'overflow';
  } else if (heuristicWidth > metrics.maxWidth * 0.85) {
    fitStatus = 'marginal';
  }
  return {
    overflows,
    fitStatus,
    overflowPx,
    heuristicWidth,
    source: 'heuristic',
  };
}

export function cueFitNeedsCanvasMeasure(
  text: string,
  metrics: CaptionMetricsContext,
): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const width = metrics.measure(trimmed);
  if (heuristicSkipsRealCanvasMeasure(width, metrics.maxWidth)) return false;
  return heuristicNeedsRealCanvasMeasure(width, metrics.maxWidth);
}

export async function evaluateCueFitCanvas(
  text: string,
  style: SubtitleStyleConfig,
  metrics: CaptionMetricsContext,
  themeBarColor?: string,
): Promise<CueFitEvaluation> {
  const trimmed = text.trim();
  if (!trimmed) {
    return evaluateCueFitHeuristic(text, metrics);
  }
  const heuristic = evaluateCueFitHeuristic(text, metrics);
  const canvas = await measureCueRenderedSize({
    text: trimmed,
    style,
    width: PREVIEW_CANVAS_WIDTH,
    height: PREVIEW_CANVAS_HEIGHT,
    maxWidthPx: metrics.maxWidth,
    themeBarColor,
    timestampSeconds: 0,
  });
  return {
    overflows: canvas.overflows,
    fitStatus: canvas.fitStatus,
    overflowPx: canvas.overflowPx,
    heuristicWidth: heuristic.heuristicWidth,
    renderedWidthPx: canvas.renderedWidthPx,
    frameClipped: canvas.frameClipped,
    source: 'canvas',
  };
}

/** Heuristic first; real-canvas when in the marginal band or heuristic overflow. */
export async function resolveCueFit(
  text: string,
  style: SubtitleStyleConfig,
  metrics: CaptionMetricsContext,
  options?: { forceCanvas?: boolean; themeBarColor?: string },
): Promise<CueFitEvaluation> {
  const heuristic = evaluateCueFitHeuristic(text, metrics);
  if (!options?.forceCanvas && !cueFitNeedsCanvasMeasure(text, metrics)) {
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
    const px = Math.max(1, Math.round(Math.abs(evaluation.overflowPx)));
    return `Overflows (+${px}px)`;
  }
  const px = Math.max(1, Math.round(Math.abs(evaluation.overflowPx)));
  return `Marginal (+${px}px)`;
}