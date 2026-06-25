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
   * Non-linear strength multiplier for the current intensity. Ease-in curve:
   * `(intensity/10) ** 1.3`, so f(0)=0, **f(10)=1.0** (nominal unchanged), and
   * Turbo f(12)≈1.27. Low settings stay subtle, high settings ramp up dramatically
   * — the "character voice" feel. Emitters that scale pitch/EQ directly use this.
   */
  intensityFactor: number;
  /**
   * Scale a 0–100 "amount" slider by {@link RenderContext.intensityFactor}.
   * Returns a 0..~1.27 factor.
   */
  scale(amount0to100: number): number;
}

/** Ease-in intensity curve exponent. >1 = gentle lows, dramatic highs. */
const INTENSITY_CURVE_EXP = 1.3;

/** Map effective intensity (0–12) to a strength factor; f(10)=1.0, f(12)≈1.27. */
export function intensityToFactor(intensity: number): number {
  return Math.max(0, intensity / 10) ** INTENSITY_CURVE_EXP;
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

/** Build the render context (non-linear intensity scaling) for the given intensity. */
export function createRenderContext(intensity: number, sampleRate: number): RenderContext {
  const intensityFactor = intensityToFactor(intensity);
  return {
    intensity,
    sampleRate,
    intensityFactor,
    scale: (amount0to100: number) => (amount0to100 / 100) * intensityFactor,
  };
}
