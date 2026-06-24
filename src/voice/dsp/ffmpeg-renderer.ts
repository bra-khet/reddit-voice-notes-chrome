/**
 * Dulcet II (v5) — FFmpeg renderer (Sub-Phase 1.1 + 1.2).
 *
 * Implements {@link FragmentRenderer} for the export path. Each emitter maps a
 * fragment's high-level params → FFmpeg filter segments. The orchestrator joins
 * them into the `-af` string consumed by `ffmpeg-runner.ts` (drop-in compatible
 * with the legacy `buildFfmpegAudioFilter` result).
 *
 * ## Status
 * - **1.1 (this commit):** pitch, EQ, compressor, gate, limiter, echo/reverb —
 *   the legacy v1 primitive set, so migrated presets render identically. New
 *   stylized kinds are registered but emit `null` (skipped) until 1.2.
 * - **1.2:** modulation family, saturation/exciter/presence-air/spectral,
 *   de-esser/de-click, ring-mod, plus the `-filter_complex` promotion path for
 *   the parallel kinds (convReverb, granular, hybridLayer).
 *
 * Self-contained: imports only the fragment type model, never legacy `types.ts`.
 */

import type {
  AnyFragment,
  FragmentKind,
  FragmentParamMap,
} from './fragment-types';
import type { FragmentRenderer, RenderContext } from './renderer';

/** One fragment's contribution to the FFmpeg graph. */
export interface FfmpegNode {
  /** Linear `-af` segments (the common case). */
  af: string[];
  /** Human-readable progress label. */
  stage: string;
  /**
   * Set by parallel kinds (convReverb / granular / hybridLayer) to force
   * `-filter_complex`. Unused in 1.1 — populated in 1.2.
   */
  parallel?: true;
}

/** Final assembled FFmpeg artifact. Shape mirrors the legacy filter result. */
export interface FfmpegGraphResult {
  /** `'none'` = no-op; `'af'` = linear chain; `'complex'` = `-filter_complex` (1.2). */
  mode: 'none' | 'af' | 'complex';
  /** Comma-joined `-af` string when `mode === 'af'`, else `null`. */
  af: string | null;
  /** `-filter_complex` graph when `mode === 'complex'` (1.2), else `null`. */
  filterComplex: string | null;
  /** Audio output pad to `-map` in complex mode (1.2), else `null`. */
  outputLabel: string | null;
  /** Per-fragment stage labels for semantic progress UX. */
  stages: string[];
}

type Emitter<K extends FragmentKind> = (
  params: FragmentParamMap[K],
  ctx: RenderContext,
) => FfmpegNode | null;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function round(n: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/** Map an intensity-folded 0..~1.2 factor onto a filter param range (unclamped). */
function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * t;
}

/* ---------------------------- v1 primitive emitters ---------------------------- */

/**
 * Pitch shift (duration-preserving). Formant + character are declared but
 * deferred to Branch 2 (pitch-formant), which replaces this with high-quality
 * formant-aware shifting. Matches the legacy asetrate→aresample→atempo hack.
 */
const emitPitchFormant: Emitter<'pitchFormant'> = (params, ctx) => {
  const factor = ctx.intensity / 10;
  const semitones = clamp(Math.round(params.semitones * factor), -12, 12);
  if (semitones === 0) return null;

  const ratio = 2 ** (semitones / 12);
  const rate = Math.round(ctx.sampleRate * ratio);
  // atempo accepts 0.5–2.0; 1/ratio stays in range for ±12 semitones.
  const tempo = round(1 / ratio, 6);
  return {
    af: [`asetrate=${rate}`, `aresample=${ctx.sampleRate}`, `atempo=${tempo}`],
    stage: 'pitch',
  };
};

const emitEq: Emitter<'eq'> = (params, ctx) => {
  const factor = ctx.intensity / 10;
  const g = (v: number) => round(v * factor, 1);
  const segments: string[] = [];
  const low = g(params.lowGain);
  const mid = g(params.midGain);
  const high = g(params.highGain);
  if (low) segments.push(`equalizer=f=120:width_type=o:width=1:g=${low}`);
  if (mid) segments.push(`equalizer=f=2500:width_type=o:width=1:g=${mid}`);
  if (high) segments.push(`equalizer=f=8000:width_type=o:width=1:g=${high}`);
  return segments.length > 0 ? { af: segments, stage: 'eq' } : null;
};

const emitCompressor: Emitter<'compressor'> = (params, ctx) => {
  const amount = ctx.scale(params.amount); // 0..~1.2
  if (amount <= 0) return null;
  // amount → ratio 1.5..9, threshold −10..−32 dB; makeup 0..12 dB.
  const ratio = round(1.5 + amount * 7.5, 2);
  const threshold = round(-10 - amount * 22, 1);
  const makeup = round((params.makeup / 100) * 12, 1);
  const makeupSeg = makeup > 0 ? `:makeup=${makeup}` : '';
  return {
    af: [`acompressor=threshold=${threshold}dB:ratio=${ratio}:attack=5:release=80${makeupSeg}`],
    stage: 'compressor',
  };
};

