/**
 * Canvas overlay render perf guard (v5.3.4 Phase 5.3).
 * Production bake falls back to drawtext when offline render exceeds a duration-scaled budget.
 * Sync: subtitle-bake.ts (catch + fallback), subtitle-canvas-bake.ts (timer + abort).
 */

/** Observed ~few s wall per 1s of video; budget is generous to avoid false positives. */
export const CANVAS_RENDER_PERF_SECONDS_PER_CLIP_SECOND = 12;

export const CANVAS_RENDER_PERF_MIN_MS = 25_000;

export const CANVAS_RENDER_PERF_MAX_MS = 120_000;

export class CanvasRenderPerfExceededError extends Error {
  readonly budgetMs: number;
  readonly elapsedMs: number;

  constructor(budgetMs: number, elapsedMs: number) {
    super(
      `Canvas overlay render exceeded perf budget (${Math.round(budgetMs / 1000)}s, elapsed ${Math.round(elapsedMs / 1000)}s).`,
    );
    this.name = 'CanvasRenderPerfExceededError';
    this.budgetMs = budgetMs;
    this.elapsedMs = elapsedMs;
  }
}

export function isCanvasRenderPerfExceeded(error: unknown): error is CanvasRenderPerfExceededError {
  return error instanceof CanvasRenderPerfExceededError;
}

/** Scaled wall-clock budget for the canvas offline render phase only. */
export function canvasRenderPerfBudgetMs(videoDurationSeconds: number): number {
  const duration = Math.max(1, videoDurationSeconds);
  const scaled = Math.round(duration * CANVAS_RENDER_PERF_SECONDS_PER_CLIP_SECOND * 1000);
  return Math.min(CANVAS_RENDER_PERF_MAX_MS, Math.max(CANVAS_RENDER_PERF_MIN_MS, scaled));
}

/** Combine user cancel + perf-budget abort into one signal for the render loop. */
export function linkAbortSignals(...signals: Array<AbortSignal | undefined>): AbortController {
  const linked = new AbortController();
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      linked.abort(signal.reason);
      return linked;
    }
    signal.addEventListener('abort', () => linked.abort(signal.reason), { once: true });
  }
  return linked;
}

export function throwIfRenderAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (isCanvasRenderPerfExceeded(reason)) {
    throw reason;
  }
  throw new DOMException('Subtitle burn-in cancelled.', 'AbortError');
}