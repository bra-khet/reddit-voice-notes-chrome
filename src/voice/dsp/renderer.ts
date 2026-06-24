/**
 * Dulcet II (v5) — backend-agnostic renderer contract (Sub-Phase 1.1).
 *
 * A renderer is the ONLY place that knows a concrete audio backend. The
 * FFmpeg renderer (`ffmpeg-renderer.ts`) emits `-af` / `-filter_complex` for
 * export today; a Web Audio renderer arrives in Branch 3 (preview-pipeline)
 * implementing this same interface, so preview and export share one graph.
 *
 * The orchestrator (`build-stylized-graph.ts`) is renderer-agnostic: it walks
 * the ordered fragments, calls `emit` per fragment, then `assemble`.
 */

import type { AnyFragment } from './fragment-types';

/**
 * Shared, backend-neutral context handed to every emitter.
 *
 * Intensity scaling lives here so each emitter can decide *how* a given param
 * responds to the global Intensity / Turbo slider. Sub-Phase 1.1 ships a plain
 * linear {@link RenderContext.scale}; Sub-Phase 1.3 replaces it (and per-emitter
 * usage) with the non-linear, per-primitive curves the roadmap calls for.
 */
export interface RenderContext {
  /** Effective intensity 0–12 (10 = nominal, 12 = Turbo). */
  intensity: number;
  /** Target sample rate (export = 48 kHz). */
  sampleRate: number;
  /**
   * Scale a 0–100 "amount" slider by the global intensity.
   * Linear placeholder: `amount/100 * intensity/10`. Returns a 0..~1.2 factor.
   * @see Sub-Phase 1.3 — non-linear / per-primitive scaling.
   */
  scale(amount0to100: number): number;
}

/**
 * Translates {@link StylizedGraph} fragments into a backend artifact.
 *
 * @typeParam TNode   Per-fragment intermediate (e.g. FFmpeg filter segments).
 * @typeParam TResult Final assembled artifact (e.g. an `-af` string + metadata).
 */
export interface FragmentRenderer<TNode, TResult> {
  /** Identifier for logging / fidelity notes (e.g. `'ffmpeg'`, `'web-audio'`). */
  readonly backend: string;
  /**
   * Translate one ENABLED fragment into a backend node, or `null` when the
   * fragment is a no-op at its current params (e.g. all sliders at 0).
   */
  emit(fragment: AnyFragment, ctx: RenderContext): TNode | null;
  /** Combine the ordered, non-null nodes into the final backend artifact. */
  assemble(nodes: TNode[], ctx: RenderContext): TResult;
}

/** Build the standard linear-scaling context for the given effective intensity. */
export function createRenderContext(intensity: number, sampleRate: number): RenderContext {
  return {
    intensity,
    sampleRate,
    // CONTRIBUTION POINT (1.3): swap this for the per-primitive non-linear curve.
    scale: (amount0to100: number) => (amount0to100 / 100) * (intensity / 10),
  };
}
