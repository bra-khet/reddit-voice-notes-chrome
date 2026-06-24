/**
 * Dulcet II (v5) — buildStylizedGraph orchestrator (Sub-Phase 1.1 / 1.2).
 *
 * Renderer-agnostic assembly of a {@link StylizedGraph} into a backend artifact.
 * Walks the user's ordered, enabled fragments, calls the renderer per fragment,
 * and assembles the result. Defaults to the FFmpeg renderer (export); Branch 3
 * passes a Web Audio renderer for preview using the exact same call.
 */

import {
  normalizeStylizedGraph,
  type AnyFragment,
  type FragmentKind,
  type StylizedGraph,
} from './fragment-types';
import { ffmpegRenderer, type FfmpegGraphResult } from './ffmpeg-renderer';
import { createRenderContext, type FragmentRenderer } from './renderer';

/** Export-path sample rate (matches the AAC transcode in ffmpeg-runner.ts). */
export const DSP_EXPORT_SAMPLE_RATE_HZ = 48_000;

/**
 * CANONICAL CHAIN ORDER — the default signal-flow order.
 *
 * ⚑ DESIGN DECISION (yours to confirm/adjust — see chat).
 *
 * This is the order new graphs and migrated presets are seeded in, and the
 * order `orderFragmentsCanonically()` restores on "reset order". It is NOT
 * forced at build time — once a user drags to reorder, their array order wins.
 *
 * Rationale for the proposed default (clean → shape → character → space → safety):
 *   1. Repair the source first (de-click, gate) so later gain stages don't amplify junk.
 *   2. Do the core pitch/formant transform before tone-shaping, so EQ acts on the
 *      shifted spectrum.
 *   3. EQ → compressor → de-ess: shape tone, then control dynamics, then tame the
 *      sibilance compression can raise.
 *   4. Color & character (saturation, exciter, presence/air, spectral, ring-mod).
 *   5. Modulation/movement.
 *   6. Texture, then spatial reverb, then the parallel hybrid synth voice.
 *   7. Limiter dead last as the final brickwall, catching every upstream stage
 *      (including reverb tails and the hybrid layer).
 *
 * Trade-offs worth your call: compressor-before-EQ vs after; whether pitch should
 * precede cleanup; de-esser placement; and whether the limiter truly belongs last
 * or right after the compressor.
 */
export const CANONICAL_CHAIN_ORDER: readonly FragmentKind[] = [
  'deClick',
  'gate',
  'pitchFormant',
  'eq',
  'compressor',
  'deEsser',
  'saturation',
  'harmonicExciter',
  'presenceAir',
  'spectralCarve',
  'ringMod',
  'flanger',
  'chorus',
  'phaser',
  'tremolo',
  'vibrato',
  'granular',
  'convReverb',
  'algoReverb',
  'hybridLayer',
  'limiter',
];

const CANONICAL_INDEX = new Map<FragmentKind, number>(
  CANONICAL_CHAIN_ORDER.map((kind, index) => [kind, index]),
);

/**
 * Stable-sort fragments into {@link CANONICAL_CHAIN_ORDER}. Used by migration,
 * preset seeding, and the UI "reset order" action — never auto-applied at build
 * (the user's chosen order is authoritative once set).
 */
export function orderFragmentsCanonically(fragments: AnyFragment[]): AnyFragment[] {
  return fragments
    .map((fragment, index) => ({ fragment, index }))
    .sort((a, b) => {
      const ka = CANONICAL_INDEX.get(a.fragment.kind) ?? Number.MAX_SAFE_INTEGER;
      const kb = CANONICAL_INDEX.get(b.fragment.kind) ?? Number.MAX_SAFE_INTEGER;
      return ka === kb ? a.index - b.index : ka - kb;
    })
    .map((entry) => entry.fragment);
}

/** Effective intensity 0–12: Turbo forces 12, otherwise the 0–10 slider value. */
function effectiveIntensity(graph: StylizedGraph): number {
  return graph.turbo ? 12 : graph.intensity;
}

/** True when the graph would alter audio (skip the FFmpeg pass / preview chain when false). */
export function stylizedGraphIsActive(graph: StylizedGraph): boolean {
  const result = buildStylizedGraph(normalizeStylizedGraph(graph));
  return result.mode !== 'none';
}

/**
 * Assemble a stylized graph into the FFmpeg export artifact.
 * @see ffmpeg-runner.ts — consumes `result.af` as the `-af` argument.
 */
export function buildStylizedGraph(graph: StylizedGraph): FfmpegGraphResult;
/**
 * Assemble a stylized graph with an explicit renderer (e.g. Web Audio in Branch 3).
 */
export function buildStylizedGraph<TNode, TResult>(
  graph: StylizedGraph,
  renderer: FragmentRenderer<TNode, TResult>,
): TResult;
export function buildStylizedGraph<TNode, TResult>(
  graph: StylizedGraph,
  renderer: FragmentRenderer<TNode, TResult> | FragmentRenderer<unknown, FfmpegGraphResult> = ffmpegRenderer,
): TResult | FfmpegGraphResult {
  const r = renderer as FragmentRenderer<unknown, unknown>;
  const intensity = effectiveIntensity(graph);
  const ctx = createRenderContext(intensity, DSP_EXPORT_SAMPLE_RATE_HZ);

  // Voice-off or zeroed intensity → assemble nothing (renderer decides "empty").
  const active = graph.enabled && intensity > 0 ? graph.fragments : [];

  const nodes: unknown[] = [];
  for (const fragment of active) {
    if (!fragment.enabled) continue;
    const node = r.emit(fragment, ctx);
    if (node != null) nodes.push(node);
  }

  return r.assemble(nodes, ctx) as TResult | FfmpegGraphResult;
}
