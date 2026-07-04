/**
 * Overlay Lab timing log enrichment — stage breakdown + cache/render summaries (v5.3.5).
 */

import type { CueOverlayCacheStats } from '@/src/transcription/subtitle-overlay-cue-cache';
import type { SubtitleOverlayRenderMetrics } from '@/src/transcription/subtitle-overlay-renderer';

export const OVERLAY_LAB_TIMING_LOG_VERSION = 2;

export interface OverlayLabTimingEntryLike {
  stage: string;
  elapsedMs: number;
}

export interface OverlayLabStageDurations {
  renderMs: number | null;
  normalizeMs: number | null;
  bufferMs: number | null;
  compositeMs: number | null;
  postRenderMs: number | null;
}

export interface OverlayLabStageShare {
  render: number | null;
  normalize: number | null;
  buffer: number | null;
  composite: number | null;
  postRender: number | null;
}

export interface OverlayLabEffectSnapshot {
  textGradient: boolean;
  textGradientWave: boolean;
  glowEnabled: boolean;
  glowMode: string;
  glowColorSource: string;
  hueRotateMode: string;
  dualBorder: boolean;
  backdropBorderRadius: number;
}

export interface OverlayLabRenderConfig {
  width: number;
  height: number;
  fps: number;
  cueCacheEnabled: boolean;
  phaseBuckets: number;
  cacheMaxEntries: number;
}

export interface OverlayLabRenderSummary {
  wallMs: number;
  totalFrames: number;
  fps: number;
  msPerFrame: number;
  realtimeFactor: number;
}

export interface OverlayLabTimingSummary {
  totalMs: number;
  durationSeconds: number;
  cueCount: number;
  cuesPerSecond: number;
  avgCueDurationSeconds: number | null;
  totalRealtimeFactor: number;
  render: OverlayLabRenderSummary | null;
  stages: OverlayLabStageDurations;
  stageShare: OverlayLabStageShare;
  cueCache: CueOverlayCacheStats | null;
}

function stageBounds(entries: OverlayLabTimingEntryLike[]): {
  first: Record<string, number>;
  last: Record<string, number>;
} {
  const first: Record<string, number> = {};
  const last: Record<string, number> = {};
  for (const entry of entries) {
    if (first[entry.stage] === undefined) first[entry.stage] = entry.elapsedMs;
    last[entry.stage] = entry.elapsedMs;
  }
  return { first, last };
}

/** Derive stage wall times from chronos entries (bake + render actions). */
export function computeOverlayLabStageDurations(
  entries: OverlayLabTimingEntryLike[],
): OverlayLabStageDurations {
  const { first, last } = stageBounds(entries);

  const renderStart = first['canvas-overlay-render'] ?? first['render-start'] ?? 0;
  const renderEnd = last['canvas-overlay-render'] ?? last['render-complete'] ?? renderStart;

  const normStart = first['canvas-overlay-alpha-normalize'];
  const normEnd = last['canvas-overlay-alpha-normalize'];

  const bufStart = first['canvas-overlay-buffer'];
  const bufEnd = last['canvas-overlay-buffer'];

  const compStart = first['canvas-overlay-composite'] ?? first['burnin-start'];
  const compEnd = last['burnin-done'] ?? last['canvas-overlay-done'] ?? last['bake-complete'];

  const normalizeMs =
    normStart != null && normEnd != null ? Math.max(0, normEnd - normStart) : null;
  const bufferMs =
    bufStart != null && bufEnd != null ? Math.max(0, bufEnd - bufStart) : null;
  const compositeMs =
    compStart != null && compEnd != null ? Math.max(0, compEnd - compStart) : null;

  const postRenderAnchor = normEnd ?? renderEnd;
  const postRenderMs =
    compEnd != null ? Math.max(0, compEnd - postRenderAnchor) : null;

  return {
    renderMs: Math.max(0, renderEnd - renderStart),
    normalizeMs,
    bufferMs,
    compositeMs,
    postRenderMs,
  };
}

function share(part: number | null, total: number): number | null {
  if (part == null || total <= 0) return null;
  return part / total;
}

export function buildOverlayLabTimingSummary(input: {
  totalMs: number;
  durationSeconds: number;
  cueCount: number;
  entries: OverlayLabTimingEntryLike[];
  renderMetrics?: SubtitleOverlayRenderMetrics | null;
}): OverlayLabTimingSummary {
  const stages = computeOverlayLabStageDurations(input.entries);
  const renderMetrics = input.renderMetrics ?? null;
  const renderSummary: OverlayLabRenderSummary | null = renderMetrics
    ? {
        wallMs: renderMetrics.renderWallMs,
        totalFrames: renderMetrics.totalFrames,
        fps: renderMetrics.fps,
        msPerFrame: renderMetrics.msPerFrame,
        realtimeFactor: renderMetrics.realtimeFactor,
      }
    : stages.renderMs != null
      ? {
          wallMs: stages.renderMs,
          totalFrames: Math.max(1, Math.ceil(input.durationSeconds * 30)),
          fps: 30,
          msPerFrame:
            stages.renderMs /
            Math.max(1, Math.ceil(input.durationSeconds * 30)),
          realtimeFactor:
            input.durationSeconds > 0
              ? stages.renderMs / (input.durationSeconds * 1000)
              : 0,
        }
      : null;

  return {
    totalMs: input.totalMs,
    durationSeconds: input.durationSeconds,
    cueCount: input.cueCount,
    cuesPerSecond:
      input.durationSeconds > 0 ? input.cueCount / input.durationSeconds : 0,
    avgCueDurationSeconds:
      input.cueCount > 0 ? input.durationSeconds / input.cueCount : null,
    totalRealtimeFactor:
      input.durationSeconds > 0
        ? input.totalMs / (input.durationSeconds * 1000)
        : 0,
    render: renderSummary,
    stages,
    stageShare: {
      render: share(stages.renderMs, input.totalMs),
      normalize: share(stages.normalizeMs, input.totalMs),
      buffer: share(stages.bufferMs, input.totalMs),
      composite: share(stages.compositeMs, input.totalMs),
      postRender: share(stages.postRenderMs, input.totalMs),
    },
    cueCache: renderMetrics?.cueCache ?? null,
  };
}