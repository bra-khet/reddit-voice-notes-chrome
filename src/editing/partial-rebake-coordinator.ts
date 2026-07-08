/**
 * v5.6.0 — Partial re-bake coordinator (docs/v5.6.0-audio-decoupling.md §4.2).
 *
 * PLAN NOW, SPLICE LATER. The pure planner turns dirty time windows into
 * keyframe-aligned splice spans and decides partial-vs-full honestly; the
 * orchestrator seam executes the FULL composite while emitting the partial
 * plan as telemetry. True packet-level splice execution is Phase 2b — landing
 * it without the fidelity-harness extension would repeat the v5.3.9.1 lesson
 * (never claim composite-ready output without construction-level guarantees).
 * Until then this module must never report a partial stage while doing full
 * work (chronos honesty, invariant I2) — the plan is telemetry, the execution
 * label stays 'full'.
 *
 * Pure planner is Node-tested (scripts/test-partial-rebake-plan.mjs).
 *
 * Sync: segment-dirty-tracker.ts (produces the windows),
 *       composite-plan.ts BROWSER_COMPOSITE_KEYFRAME_INTERVAL_SECONDS (the
 *       splice grid MUST match the encoder's keyframe cadence),
 *       timeline.ts (frame math), browser-composite.ts (the full executor)
 */

import { BROWSER_COMPOSITE_KEYFRAME_INTERVAL_SECONDS } from '@/src/composite/composite-plan';
import { frameToTime, timeToFrame } from '@/src/timeline/timeline';
import type { DirtyWindow } from './segment-dirty-tracker';

/** Telemetry stage label for plan emission (never an execution stage). */
export const PARTIAL_REBAKE_PLAN_STAGE = 'partial-rebake-plan';

/**
 * Above this dirty-coverage ratio a partial splice loses to a straight full
 * composite (span overhead + double keyframe padding + splice bookkeeping).
 */
export const PARTIAL_REBAKE_MAX_COVERAGE = 0.6;

/** A keyframe-aligned span that would be re-composited and spliced. */
export interface SpliceSpan {
  startSeconds: number;
  endSeconds: number;
  startFrame: number;
  frameCount: number;
}

export type PartialRebakeStrategy = 'none' | 'partial' | 'full';

export interface PartialRebakePlan {
  strategy: PartialRebakeStrategy;
  /** Keyframe-aligned spans (empty for 'none' and 'full'). */
  spans: SpliceSpan[];
  /** Dirty span coverage of the timeline [0,1]. */
  coverageRatio: number;
  /** Honest reason for the chosen strategy. */
  reason: string;
}

export interface PartialRebakePlanInput {
  windows: readonly DirtyWindow[];
  durationSeconds: number;
  fps: number;
  /** Splice grid — must equal the output's keyframe cadence. */
  keyframeIntervalSeconds?: number;
  maxPartialCoverage?: number;
}

/**
 * Snap dirty windows outward to the keyframe grid, merge adjacent spans, and
 * choose the strategy. Deterministic and side-effect free.
 */
