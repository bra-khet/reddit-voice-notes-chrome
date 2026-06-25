/**
 * Dulcet II (v5) — DSP graph fragment type model (Sub-Phase 1.1).
 *
 * This file IS the new canonical voice-config shape. It replaces the flat
 * v3/v4 `VoiceEffectConfig` (single pitchShift / eq / dynamics / reverb slot)
 * with an **ordered, composable list of fragment descriptors** — the
 * "mix-and-match building blocks" from the v5 supplemental.
 *
 * ## Design rules (do not regress)
 * - **Backend-agnostic.** A fragment describes *intent + high-level params*
 *   only. It contains zero FFmpeg or Web Audio knowledge. Renderers
 *   (`ffmpeg-renderer.ts` now, a Web Audio renderer in Branch 3) translate
 *   descriptors into a concrete backend. One source of truth → preview and
 *   export cannot drift.
 * - **Leaf module.** Like the legacy `types.ts`, this file imports nothing
 *   from `resolve-config` / `presets` / renderers. Keep it a pure-data leaf so
 *   the settings popup never pulls FFmpeg through a circular import (BUG-008).
 * - **High-level params.** Each fragment exposes 1–3 intuitive sliders
 *   (Amount / Character / Edge / Air …), NOT raw DSP coefficients. The
 *   renderer owns the slider → coefficient mapping. This is what lets the
 *   Branch-4 Custom UI stay friendly ("what this does to my character voice").
 *
 * @see docs/dsp-foundation-design.md
 * @see docs/v5-development-roadmap-supplemental.md (§"Concrete Primitive Reference")
 */

/** Schema version embedded in every {@link StylizedGraph} for forward migration. */
export const STYLIZED_GRAPH_VERSION = 1 as const;

/**
 * Per-fragment "Fine-tune" gain — the user-exposed per-primitive intensity curve.
 * 0–10, default 10 (= unchanged, so legacy graphs and presets render identically).
 * The renderer applies it as a non-linear weight on this fragment's strength; see
 * `withFragmentGain` in renderer.ts.
 */
export const FRAGMENT_GAIN_MIN = 0;
export const FRAGMENT_GAIN_MAX = 10;
export const FRAGMENT_GAIN_DEFAULT = 10;

/**
 * The seven primitive families from the supplemental. Drives the accordion
 * grouping in the Branch-4 Custom UI and the default chain ordering.
 */
export type FragmentCategory =
  | 'pitch-formant'
  | 'dynamics'
  | 'modulation'
  | 'color'
  | 'spatial'
  | 'textural'
  | 'hybrid';

/* ------------------------------------------------------------------ *
 * Per-fragment high-level parameter shapes.
 * Convention: 0–100 "amount" sliders unless a natural unit reads better
 * (semitones, Hz). Renderers map these onto real DSP coefficients.
 * ------------------------------------------------------------------ */

/** 1 · Pitch & Formant — the core character transform (deepened in Branch 2). */
export interface PitchFormantParams {
  /** Musical pitch offset, −12 … +12 semitones. */
  semitones: number;
  /** Formant warp independent of pitch, −12 … +12 (− = darker/larger throat). */
  formantShift: number;
  /** 0–100. Blends extra resonance/throat shaping for a more "produced" character. */
  character: number;
}

/** 2 · Dynamics & Clarity — supporting cleanup that serves stylization. */
export interface GateParams {
  /** 0–100. How aggressively low-level noise/room is silenced. */
  strength: number;
}
export interface CompressorParams {
  /** 0–100. Overall squash. */
  amount: number;
  /** 0–100. Make-up gain to restore perceived loudness. */
  makeup: number;
}
export interface LimiterParams {
  /** 0–100. How hard the brickwall ceiling clamps peaks. */
  amount: number;
}
export interface DeEsserParams {
  /** 0–100. Sibilance ("sss") reduction. */
  amount: number;
}
export interface DeClickParams {
  /** 0–100. Transient click/mouth-noise removal. */
  amount: number;
}

/** 3 · Modulation & Movement — swirl, shimmer, mechanical life. */
export interface ModulationParams {
  /** 0–100. LFO speed. */
  rate: number;
  /** 0–100. Modulation depth. */
  depth: number;
  /** 0–100. Wet blend into the dry signal. */
  mix: number;
}
export interface RingModParams {
  /** Carrier frequency in Hz (robotic/metallic when high). */
  frequency: number;
  /** 0–100. Wet blend. */
  mix: number;
}

