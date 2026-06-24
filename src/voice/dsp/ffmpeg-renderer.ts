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
import { encodeWavMono16, generateImpulseResponse } from './ir-generator';
import type { FragmentRenderer, RenderContext } from './renderer';

/** An extra input file (e.g. a generated IR WAV) the complex graph references as `-i`. */
export interface ParallelAuxInput {
  /** Encoded audio bytes written to the FFmpeg FS and added as an extra `-i` input. */
  bytes: Uint8Array;
  /** File extension including the dot, e.g. `'.wav'`. */
  ext: string;
}

/**
 * A parallel (split → process → mix) fragment. The assembler splits the current
 * stream into dry + processing branches, runs `build()` on the processing branch,
 * then `amix`es wet against dry per `wetMix`. Used by ring-mod, convolution, etc.
 */
export interface ParallelSpec {
  /** lavfi in-graph source filters (e.g. `sine=frequency=200:sample_rate=48000`). */
  sources?: string[];
  /** Extra input files (e.g. a procedural IR WAV for `afir`). */
  auxInputs?: ParallelAuxInput[];
  /**
   * Build the wet branch. Receives the processing-branch input label, the labels
   * of declared sources and aux inputs, and a unique prefix; returns filter
   * statements plus the resulting wet label.
   */
  build(
    input: string,
    sources: string[],
    auxInputs: string[],
    prefix: string,
  ): { statements: string[]; wet: string };
  /** Wet mix 0..1 (0 = dry only; emitters should skip rather than emit 0). */
  wetMix: number;
  /**
   * `amix` duration policy for the dry/wet blend. `'first'` (default) bounds the
   * output to the voice length; `'longest'` preserves a wet tail past the voice
   * (reverb). `'shortest'` ends at whichever branch ends first.
   */
  mixDuration?: 'first' | 'longest' | 'shortest';
}

/** One fragment's contribution to the FFmpeg graph: linear `-af` or a parallel spec. */
export interface FfmpegNode {
  /** Human-readable progress label. */
  stage: string;
  /** Linear `-af` segments (the common case). */
  af?: string[];
  /** Present for parallel kinds — forces the whole graph to `-filter_complex`. */
  parallel?: ParallelSpec;
}

/** Final assembled FFmpeg artifact. The linear shape mirrors the legacy filter result. */
export interface FfmpegGraphResult {
  /** `'none'` = no-op; `'af'` = linear chain; `'complex'` = `-filter_complex`. */
  mode: 'none' | 'af' | 'complex';
  /** Comma-joined `-af` string when `mode === 'af'`, else `null`. */
  af: string | null;
  /** `-filter_complex` graph when `mode === 'complex'`, else `null`. */
  filterComplex: string | null;
  /** Audio output pad to `-map` in complex mode, else `null`. */
  outputLabel: string | null;
  /** Extra input files (in order) the complex graph references; empty for linear. */
  auxInputs: ParallelAuxInput[];
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

/* ------------------------- 1.2b parallel emitters (filter_complex) ------------------------- */

/** True ring modulation: signal × sine carrier via `amultiply` (needs the complex path). */
const emitRingMod: Emitter<'ringMod'> = (p, ctx) => {
  const wet = ctx.scale(p.mix);
  if (wet <= 0) return null;
  const freq = Math.round(clamp(p.frequency, 1, 20_000));
  return {
    stage: 'ring-mod',
    parallel: {
      sources: [`sine=frequency=${freq}:sample_rate=${ctx.sampleRate}`],
      build: (input, sources, _aux, prefix) => ({
        statements: [`[${input}][${sources[0]}]amultiply[${prefix}_wet]`],
        wet: `${prefix}_wet`,
      }),
      wetMix: Math.min(1, wet),
    },
  };
};

/** Convolution reverb: procedural IR → WAV aux input → `afir`. Keeps the wet tail. */
const emitConvReverb: Emitter<'convReverb'> = (p, ctx) => {
  const wet = ctx.scale(p.mix);
  if (wet <= 0) return null;
  const ir = generateImpulseResponse(
    { space: p.space, decay: p.decay, preDelay: p.preDelay },
    ctx.sampleRate,
  );
  const wav = encodeWavMono16(ir, ctx.sampleRate);
  return {
    stage: 'conv-reverb',
    parallel: {
      auxInputs: [{ bytes: wav, ext: '.wav' }],
      build: (input, _sources, aux, prefix) => ({
        // afir convolves the voice branch with the IR (input 1 = aux[0]).
        statements: [`[${input}][${aux[0]}]afir=gtype=peak[${prefix}_wet]`],
        wet: `${prefix}_wet`,
      }),
      wetMix: Math.min(1, wet),
      mixDuration: 'longest', // preserve the reverb tail past the voice
    },
  };
};

/**
 * Granular texture — first-pass FFmpeg approximation via a multi-tap echo smear
 * (the supplemental's suggested starting point). True per-grain windowing /
 * pitch-scatter is future AudioWorklet/WASM work, so `randomization` and
 * `pitchScatter` are not yet mapped. Linear (`aecho` carries its own wet/dry).
 */
const emitGranular: Emitter<'granular'> = (p, ctx) => {
  const mix = ctx.scale(p.mix);
  if (mix <= 0) return null;
  const spacing = Math.round(lerp(15, 60, p.grainSize / 100));
  const taps = Math.max(2, Math.round(lerp(2, 5, p.density / 100)));
  const delays: number[] = [];
  const decays: number[] = [];
  for (let i = 1; i <= taps; i++) {
    delays.push(spacing * i);
    decays.push(round(0.7 ** i, 2));
  }
  const outGain = round(clamp(0.5 + mix * 0.5, 0.3, 1), 2);
  return { af: [`aecho=0.9:${outGain}:${delays.join('|')}:${decays.join('|')}`], stage: 'granular' };
};

/**
 * Hybrid voice — a parallel synth-like layer DERIVED from the voice (finite, so
 * no infinite-source bounding needed). Carrier flavor picks the processing; the
 * user's performance still drives timing/level. Closest robust FFmpeg analogue
 * of the vocoder/"second processed stream" idea.
 */
const emitHybridLayer: Emitter<'hybridLayer'> = (p, ctx) => {
  const wet = ctx.scale(p.layerMix);
  if (wet <= 0) return null;
  const drive = round(lerp(1, 3, p.harmonicEmphasis / 100), 2);
  const carrier = p.carrier;
  return {
    stage: 'hybrid-layer',
    parallel: {
      build: (input, _sources, _aux, prefix) => {
        const chain: string[] = [];
        if (carrier === 'oscillator' || carrier === 'osc-bank') {
          // Octave-down synth double (duration-preserving).
          chain.push(`asetrate=${Math.round(ctx.sampleRate * 0.5)}`, `aresample=${ctx.sampleRate}`, 'atempo=2');
        } else if (carrier === 'noise') {
          chain.push('highpass=f=2000');
        } else if (carrier === 'granular') {
          chain.push('tremolo=f=18:d=0.7');
        }
        chain.push(`asoftclip=type=tanh:param=${drive}`);
        if (carrier === 'osc-bank') {
          chain.push('chorus=0.6:0.8:55|75:0.4|0.3:0.3|0.5:2|3');
        }
        return { statements: [`[${input}]${chain.join(',')}[${prefix}_wet]`], wet: `${prefix}_wet` };
      },
      wetMix: Math.min(1, wet),
      mixDuration: 'first',
    },
  };
};

/**
 * Spectral carving via resonant EQ peaks (robust approximation of `afftfilt`
 * sculpting). `character` tilts the resonances from vocal formants → metallic
 * highs; `amount` sets peak gain.
 */
const emitSpectralCarve: Emitter<'spectralCarve'> = (p, ctx) => {
  const amount = ctx.scale(p.amount);
  if (amount <= 0) return null;
  const c = p.character / 100; // 0 = vocal formants, 1 = metallic highs
  const f1 = Math.round(lerp(700, 2500, c));
  const f2 = Math.round(lerp(1200, 5500, c));
  const g = round(lerp(2, 10, amount), 1);
  return {
    af: [
      `equalizer=f=${f1}:width_type=q:width=5:g=${g}`,
      `equalizer=f=${f2}:width_type=q:width=5:g=${g}`,
    ],
    stage: 'spectral-carve',
  };
};

/** Emitter registry — all 21 fragment kinds now emit. */
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
  ringMod: emitRingMod,
  convReverb: emitConvReverb,
  granular: emitGranular,
  hybridLayer: emitHybridLayer,
  spectralCarve: emitSpectralCarve,
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

