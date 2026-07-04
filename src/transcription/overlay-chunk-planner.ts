/**
 * v5.3.9 — Overlay chunk planner (pure logic, no DOM).
 *
 * Splits the bake timeline into frame-aligned chunks so multiple wall-clock-paced
 * MediaRecorder captures can run concurrently (see subtitle-overlay-parallel.ts).
 * Chunk boundaries prefer cue gaps: MediaRecorder capture has ±1-frame duration
 * jitter per chunk, which is invisible when nothing is on screen at the seam but
 * would flicker mid-cue. Falls back to mid-cue slicing when a long cue spans the
 * whole search window (paint is a deterministic function of the global timestamp,
 * so a mid-cue seam is still content-continuous — only jitter-sensitive).
 *
 * Sync: subtitle-overlay-renderer.ts timeRange (global frame indexing),
 *       subtitle-overlay-parallel.ts (consumer), scripts/test-chunk-planner.mjs
 */

import type { CueOverlayCacheStats } from '@/src/transcription/subtitle-overlay-cue-cache';

/** Below this clip length a 2-way split saves too little to justify concat overhead. */
export const PARALLEL_OVERLAY_MIN_CLIP_SECONDS = 20;

/** Chunks shorter than this waste their MediaRecorder warmup/flush overhead. */
export const PARALLEL_OVERLAY_MIN_CHUNK_SECONDS = 8;

/** Aim near this chunk length; concurrency ≈ duration / target, capped below. */
export const PARALLEL_OVERLAY_TARGET_CHUNK_SECONDS = 15;

/**
 * Hard concurrency cap. Each chunk owns a canvas + MediaRecorder (native encoder
 * thread) + an ImageBitmap cue cache — 4 keeps worst-case transient memory and
 * per-tick main-thread paint load safe on typical 4–8 core hardware.
 */
export const PARALLEL_OVERLAY_MAX_CHUNKS = 4;

/** How far (seconds) a boundary may move from its ideal position to find a cue gap. */
export const PARALLEL_OVERLAY_BOUNDARY_SEARCH_SECONDS = 5;

/** Stagger between chunk capture starts — spreads cold-cache paint misses across ticks. */
export const PARALLEL_OVERLAY_STAGGER_MS = 150;

/** navigator.deviceMemory below this disables parallel capture entirely. */
export const PARALLEL_OVERLAY_MIN_DEVICE_MEMORY_GB = 4;

/** Timestamp epsilon for "is this frame time strictly inside a cue" checks. */
const CUE_GAP_EPSILON_SECONDS = 1e-4;

export interface OverlayCueLike {
  start: number;
  end: number;
}

export type OverlayChunkCutQuality = 'clip-start' | 'cue-gap' | 'mid-cue';

export interface PlannedOverlayChunk {
  index: number;
  /** Global frame index of the first frame in this chunk (inclusive). */
  startFrame: number;
  /** Number of frames this chunk captures. */
  frameCount: number;
  /** startFrame / fps — global seconds. */
  startSeconds: number;
  /** frameCount / fps — exact trim duration for the concat step. */
  durationSeconds: number;
  isFinal: boolean;
  /** Quality of the boundary this chunk STARTS at (diagnostics + tests). */
  cutQuality: OverlayChunkCutQuality;
}

export interface ResolveParallelChunkCountInput {
  durationSeconds: number;
  /** navigator.hardwareConcurrency at the call site. */
  hardwareConcurrency?: number;
  /** navigator.deviceMemory (GB) when available. */
  deviceMemoryGb?: number;
  /** Caller override (Overlay Lab / options.maxChunks). */
  maxChunks?: number;
}

/**
 * How many concurrent chunk captures to attempt. Returns 1 for "stay serial".
 * Heuristic: one paced capture per ~15 s of clip, capped by cores-1, the hard
 * cap, and a minimum-chunk-length floor; short clips and low-memory devices
 * stay serial.
 */