/** 4 · Color & Embellishment — warmth, sparkle, edge, air. */
export interface SaturationParams {
  /** 0–100. Low-order warmth / tube-ish thickening. */
  warmth: number;
  /** 0–100. Higher-order drive / grit. */
  drive: number;
  /** 0–100. Aggressive top-end bite ("Edge"). */
  edge: number;
}
export interface HarmonicExciterParams {
  /** 0–100. Added upper-harmonic energy. */
  amount: number;
  /** 0–100. Bias toward the very top ("Sparkle"). */
  sparkle: number;
}
export interface PresenceAirParams {
  /** 0–100. Upper-mid presence lift (intelligibility / forwardness). */
  presence: number;
  /** 0–100. Very-high "air" shelf (breathy singer sheen). */
  air: number;
}
/** Spectral carving via `afftfilt` expressions — metallic/vocal-formant sculpting. */
export interface SpectralCarveParams {
  /** 0–100. Depth of the spectral shaping. */
  amount: number;
  /** 0–100. Tilts the shape from hollow/metallic → vocal/formant. */
  character: number;
}
/** Classic 3-band EQ — low/mid/high shelf tone shaping. */
export interface EqParams {
  /** Low-shelf gain, dB (−12 … +12). */
  lowGain: number;
  /** Mid bell gain, dB (−12 … +12). */
  midGain: number;
  /** High-shelf gain, dB (−12 … +12). */
  highGain: number;
}

/** 5 · Spatial / Reverb. */
export interface ConvReverbParams {
  /** Impulse-response id ("Character Space"); resolved against the IR bundle. */
  space: string;
  /** 0–100. Wet/dry. */
  mix: number;
  /** 0–100. Decay-tail length scaling. */
  decay: number;
  /** 0–100. Pre-delay before the tail (sense of distance). */
  preDelay: number;
}
/** Cheap algorithmic reverb (`aecho`/`areverb`) — light ambience without convolution. */
export interface AlgoReverbParams {
  /** 0–100. Wet/dry. */
  mix: number;
  /** 0–100. Decay/feedback. */
  decay: number;
  /** 0–100. Pre-delay. */
  preDelay: number;
}

/** 6 · Textural / Granular — glitch, stutter, shimmer-spirit textures. */
export interface GranularParams {
  /** 0–100. Grain length (small = stutter, large = smear). */
  grainSize: number;
  /** 0–100. Overlap/density of grains. */
  density: number;
  /** 0–100. Per-grain timing/pitch randomization. */
  randomization: number;
  /** 0–100. Per-grain pitch scatter. */
  pitchScatter: number;
  /** 0–100. Texture blend into the dry signal. */
  mix: number;
}

/** 7 · Hybrid Layers — vocoder/talkbox-style synth voicing driven by the user. */
export type HybridCarrier = 'noise' | 'oscillator' | 'osc-bank' | 'granular';
export interface HybridLayerParams {
  /** 0–100. Blend of the synth layer against the processed original. */
  layerMix: number;
  /** Carrier timbre the user's envelope/pitch modulates. */
  carrier: HybridCarrier;
  /** 0–100. How tightly the carrier tracks the driver envelope/pitch. */
  followStrength: number;
  /** 0–100. Added harmonic richness on the carrier. */
  harmonicEmphasis: number;
}

/**
 * Master map: fragment kind → its param shape. Adding a primitive means adding
 * one entry here plus a renderer emitter — the discriminated union, defaults,
 * and registry all derive from this map.
 */
export interface FragmentParamMap {
  pitchFormant: PitchFormantParams;
  gate: GateParams;
  compressor: CompressorParams;
  limiter: LimiterParams;
  deEsser: DeEsserParams;
  deClick: DeClickParams;
  flanger: ModulationParams;
  chorus: ModulationParams;
  phaser: ModulationParams;
  tremolo: ModulationParams;
  vibrato: ModulationParams;
  ringMod: RingModParams;
  saturation: SaturationParams;
  harmonicExciter: HarmonicExciterParams;
  presenceAir: PresenceAirParams;
  spectralCarve: SpectralCarveParams;
  eq: EqParams;
  convReverb: ConvReverbParams;
  algoReverb: AlgoReverbParams;
  granular: GranularParams;
  hybridLayer: HybridLayerParams;
}

export type FragmentKind = keyof FragmentParamMap;

/**
 * A single, typed node in the graph. Generic over kind so narrowing on
 * `.kind` narrows `.params` (see {@link AnyFragment}).
 */