export function planPartialRebake(input: PartialRebakePlanInput): PartialRebakePlan {
  const {
    windows,
    durationSeconds,
    fps,
    keyframeIntervalSeconds = BROWSER_COMPOSITE_KEYFRAME_INTERVAL_SECONDS,
    maxPartialCoverage = PARTIAL_REBAKE_MAX_COVERAGE,
  } = input;

  if (!(durationSeconds > 0) || !(fps > 0) || !(keyframeIntervalSeconds > 0)) {
    return {
      strategy: 'full',
      spans: [],
      coverageRatio: 1,
      reason: 'Invalid timeline parameters — full composite is the only safe answer.',
    };
  }

  const usable = windows.filter(
    (window) => window.endSeconds > window.startSeconds && window.startSeconds < durationSeconds,
  );
  if (usable.length === 0) {
    return { strategy: 'none', spans: [], coverageRatio: 0, reason: 'No dirty windows.' };
  }

  // Snap outward to the keyframe grid (floor start, ceil end), clamp, merge.
  const gridSpans = usable
    .map((window) => {
      const start =
        Math.floor(window.startSeconds / keyframeIntervalSeconds) * keyframeIntervalSeconds;
      const end = Math.min(
        durationSeconds,
        Math.ceil(window.endSeconds / keyframeIntervalSeconds) * keyframeIntervalSeconds,
      );
      return { start, end };
    })
    .sort((a, b) => a.start - b.start);

  const merged: { start: number; end: number }[] = [];
  for (const span of gridSpans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }

  const dirtySeconds = merged.reduce((sum, span) => sum + (span.end - span.start), 0);
  const coverageRatio = Math.min(1, dirtySeconds / durationSeconds);

  if (coverageRatio > maxPartialCoverage) {
    return {
      strategy: 'full',
      spans: [],
      coverageRatio,
      reason:
        `Dirty spans cover ${(coverageRatio * 100).toFixed(0)}% of the timeline ` +
        `(> ${(maxPartialCoverage * 100).toFixed(0)}%) — full composite is cheaper.`,
    };
  }

  const spans: SpliceSpan[] = merged.map((span) => {
    const startFrame = timeToFrame(span.start, fps);
    const endFrame = Math.min(
      timeToFrame(durationSeconds, fps),
      timeToFrame(span.end, fps),
    );
    return {
      startSeconds: frameToTime(startFrame, fps),
      endSeconds: frameToTime(endFrame, fps),
      startFrame,
      frameCount: Math.max(1, endFrame - startFrame),
    };
  });

  return {
    strategy: 'partial',
    spans,
    coverageRatio,
    reason: `${spans.length} keyframe-aligned span(s), ${(coverageRatio * 100).toFixed(0)}% of the timeline.`,
  };
}

// ---------------------------------------------------------------------------
// Orchestrator seam (Phase 2b lands the real splice behind this signature)
// ---------------------------------------------------------------------------

export interface PartialRebakeExecution {
  /** What ACTUALLY ran — 'partial' only when a real splice produced bytes (honesty). */
  executed: 'full' | 'partial' | 'none';
  plan: PartialRebakePlan;
  /** The output when work ran (null when strategy was 'none'). */
  blob: Blob | null;
}

/**
 * Execute a re-bake according to a plan. The splice executor is INJECTED so this
 * module stays pure (Node-testable); the browser-only splice lives in
 * composite-splice.ts. Honesty (invariant I2): report 'partial' ONLY when the
 * splice returned bytes. A partial plan with no executor, a splice that resolves
 * null (path not splice-friendly / plan chose full internally), or a splice that
 * throws a non-abort failure (incl. the fidelity gate rejecting the output) all
 * fall back to the full composite and report 'full'. AbortError propagates — a
 * deliberate cancel must not silently trigger a full re-render.
 */
export async function coordinateRebake(
  plan: PartialRebakePlan,
  executeFullComposite: () => Promise<Blob>,
  executePartialSplice?: () => Promise<Blob | null>,
): Promise<PartialRebakeExecution> {
  if (plan.strategy === 'none') {
    return { executed: 'none', plan, blob: null };
  }
  console.log(`[Reddit Voice Notes] ${PARTIAL_REBAKE_PLAN_STAGE}:`, {
    strategy: plan.strategy,
    spans: plan.spans.length,
    coverageRatio: Number(plan.coverageRatio.toFixed(3)),
    reason: plan.reason,
  });

  if (plan.strategy === 'partial' && executePartialSplice) {
    try {
      const spliced = await executePartialSplice();
      if (spliced) {
        return { executed: 'partial', plan, blob: spliced };
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      console.warn(
        '[Reddit Voice Notes] Partial splice failed — falling back to full composite.',
        error,
      );
    }
  }

  const blob = await executeFullComposite();
  return { executed: 'full', plan, blob };
}