export function resolveParallelChunkCount(input: ResolveParallelChunkCountInput): number {
  const { durationSeconds } = input;
  if (!Number.isFinite(durationSeconds) || durationSeconds < PARALLEL_OVERLAY_MIN_CLIP_SECONDS) {
    return 1;
  }
  if (
    input.deviceMemoryGb != null &&
    input.deviceMemoryGb < PARALLEL_OVERLAY_MIN_DEVICE_MEMORY_GB
  ) {
    return 1;
  }

  const coreCap = Math.max(1, (input.hardwareConcurrency ?? 4) - 1);
  const durationCap = Math.floor(durationSeconds / PARALLEL_OVERLAY_MIN_CHUNK_SECONDS);
  const target = Math.max(2, Math.round(durationSeconds / PARALLEL_OVERLAY_TARGET_CHUNK_SECONDS));
  const cap = Math.min(input.maxChunks ?? PARALLEL_OVERLAY_MAX_CHUNKS, coreCap, durationCap);
  return Math.max(1, Math.min(cap, target));
}

/**
 * Per-chunk cue cache budget. The serial cap (64) times N chunks would multiply
 * worst-case ImageBitmap memory by N; instead each chunk gets a slice with a floor
 * of one full animated phase cycle (24 buckets) so hue-rotate styles still hit.
 * Sync: subtitle-overlay-cue-cache.ts CUE_OVERLAY_CACHE_PHASE_BUCKETS / MAX_ENTRIES.
 */
export function parallelCueCacheMaxEntries(chunkCount: number): number {
  const SERIAL_CACHE_MAX = 64;
  const PHASE_CYCLE_FLOOR = 24;
  if (chunkCount <= 1) return SERIAL_CACHE_MAX;
  return Math.max(PHASE_CYCLE_FLOOR, Math.floor(SERIAL_CACHE_MAX / chunkCount));
}

function frameTimeIsInsideAnyCue(cues: OverlayCueLike[], timeSeconds: number): boolean {
  for (const cue of cues) {
    if (
      cue.start < timeSeconds - CUE_GAP_EPSILON_SECONDS &&
      cue.end > timeSeconds + CUE_GAP_EPSILON_SECONDS
    ) {
      return true;
    }
  }
  return false;
}

export interface PlanOverlayChunksInput {
  /** Normalized cues (prepareSegmentsForSubtitleBake output) — global times. */
  cues: OverlayCueLike[];
  durationSeconds: number;
  fps: number;
  /** From resolveParallelChunkCount. Plan may return fewer chunks, never more. */
  targetChunkCount: number;
  minChunkSeconds?: number;
  boundarySearchSeconds?: number;
}

/**
 * Frame-aligned chunk plan. Invariants (tested):
 * - Chunk frame ranges partition [0, ceil(duration*fps)) exactly — the parallel
 *   bake captures the same global frame set as the serial render.
 * - Boundaries prefer cue gaps within ±boundarySearchSeconds of the ideal
 *   equal-split position; otherwise they slice mid-cue at the ideal frame.
 * - Every chunk is at least minChunkSeconds long (plan shrinks to fewer chunks
 *   rather than violate the floor).
 */