export interface GraphFragment<K extends FragmentKind = FragmentKind> {
  /** Stable id for reorder / UI keying (assigned by {@link createFragment}). */
  id: string;
  kind: K;
  /** Per-fragment toggle (spec: every primitive has an enable/disable). */
  enabled: boolean;
  /**
   * Per-primitive Fine-tune gain (0–10, default {@link FRAGMENT_GAIN_DEFAULT}).
   * 10 = full strength (unchanged); lower attenuates this fragment via a
   * non-linear curve. See {@link FRAGMENT_GAIN_MAX} and renderer `withFragmentGain`.
   */
  gain: number;
  params: FragmentParamMap[K];
}

/** Discriminated union across every kind — the value type a renderer switches on. */
export type AnyFragment = { [K in FragmentKind]: GraphFragment<K> }[FragmentKind];

/**
 * The new canonical voice configuration. Replaces `VoiceEffectConfig`.
 *
 * `fragments` is the **user's chosen chain order** (spec: "drag to reorder").
 * New graphs and migrated presets are seeded in CANONICAL_CHAIN_ORDER, but the
 * array order is authoritative once a user reorders.
 */
export interface StylizedGraph {
  version: typeof STYLIZED_GRAPH_VERSION;
  /** Off when false — backward-compatible voice-off default. */
  enabled: boolean;
  /** Global strength 0–10; Turbo forces the magic 12 (preserved from v3/v4). */
  intensity: number;
  turbo: boolean;
  /** Ordered chain. Disabled fragments are retained (UI state) but skipped at build. */
  fragments: AnyFragment[];
}

/* ------------------------------------------------------------------ *
 * Registry — one row per fragment kind. The Branch-4 Custom UI reads
 * label/blurb/category; migration and "reset order" read defaults; the
 * renderer reads `parallel` to decide -af vs -filter_complex promotion.
 * ------------------------------------------------------------------ */

export interface FragmentDef<K extends FragmentKind = FragmentKind> {
  kind: K;
  category: FragmentCategory;
  /** Short UI label. */
  label: string;
  /** One-sentence "what this does to my character voice" tooltip. */
  blurb: string;
  /** Factory default params for a freshly-added fragment. */
  defaults: FragmentParamMap[K];
  /**
   * True when the emitter needs parallel routing (split + mix / convolution)
   * and therefore forces the whole graph to `-filter_complex`. Linear effects
   * stay in a simple `-af` chain.
   */
  parallel: boolean;
}

const MOD_DEFAULTS: ModulationParams = { rate: 35, depth: 45, mix: 40 };

