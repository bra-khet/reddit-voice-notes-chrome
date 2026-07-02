/**
 * Chronos helpers for subtitle bake progress (v5.3.4 Phase 5.1).
 * Pure formatters + ETA estimation from monotonic ratio — no DOM coupling.
 */

export interface BakeChronosSnapshot {
  elapsedMs: number;
  estimatedRemainingMs: number | null;
}

/** Format seconds as m:ss (floor — stable tick display). */
export function formatChronosSeconds(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Estimate remaining wall time from elapsed ms and a monotonic completion ratio.
 * Returns null when ratio is too small or nearly complete (ETA would flicker).
 */
export function estimateRemainingMs(elapsedMs: number, ratio: number): number | null {
  if (ratio < 0.03 || ratio >= 0.995 || elapsedMs < 500) {
    return null;
  }
  return Math.round((elapsedMs * (1 - ratio)) / ratio);
}

export function snapshotBakeChronos(startedAtMs: number, ratio: number): BakeChronosSnapshot {
  const elapsedMs = Math.max(0, Math.round(performance.now() - startedAtMs));
  return {
    elapsedMs,
    estimatedRemainingMs: estimateRemainingMs(elapsedMs, ratio),
  };
}

/** Human line under the progress meter, e.g. "0:12 elapsed · ~0:18 remaining". */
export function formatBakeChronosLine(snapshot: BakeChronosSnapshot): string {
  const elapsed = formatChronosSeconds(snapshot.elapsedMs / 1000);
  if (snapshot.estimatedRemainingMs == null) {
    return `${elapsed} elapsed`;
  }
  const remaining = formatChronosSeconds(snapshot.estimatedRemainingMs / 1000);
  return `${elapsed} elapsed · ~${remaining} remaining`;
}

/** UI-only smoothed ratio — monotonic, soft-steps toward target to avoid ETA cliffs. */
export interface BakeDisplayRatioState {
  value: number;
}

export function createBakeDisplayRatioState(): BakeDisplayRatioState {
  return { value: 0 };
}

/**
 * Advance display ratio toward target without instant jumps (Phase 5.1 polish).
 * Real bake ratio stays authoritative for status text; this is for bar + ETA only.
 */
export function advanceBakeDisplayRatio(
  state: BakeDisplayRatioState,
  targetRatio: number,
): number {
  const clampedTarget = Math.max(state.value, Math.min(0.995, targetRatio));
  if (clampedTarget <= state.value + 0.0001) {
    return state.value;
  }
  const gap = clampedTarget - state.value;
  const step = Math.min(gap, Math.max(0.025, gap * 0.42));
  state.value += step;
  return state.value;
}

/** Linear indeterminate creep for silent pipeline phases (e.g. alpha normalize). */
export function computeCreepRatio(
  startRatio: number,
  endRatio: number,
  elapsedMs: number,
  expectedMs: number,
): number {
  if (expectedMs <= 0) return endRatio;
  const t = Math.min(1, Math.max(0, elapsedMs / expectedMs));
  return startRatio + (endRatio - startRatio) * t;
}