const emitGate: Emitter<'gate'> = (params, ctx) => {
  const strength = ctx.scale(params.strength);
  if (strength <= 0) return null;
  // strength → threshold −60..−30 dB (higher strength gates more aggressively).
  const threshold = round(-60 + strength * 30, 1);
  return { af: [`agate=threshold=${threshold}dB:ratio=2:attack=5:release=120`], stage: 'gate' };
};

const emitLimiter: Emitter<'limiter'> = (params, ctx) => {
  const amount = ctx.scale(params.amount);
  if (amount <= 0) return null;
  // amount → ceiling 1.0..0.7 (harder clamp at higher amount).
  const limit = round(clamp(1 - amount * 0.3, 0.5, 1), 3);
  return { af: [`alimiter=limit=${limit}`], stage: 'limiter' };
};

const emitAlgoReverb: Emitter<'algoReverb'> = (params, ctx) => {
  const mix = ctx.scale(params.mix);
  if (mix <= 0) return null;
  const wet = round(Math.min(0.6, mix * 0.6), 2);
  // decay → feedback; preDelay → delay tap (ms).
  const feedback = round(0.4 + (params.decay / 100) * 0.5, 2);
  const delay = Math.round(40 + (params.preDelay / 100) * 100);
  return { af: [`aecho=0.8:${feedback}:${delay}|${delay * 2}:${wet}`], stage: 'reverb' };
};

/* ------------------------- 1.2a stylized emitters (linear -af) ------------------------- */
/*
 * Intensity folds into depth/mix/amount via ctx.scale; LFO rate/frequency stay
 * (mostly) raw so lowering intensity tapers strength without freezing movement.
 * Per-primitive non-linear curves are refined in Sub-Phase 1.3. Filters used are
 * present in the standard @ffmpeg/core 0.12 build; runtime availability is a QA
 * gate, and a missing filter degrades gracefully (export falls back to raw audio).
 */

const emitFlanger: Emitter<'flanger'> = (p, ctx) => {
  const depth = ctx.scale(p.depth);
  const mix = ctx.scale(p.mix);
  if (depth <= 0 && mix <= 0) return null;
  const speed = round(lerp(0.1, 6, p.rate / 100), 2);
  const depthMs = round(lerp(0.5, 8, depth), 2);
  const regen = round(lerp(0, 45, depth), 1);
  const width = Math.round(clamp(lerp(20, 95, mix), 0, 100));
  return {
    af: [`flanger=delay=2:depth=${depthMs}:regen=${regen}:width=${width}:speed=${speed}`],
    stage: 'flanger',
  };
};

const emitChorus: Emitter<'chorus'> = (p, ctx) => {
  const depth = ctx.scale(p.depth);
  const mix = ctx.scale(p.mix);
  if (depth <= 0 && mix <= 0) return null;
  const rate = p.rate / 100;
  const sp1 = round(0.2 + rate * 1.3, 2);
  const sp2 = round(0.3 + rate * 1.7, 2);
  const dp1 = round(lerp(1, 4, depth), 2);
  const dp2 = round(lerp(1, 3, depth), 2);
  const outGain = round(clamp(lerp(0.6, 0.9, mix), 0.1, 1), 2);
  // 2-voice chorus: delays 45/65 ms, decays 0.4/0.3.
  return { af: [`chorus=0.6:${outGain}:45|65:0.4|0.3:${sp1}|${sp2}:${dp1}|${dp2}`], stage: 'chorus' };
};

const emitPhaser: Emitter<'phaser'> = (p, ctx) => {
  const depth = ctx.scale(p.depth);
  const mix = ctx.scale(p.mix);
  if (depth <= 0 && mix <= 0) return null;
  const speed = round(lerp(0.1, 2, p.rate / 100), 2);
  const decay = round(clamp(lerp(0.1, 0.85, depth), 0, 0.99), 2);
  const outGain = round(clamp(lerp(0.6, 0.9, mix), 0.1, 1), 2);
  return {
    af: [`aphaser=in_gain=0.5:out_gain=${outGain}:delay=3:decay=${decay}:speed=${speed}:type=t`],
    stage: 'phaser',
  };
};

const emitTremolo: Emitter<'tremolo'> = (p, ctx) => {
  const depth = ctx.scale(p.depth);
  if (depth <= 0) return null;
  const f = round(lerp(0.5, 15, p.rate / 100), 2);
  const d = round(clamp(lerp(0.1, 0.9, depth), 0, 1), 2);
  return { af: [`tremolo=f=${f}:d=${d}`], stage: 'tremolo' };
};

const emitVibrato: Emitter<'vibrato'> = (p, ctx) => {
  const depth = ctx.scale(p.depth);
  if (depth <= 0) return null;
  const f = round(lerp(0.5, 12, p.rate / 100), 2);
  const d = round(clamp(lerp(0.05, 0.6, depth), 0, 1), 2);
  return { af: [`vibrato=f=${f}:d=${d}`], stage: 'vibrato' };
};