export const FRAGMENT_DEFS: { [K in FragmentKind]: FragmentDef<K> } = {
  pitchFormant: {
    kind: 'pitchFormant',
    category: 'pitch-formant',
    label: 'Pitch & Formant',
    blurb: 'Shifts pitch and reshapes the throat — monster lows to helium highs.',
    defaults: { semitones: 0, formantShift: 0, character: 0 },
    parallel: false,
  },
  gate: {
    kind: 'gate',
    category: 'dynamics',
    label: 'Noise Gate',
    blurb: 'Silences room hiss between phrases for a tighter, cleaner take.',
    defaults: { strength: 30 },
    parallel: false,
  },
  compressor: {
    kind: 'compressor',
    category: 'dynamics',
    label: 'Compressor',
    blurb: 'Evens out loud and soft for a punchy, broadcast-ready voice.',
    defaults: { amount: 40, makeup: 30 },
    parallel: false,
  },
  limiter: {
    kind: 'limiter',
    category: 'dynamics',
    label: 'Limiter',
    blurb: 'Clamps peaks so aggressive characters never clip.',
    defaults: { amount: 50 },
    parallel: false,
  },
  deEsser: {
    kind: 'deEsser',
    category: 'dynamics',
    label: 'De-esser',
    blurb: 'Tames harsh "sss" sounds without dulling the whole voice.',
    defaults: { amount: 40 },
    parallel: false,
  },
  deClick: {
    kind: 'deClick',
    category: 'dynamics',
    label: 'De-click',
    blurb: 'Removes mouth clicks and pops for a polished delivery.',
    defaults: { amount: 35 },
    parallel: false,
  },
  flanger: {
    kind: 'flanger',
    category: 'modulation',
    label: 'Flanger',
    blurb: 'Jet-sweep whoosh — living, mechanical movement.',
    defaults: { ...MOD_DEFAULTS },
    parallel: false,
  },
  chorus: {
    kind: 'chorus',
    category: 'modulation',
    label: 'Chorus',
    blurb: 'Thickens into a shimmering, ethereal choir of one.',
    defaults: { ...MOD_DEFAULTS },
    parallel: false,
  },
  phaser: {
    kind: 'phaser',
    category: 'modulation',
    label: 'Phaser',
    blurb: 'Swirling, phasey ghost-in-the-machine sweep.',
    defaults: { ...MOD_DEFAULTS },
    parallel: false,
  },
  tremolo: {
    kind: 'tremolo',
    category: 'modulation',
    label: 'Tremolo',
    blurb: 'Pulsing volume wobble — vibrating creature or trembling spirit.',
    defaults: { rate: 40, depth: 50, mix: 100 },
    parallel: false,
  },
  vibrato: {
    kind: 'vibrato',
    category: 'modulation',
    label: 'Vibrato',
    blurb: 'Wavering pitch warble for an unstable, otherworldly tone.',
    defaults: { rate: 40, depth: 30, mix: 100 },
    parallel: false,
  },
  ringMod: {
    kind: 'ringMod',
    category: 'modulation',
    label: 'Ring Mod',
    blurb: 'Clangorous metallic robot timbre — classic sci-fi villain.',
    defaults: { frequency: 110, mix: 50 },
    // True ring modulation = signal × sine carrier (amultiply) → needs filter_complex (1.2b).
    parallel: true,
  },
  saturation: {
    kind: 'saturation',
    category: 'color',
    label: 'Saturation',
    blurb: 'Adds warmth and gritty harmonics — from cozy tube to snarling warrior.',
    defaults: { warmth: 30, drive: 20, edge: 10 },
    parallel: false,
  },
  harmonicExciter: {
    kind: 'harmonicExciter',
    category: 'color',
    label: 'Exciter',
    blurb: 'Sprinkles bright upper harmonics for a crisp, produced sheen.',
    defaults: { amount: 30, sparkle: 40 },
    parallel: false,
  },
  presenceAir: {
    kind: 'presenceAir',
    category: 'color',
    label: 'Presence & Air',
    blurb: 'Pushes the voice forward and adds breathy top-end air.',
    defaults: { presence: 30, air: 25 },
    parallel: false,
  },
  spectralCarve: {
    kind: 'spectralCarve',
    category: 'color',
    label: 'Spectral Carve',
    blurb: 'Sculpts the spectrum for hollow-metallic or vocal-formant character.',
    defaults: { amount: 30, character: 50 },
    parallel: false,
  },
  eq: {
    kind: 'eq',
    category: 'color',
    label: 'EQ',
    blurb: 'Three-band tone shaping — lows, mids, and highs to taste.',
    defaults: { lowGain: 0, midGain: 0, highGain: 0 },
    parallel: false,
  },
  convReverb: {
    kind: 'convReverb',
    category: 'spatial',
    label: 'Convolution Space',
    blurb: 'Places the voice in a real space — cathedral, cyber chamber, cavern.',
    defaults: { space: 'fantasy-hall', mix: 35, decay: 50, preDelay: 20 },
    parallel: true,
  },
  algoReverb: {
    kind: 'algoReverb',
    category: 'spatial',
    label: 'Echo / Reverb',
    blurb: 'Light algorithmic ambience and echo tails.',
    defaults: { mix: 25, decay: 40, preDelay: 15 },
    parallel: false,
  },
  granular: {
    kind: 'granular',
    category: 'textural',
    label: 'Granular Texture',
    blurb: 'Chops the voice into glitchy, stuttering, video-game-unit textures.',
    defaults: { grainSize: 40, density: 50, randomization: 30, pitchScatter: 20, mix: 50 },
    // First-pass FFmpeg approximation is a linear multi-tap echo; richer granular
    // (true parallel/per-grain) is future AudioWorklet/WASM work.
    parallel: false,
  },
  hybridLayer: {
    kind: 'hybridLayer',
    category: 'hybrid',
    label: 'Hybrid Voice',
    blurb: 'Overlays a vocoder-style synth voice driven by your performance.',
    defaults: { layerMix: 40, carrier: 'osc-bank', followStrength: 60, harmonicEmphasis: 40 },
    parallel: true,
  },
};

/** All kinds in a stable declaration order (registry key order). */
export const FRAGMENT_KINDS = Object.keys(FRAGMENT_DEFS) as FragmentKind[];