export function planOverlayChunks(input: PlanOverlayChunksInput): PlannedOverlayChunk[] {
  const fps = Math.max(1, input.fps);
  const durationSeconds = Math.max(0, input.durationSeconds);
  const totalFrames = Math.max(1, Math.ceil(durationSeconds * fps));
  const minChunkFrames = Math.max(
    1,
    Math.round((input.minChunkSeconds ?? PARALLEL_OVERLAY_MIN_CHUNK_SECONDS) * fps),
  );
  const searchFrames = Math.max(
    0,
    Math.round((input.boundarySearchSeconds ?? PARALLEL_OVERLAY_BOUNDARY_SEARCH_SECONDS) * fps),
  );

  const chunkCount = Math.max(
    1,
    Math.min(input.targetChunkCount, Math.floor(totalFrames / minChunkFrames)),
  );

  const singleChunk: PlannedOverlayChunk[] = [
    {
      index: 0,
      startFrame: 0,
      frameCount: totalFrames,
      startSeconds: 0,
      durationSeconds: totalFrames / fps,
      isFinal: true,
      cutQuality: 'clip-start',
    },
  ];
  if (chunkCount < 2) return singleChunk;

  // Choose interior boundary frames left to right.
  const boundaries: { frame: number; quality: OverlayChunkCutQuality }[] = [];
  let previousBoundary = 0;

  for (let k = 1; k < chunkCount; k += 1) {
    const ideal = Math.round((totalFrames * k) / chunkCount);
    const remainingChunks = chunkCount - k;
    const lo = Math.max(previousBoundary + minChunkFrames, ideal - searchFrames);
    const hi = Math.min(totalFrames - minChunkFrames * remainingChunks, ideal + searchFrames);
    if (lo > hi) {
      // No room for this boundary — stop splitting; remaining frames form the last chunk.
      break;
    }

    // Walk outward from the ideal frame so the closest cue-gap frame wins.
    let chosen: number | null = null;
    const clampToWindow = (frame: number): number => Math.min(hi, Math.max(lo, frame));
    const idealClamped = clampToWindow(ideal);
    const maxOffset = Math.max(idealClamped - lo, hi - idealClamped);
    for (let offset = 0; offset <= maxOffset; offset += 1) {
      const candidates = offset === 0 ? [idealClamped] : [idealClamped - offset, idealClamped + offset];
      for (const frame of candidates) {
        if (frame < lo || frame > hi) continue;
        if (!frameTimeIsInsideAnyCue(input.cues, frame / fps)) {
          chosen = frame;
          break;
        }
      }
      if (chosen != null) break;
    }

    if (chosen != null) {
      boundaries.push({ frame: chosen, quality: 'cue-gap' });
      previousBoundary = chosen;
    } else {
      boundaries.push({ frame: idealClamped, quality: 'mid-cue' });
      previousBoundary = idealClamped;
    }
  }

  if (boundaries.length === 0) return singleChunk;

  const chunks: PlannedOverlayChunk[] = [];
  let cursor = 0;
  let startQuality: OverlayChunkCutQuality = 'clip-start';
  for (const boundary of boundaries) {
    chunks.push({
      index: chunks.length,
      startFrame: cursor,
      frameCount: boundary.frame - cursor,
      startSeconds: cursor / fps,
      durationSeconds: (boundary.frame - cursor) / fps,
      isFinal: false,
      cutQuality: startQuality,
    });
    cursor = boundary.frame;
    startQuality = boundary.quality;
  }
  chunks.push({
    index: chunks.length,
    startFrame: cursor,
    frameCount: totalFrames - cursor,
    startSeconds: cursor / fps,
    durationSeconds: (totalFrames - cursor) / fps,
    isFinal: true,
    cutQuality: startQuality,
  });

  return chunks;
}

/**
 * Aggregate per-chunk frame progress into a single serial-equivalent progress
 * event (chunks run concurrently; ratio = frames painted anywhere / all frames).
 */
export function aggregateChunkProgress(
  framesDonePerChunk: number[],
  totalFrames: number,
): { frameIndex: number; totalFrames: number; ratio: number } {
  let done = 0;
  for (const frames of framesDonePerChunk) done += frames;
  const clamped = Math.min(done, totalFrames);
  return {
    frameIndex: clamped,
    totalFrames,
    ratio: totalFrames > 0 ? clamped / totalFrames : 0,
  };
}

/** Merge per-chunk cue cache stats into one summary for metrics/timing logs. */
export function mergeCueCacheStats(stats: CueOverlayCacheStats[]): CueOverlayCacheStats {
  const merged: CueOverlayCacheStats = {
    enabled: stats.some((s) => s.enabled),
    phaseBuckets: stats[0]?.phaseBuckets ?? 0,
    maxEntries: stats[0]?.maxEntries ?? 0,
    hits: 0,
    misses: 0,
    lookups: 0,
    creates: 0,
    evictions: 0,
    uniqueKeys: 0,
    hitRate: 0,
  };
  for (const s of stats) {
    merged.hits += s.hits;
    merged.misses += s.misses;
    merged.lookups += s.lookups;
    merged.creates += s.creates;
    merged.evictions += s.evictions;
    merged.uniqueKeys += s.uniqueKeys;
    merged.maxEntries = Math.max(merged.maxEntries, s.maxEntries);
  }
  merged.hitRate = merged.lookups > 0 ? merged.hits / merged.lookups : 0;
  return merged;
}