const emitSaturation: Emitter<'saturation'> = (p, ctx) => {
  const warmth = ctx.scale(p.warmth);
  const drive = ctx.scale(p.drive);
  const edge = ctx.scale(p.edge);
  if (warmth <= 0 && drive <= 0 && edge <= 0) return null;
  const preDb = round(lerp(0, 6, warmth) + lerp(0, 9, drive), 1);
  const hardness = Math.max(drive, edge);
  const type = edge > 0.5 ? 'atan' : 'tanh';
  const param = round(lerp(0.5, 2.5, hardness), 2);
  const out = round(clamp(lerp(0.9, 0.6, hardness), 0.3, 1), 2);
  const af: string[] = [];
  if (preDb > 0.05) af.push(`volume=${preDb}dB`);
  af.push(`asoftclip=type=${type}:param=${param}:output=${out}`);
  return { af, stage: 'saturation' };
};

const emitHarmonicExciter: Emitter<'harmonicExciter'> = (p, ctx) => {
  const amount = ctx.scale(p.amount);
  if (amount <= 0) return null;
  const amt = round(lerp(1, 15, amount), 2);
  const freq = Math.round(lerp(5000, 11000, p.sparkle / 100));
  const drive = round(lerp(4, 9, amount), 1);
  const blend = round(lerp(0, 5, p.sparkle / 100), 1);
  return { af: [`aexciter=amount=${amt}:drive=${drive}:freq=${freq}:blend=${blend}`], stage: 'exciter' };
};

const emitPresenceAir: Emitter<'presenceAir'> = (p, ctx) => {
  const presence = ctx.scale(p.presence);
  const air = ctx.scale(p.air);
  const presDb = round(lerp(0, 8, presence), 1);
  const airDb = round(lerp(0, 8, air), 1);
  const af: string[] = [];
  if (presDb > 0) af.push(`equalizer=f=4500:width_type=q:width=1.2:g=${presDb}`);
  if (airDb > 0) af.push(`treble=g=${airDb}:f=12000:width_type=q:width=0.7`);
  return af.length > 0 ? { af, stage: 'presence-air' } : null;
};

const emitDeEsser: Emitter<'deEsser'> = (p, ctx) => {
  const amount = ctx.scale(p.amount);
  if (amount <= 0) return null;
  const i = round(clamp(amount, 0, 1), 2);
  const m = round(clamp(lerp(0.3, 0.7, amount), 0, 1), 2);
  return { af: [`deesser=i=${i}:m=${m}:f=0.5:s=o`], stage: 'de-esser' };
};

const emitDeClick: Emitter<'deClick'> = (p, ctx) => {
  const amount = ctx.scale(p.amount);
  if (amount <= 0) return null;
  // Lower threshold = more aggressive declicking.
  const threshold = round(clamp(lerp(10, 2, amount), 1, 100), 1);
  return { af: [`adeclick=threshold=${threshold}`], stage: 'de-click' };
};

/**
 * Emitter registry. Kinds absent here are valid fragments whose FFmpeg emitter
 * is planned for Sub-Phase 1.2b — `emit()` skips them (returns `null`) for now:
 * the parallel kinds (ringMod, convReverb, granular, hybridLayer) need the
 * `-filter_complex` path, and spectralCarve needs `afftfilt` expressions.
 */
const EMITTERS: { [K in FragmentKind]?: Emitter<K> } = {
  pitchFormant: emitPitchFormant,
  eq: emitEq,
  compressor: emitCompressor,
  gate: emitGate,
  limiter: emitLimiter,
  algoReverb: emitAlgoReverb,
  flanger: emitFlanger,
  chorus: emitChorus,
  phaser: emitPhaser,
  tremolo: emitTremolo,
  vibrato: emitVibrato,
  saturation: emitSaturation,
  harmonicExciter: emitHarmonicExciter,
  presenceAir: emitPresenceAir,
  deEsser: emitDeEsser,
  deClick: emitDeClick,
};

/** Kinds with a working FFmpeg emitter today (the rest are 1.2 TODO). */
export const FFMPEG_IMPLEMENTED_KINDS = Object.keys(EMITTERS) as FragmentKind[];

export const ffmpegRenderer: FragmentRenderer<FfmpegNode, FfmpegGraphResult> = {
  backend: 'ffmpeg',

  emit(fragment: AnyFragment, ctx: RenderContext): FfmpegNode | null {
    const emitter = EMITTERS[fragment.kind] as Emitter<typeof fragment.kind> | undefined;
    if (!emitter) return null; // planned for Sub-Phase 1.2
    return emitter(fragment.params, ctx);
  },

  assemble(nodes: FfmpegNode[], _ctx: RenderContext): FfmpegGraphResult {
    const af: string[] = [];
    const stages: string[] = [];
    let needsComplex = false;
    for (const node of nodes) {
      af.push(...node.af);
      stages.push(node.stage);
      if (node.parallel) needsComplex = true;
    }

    // 1.2: when a parallel node appears, build a -filter_complex graph instead.
    if (needsComplex) {
      throw new Error('filter_complex assembly is not implemented until Sub-Phase 1.2');
    }

    if (af.length === 0) {
      return { mode: 'none', af: null, filterComplex: null, outputLabel: null, stages };
    }
    return { mode: 'af', af: af.join(','), filterComplex: null, outputLabel: null, stages };
  },
};