  assemble(nodes: FfmpegNode[], ctx: RenderContext): FfmpegGraphResult {
    const stages = nodes.map((node) => node.stage);
    const hasParallel = nodes.some((node) => node.parallel);

    // Fast path: all-linear → a single comma-joined `-af` chain (stereo preserved).
    if (!hasParallel) {
      const af: string[] = [];
      for (const node of nodes) af.push(...(node.af ?? []));
      if (af.length === 0) {
        return { mode: 'none', af: null, filterComplex: null, outputLabel: null, auxInputs: [], stages };
      }
      return {
        mode: 'af',
        af: af.join(','),
        filterComplex: null,
        outputLabel: null,
        auxInputs: [],
        stages,
      };
    }

    // Complex path: thread ONE mono stream through linear chains and parallel splits.
    const statements: string[] = [];
    const auxInputs: ParallelAuxInput[] = [];
    let auxIndex = 1; // input 0 = main audio; generated/aux files start at 1.

    // Mono-normalize once so sine carriers, IRs, and amix branches share a layout.
    statements.push(`[0:a]aformat=channel_layouts=mono:sample_rates=${ctx.sampleRate}[main]`);
    let cur = 'main';

    nodes.forEach((node, i) => {
      const prefix = `n${i}`;

      if (!node.parallel) {
        const af = (node.af ?? []).join(',');
        if (af) {
          statements.push(`[${cur}]${af}[${prefix}]`);
          cur = prefix;
        }
        return;
      }

      const spec = node.parallel;
      const sourceLabels = (spec.sources ?? []).map((src, si) => {
        const label = `${prefix}_src${si}`;
        statements.push(`${src}[${label}]`);
        return label;
      });
      const auxLabels = (spec.auxInputs ?? []).map((aux) => {
        const label = `${auxIndex}:a`;
        auxInputs.push(aux);
        auxIndex += 1;
        return label;
      });

      // Split dry / processing, build the wet branch, then mix wet against dry.
      statements.push(`[${cur}]asplit=2[${prefix}_dry][${prefix}_pre]`);
      const built = spec.build(`${prefix}_pre`, sourceLabels, auxLabels, prefix);
      statements.push(...built.statements);

      const wet = clamp(spec.wetMix, 0, 1);
      const dry = round(1 - wet, 3);
      const duration = spec.mixDuration ?? 'first';
      statements.push(
        `[${prefix}_dry][${built.wet}]amix=inputs=2:weights=${dry} ${wet}:normalize=0:duration=${duration}[${prefix}]`,
      );
      cur = prefix;
    });

    return {
      mode: 'complex',
      af: null,
      filterComplex: statements.join(';'),
      outputLabel: cur,
      auxInputs,
      stages,
    };
  },
};