export function isFragmentKind(value: string): value is FragmentKind {
  return Object.prototype.hasOwnProperty.call(FRAGMENT_DEFS, value);
}

/* ------------------------------------------------------------------ *
 * Construction, normalization, validation.
 * ------------------------------------------------------------------ */

let fragmentIdCounter = 0;
/** Monotonic, collision-resistant id without pulling in a uuid dependency. */
function nextFragmentId(kind: FragmentKind): string {
  fragmentIdCounter += 1;
  return `${kind}-${Date.now().toString(36)}-${fragmentIdCounter.toString(36)}`;
}

/** Create a fragment seeded from registry defaults, with optional param overrides. */
export function createFragment<K extends FragmentKind>(
  kind: K,
  params?: Partial<FragmentParamMap[K]>,
): GraphFragment<K> {
  const defaults = FRAGMENT_DEFS[kind].defaults;
  return {
    id: nextFragmentId(kind),
    kind,
    enabled: true,
    gain: FRAGMENT_GAIN_DEFAULT,
    params: { ...defaults, ...params } as FragmentParamMap[K],
  };
}

/** Empty (voice-off) graph — the backward-compatible default for legacy profiles. */
export function createEmptyGraph(): StylizedGraph {
  return {
    version: STYLIZED_GRAPH_VERSION,
    enabled: false,
    intensity: 10,
    turbo: false,
    fragments: [],
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Coerce arbitrary stored/raw params for a kind back into a valid, fully
 * populated, range-clamped param object. Unknown fields are dropped; missing
 * fields inherit registry defaults. Centralizing clamps here keeps renderers
 * free to assume clean input.
 */
export function normalizeFragmentParams<K extends FragmentKind>(
  kind: K,
  raw: unknown,
): FragmentParamMap[K] {
  const d = FRAGMENT_DEFS[kind].defaults as unknown as Record<string, unknown>;
  const r = (raw ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, defVal] of Object.entries(d)) {
    if (typeof defVal === 'number') {
      // 0–100 sliders clamp to that range; semitones/formant to ±12; Hz stays positive.
      const isSemis = key === 'semitones' || key === 'formantShift';
      const isDb = key === 'lowGain' || key === 'midGain' || key === 'highGain';
      const isHz = key === 'frequency';
      let min = 0;
      let max = 100;
      if (isSemis || isDb) {
        min = -12;
        max = 12;
      } else if (isHz) {
        min = 1;
        max = 20_000;
      }
      out[key] = clamp(num(r[key], defVal), min, max);
    } else {
      // Non-numeric (carrier enum, space id): accept a string, else default.
      out[key] = typeof r[key] === 'string' ? r[key] : defVal;
    }
  }
  return out as unknown as FragmentParamMap[K];
}

/**
 * Coerce raw/stored data into a valid {@link StylizedGraph}: drops unknown
 * kinds, re-seeds ids, clamps params, and folds the magic Turbo intensity.
 * Safe for untrusted profile blobs.
 */
export function normalizeStylizedGraph(raw: unknown): StylizedGraph {
  if (!raw || typeof raw !== 'object') return createEmptyGraph();
  const r = raw as Partial<StylizedGraph> & { fragments?: unknown };

  const rawFragments: unknown[] = Array.isArray(r.fragments) ? r.fragments : [];
  const fragments: AnyFragment[] = [];
  for (const f of rawFragments) {
    if (!f || typeof f !== 'object') continue;
    const frag = f as Partial<GraphFragment> & { kind?: string };
    if (!frag.kind || !isFragmentKind(frag.kind)) continue;
    fragments.push({
      id: typeof frag.id === 'string' ? frag.id : nextFragmentId(frag.kind),
      kind: frag.kind,
      enabled: frag.enabled !== false,
      // Default 10 so pre-Fine-tune graphs stay full-strength (and dirty-stable).
      gain: clamp(Math.round(num(frag.gain, FRAGMENT_GAIN_DEFAULT)), FRAGMENT_GAIN_MIN, FRAGMENT_GAIN_MAX),
      params: normalizeFragmentParams(frag.kind, frag.params),
    } as AnyFragment);
  }

  const turbo = r.turbo === true;
  const intensity = turbo ? 12 : clamp(Math.round(num(r.intensity, 10)), 0, 10);

  return {
    version: STYLIZED_GRAPH_VERSION,
    enabled: r.enabled === true,
    intensity,
    turbo,
    fragments,
  };
}
