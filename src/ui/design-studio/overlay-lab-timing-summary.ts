/**
 * Overlay Lab timing log enrichment — stage breakdown + cache/render summaries (v5.3.5).
 */

import type { CueOverlayCacheStats } from '@/src/transcription/subtitle-overlay-cue-cache';
import { OVERLAY_CONCAT_STAGE } from '@/src/transcription/subtitle-overlay-parallel';
import { WEBCODECS_STITCH_STAGE } from '@/src/transcription/subtitle-overlay-webcodecs';
import type { SubtitleOverlayRenderMetrics } from '@/src/transcription/subtitle-overlay-renderer';
import {
  summarizeEncodedSegments,
  type EncodedSegmentSummary,
  type OverlayEncoderType,
} from '@/src/encoding/encoded-segment';

export const OVERLAY_LAB_TIMING_LOG_VERSION = 4;

/**
 * v5.5.0 — every stage the browser composite emits starts with this prefix
 * (browser-composite-decode/-paint/-encode/-mux + the -result detail entry).
 * Distinct field from compositeMs: that one measures the FFmpeg composite,
 * and the two must never share attribution (v5.3.9.1 rule / ADR-0003 R8).
 */
export const BROWSER_COMPOSITE_STAGE_PREFIX = 'browser-composite';

export interface OverlayLabTimingEntryLike {
  stage: string;
  elapsedMs: number;
}

export interface OverlayLabStageDurations {
  renderMs: number | null;
  /**
   * v5.3.9.1 — parallel-path stitch bracket (OVERLAY_CONCAT_STAGE), distinct
   * from normalizeMs. Before this fix both shared one stage label, which is
   * exactly how a 70-150s concat regression hid inside "normalizeMs".
   */
  concatMs: number | null;
  normalizeMs: number | null;
  bufferMs: number | null;
  compositeMs: number | null;
  /** v5.5.0 — in-page browser composite (ADR-0003); null on FFmpeg-composite bakes. */
  browserCompositeMs: number | null;
  postRenderMs: number | null;
}

export interface OverlayLabStageShare {
  render: number | null;
  concat: number | null;
  normalize: number | null;
  buffer: number | null;
  composite: number | null;
  browserComposite: number | null;
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
  /**
   * v5.3.10 — which capture/encode strategy the render used. 'mediarecorder'
   * runs are paced (render ≈ clip duration ÷ chunks); 'webcodecs' runs are
   * compute-bound (render = paint + encode, per-segment detail below).
   */
  encoderType: OverlayEncoderType | null;
  /** v5.3.10 — per-segment encode aggregates when the WebCodecs path ran. */
  encode: EncodedSegmentSummary | null;
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

  // v5.3.9.1: concat/stitch is its own stage now, distinct from normalize —
  // this is what used to hide a 70-150s regression inside "normalizeMs".
  const concatStart = first[OVERLAY_CONCAT_STAGE];
  const concatEnd = last[OVERLAY_CONCAT_STAGE];

  const normStart = first['canvas-overlay-alpha-normalize'];
  const normEnd = last['canvas-overlay-alpha-normalize'];

  const bufStart = first['canvas-overlay-buffer'];
  const bufEnd = last['canvas-overlay-buffer'];

  const compStart = first['canvas-overlay-composite'] ?? first['burnin-start'];
  const compEnd = last['burnin-done'] ?? last['canvas-overlay-done'] ?? last['bake-complete'];

  // v5.5.0 — browser composite owns its own bracket; never folded into
  // compositeMs (that field means "FFmpeg composite").
  let browserCompStart: number | null = null;
  let browserCompEnd: number | null = null;
  for (const [stage, elapsed] of Object.entries(first)) {
    if (!stage.startsWith(BROWSER_COMPOSITE_STAGE_PREFIX)) continue;
    if (browserCompStart == null || elapsed < browserCompStart) browserCompStart = elapsed;
  }
  for (const [stage, elapsed] of Object.entries(last)) {
    if (!stage.startsWith(BROWSER_COMPOSITE_STAGE_PREFIX)) continue;
    if (browserCompEnd == null || elapsed > browserCompEnd) browserCompEnd = elapsed;
  }

  const concatMs =
    concatStart != null && concatEnd != null ? Math.max(0, concatEnd - concatStart) : null;
  const normalizeMs =
    normStart != null && normEnd != null ? Math.max(0, normEnd - normStart) : null;
  const bufferMs =
    bufStart != null && bufEnd != null ? Math.max(0, bufEnd - bufStart) : null;
  const compositeMs =
    compStart != null && compEnd != null ? Math.max(0, compEnd - compStart) : null;
  const browserCompositeMs =
    browserCompStart != null && browserCompEnd != null
      ? Math.max(0, browserCompEnd - browserCompStart)
      : null;

  // v5.3.10: WebCodecs bakes have no normalize stage (composite-ready by
  // construction) — the stitch marker tick anchors post-render instead.
  const postRenderAnchor = normEnd ?? concatEnd ?? last[WEBCODECS_STITCH_STAGE] ?? renderEnd;
  const postRenderMs =
    compEnd != null ? Math.max(0, compEnd - postRenderAnchor) : null;

  return {
    renderMs: Math.max(0, renderEnd - renderStart),
    concatMs,
    normalizeMs,
    bufferMs,
    compositeMs,
    browserCompositeMs,
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
      concat: share(stages.concatMs, input.totalMs),
      normalize: share(stages.normalizeMs, input.totalMs),
      buffer: share(stages.bufferMs, input.totalMs),
      composite: share(stages.compositeMs, input.totalMs),
      browserComposite: share(stages.browserCompositeMs, input.totalMs),
      postRender: share(stages.postRenderMs, input.totalMs),
    },
    cueCache: renderMetrics?.cueCache ?? null,
    encoderType: renderMetrics ? renderMetrics.encoderType ?? 'mediarecorder' : null,
    encode: renderMetrics?.encodeSegments
      ? summarizeEncodedSegments(renderMetrics.encodeSegments)
      : null,
  };
}