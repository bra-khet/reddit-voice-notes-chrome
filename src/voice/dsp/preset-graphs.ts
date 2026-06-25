/**
 * Dulcet II (v5) — native character presets as StylizedGraphs (Sub-Phase 1.3).
 *
 * Curated mix-and-match recipes built directly in the new fragment model (no
 * legacy VoiceEffectConfig). Each preset is also a known-good combination of
 * fragments exercised together through the filter graph — they double as the
 * "many combinations work together" coverage the foundation needs.
 *
 * Authored in canonical chain order (and re-sorted defensively). `formantShift`
 * is carried forward but not yet audible until Branch 2 (pitch-formant).
 */

import { orderFragmentsCanonically } from './build-stylized-graph';
import {
  createFragment,
  STYLIZED_GRAPH_VERSION,
  type AnyFragment,
  type StylizedGraph,
} from './fragment-types';

export interface CharacterPreset {
  id: string;
  label: string;
  /** One-line "what character this is" blurb. */
  blurb: string;
  /** Recommended default intensity (0–10). */
  intensity: number;
  /** Build the (unordered-ok) fragment list; assembled via {@link characterPresetGraph}. */
  build(): AnyFragment[];
}

export const CHARACTER_PRESETS: readonly CharacterPreset[] = [
  {
    id: 'cyber-oracle',
    label: 'Cyber Oracle',
    blurb: 'Shimmering digital construct — light and metallic with a granular sheen (not a deep voice).',
    intensity: 9,
    build: () => [
      // Deliberately NOT deep — this is what separates it from NerdRage. The pitch/throat
      // stay light; the identity comes from metallic shimmer + subtle granular layering.
      createFragment('pitchFormant', { semitones: -2, formantShift: -1, character: 28 }),
      // Gentle makeup — nudge the overall level up (read a touch quiet).
      createFragment('compressor', { amount: 12, makeup: 35 }),
      createFragment('spectralCarve', { amount: 50, character: 80 }),
      createFragment('presenceAir', { presence: 35, air: 35 }),
      // Metallic shimmer: a higher-carrier ring mod (subtle) + a flanger comb sweep.
      createFragment('ringMod', { frequency: 340, mix: 24 }),
      createFragment('flanger', { rate: 10, depth: 50, mix: 26 }),
      // Subtle granular layering — the "digitized" metallic texture, kept gentle.
      createFragment('granular', { grainSize: 22, density: 50, randomization: 35, pitchScatter: 18, mix: 20 }),
      // Tight metallic chamber (not the deep oracle hall NerdRage uses).
      createFragment('convReverb', { space: 'cyber-chamber', mix: 35, decay: 50, preDelay: 20 }),
    ],
  },
  {
    id: 'nerdrage',
    label: 'NerdRage 🧪',
    blurb: 'Homage to the NurdRage YouTube channel — the original Cyber Oracle voicing, preserved as-is.',
    intensity: 9,
    build: () => [
      createFragment('pitchFormant', { semitones: -4, formantShift: -2, character: 40 }),
      createFragment('spectralCarve', { amount: 45, character: 75 }),
      createFragment('presenceAir', { presence: 35, air: 25 }),
      createFragment('ringMod', { frequency: 80, mix: 16 }),
      createFragment('convReverb', { space: 'oracle', mix: 45, decay: 75, preDelay: 35 }),
    ],
  },
  {
    id: 'glitch-beast',
    label: 'Glitch Beast',
    blurb: 'Snarling, stuttering cyber-monster — half engine, half growl.',
    intensity: 9,
    build: () => [
      createFragment('pitchFormant', { semitones: -6, formantShift: -3, character: 55 }),
      // makeup is pure post-compression level (not the grit) — lowered for loudness only.
      createFragment('compressor', { amount: 60, makeup: 8 }),
      createFragment('saturation', { warmth: 35, drive: 55, edge: 45 }),
      createFragment('ringMod', { frequency: 140, mix: 28 }),
      createFragment('granular', { grainSize: 30, density: 60, randomization: 50, pitchScatter: 30, mix: 35 }),
      createFragment('convReverb', { space: 'cyber-chamber', mix: 30, decay: 45, preDelay: 15 }),
      // Output ceiling — tames the loud peaks without touching the growl/grit.
      createFragment('limiter', { amount: 60 }),
    ],
  },
  {
    id: 'ethereal-singer',
    label: 'Ethereal Singer',
    blurb: 'Bright, breathy spirit with a shimmering synth halo.',
    intensity: 8,
    build: () => [
      createFragment('pitchFormant', { semitones: 3, formantShift: 2, character: 30 }),
      // Gentle leveler + makeup — modest lift (halved from the first pass; was too loud).
      createFragment('compressor', { amount: 20, makeup: 33 }),
      createFragment('presenceAir', { presence: 30, air: 55 }),
      createFragment('chorus', { rate: 30, depth: 55, mix: 50 }),
      createFragment('hybridLayer', { layerMix: 35, carrier: 'noise', followStrength: 60, harmonicEmphasis: 40 }),
      createFragment('convReverb', { space: 'fantasy-hall', mix: 40, decay: 60, preDelay: 25 }),
      createFragment('limiter', { amount: 45 }),
    ],
  },
  {
    id: 'radio-demon',
    label: 'Radio Demon',
    blurb: 'Crackly, squashed vintage-broadcast menace.',
    intensity: 9,
    build: () => [
      createFragment('pitchFormant', { semitones: -2, formantShift: -1, character: 25 }),
      createFragment('eq', { lowGain: -6, midGain: 5, highGain: -2 }),
      // makeup is pure post-compression level (not the grit/EQ) — lowered for loudness only.
      createFragment('compressor', { amount: 75, makeup: 10 }),
      createFragment('saturation', { warmth: 20, drive: 45, edge: 60 }),
      createFragment('convReverb', { space: 'phone', mix: 35, decay: 30, preDelay: 10 }),
      // Tighter ceiling — radio character is great, just a touch loud.
      createFragment('limiter', { amount: 70 }),
    ],
  },
  {
    id: 'helium-sprite',
    label: 'Helium Sprite',
    blurb: 'Tiny, hyper, cartoon-pixie chatter.',
    intensity: 8,
    build: () => [
      createFragment('pitchFormant', { semitones: 7, formantShift: 5, character: 20 }),
      // Gentle leveler + makeup — modest lift (halved from the first pass; was too loud).
      createFragment('compressor', { amount: 20, makeup: 33 }),
      createFragment('deEsser', { amount: 45 }),
      createFragment('presenceAir', { presence: 40, air: 35 }),
      createFragment('flanger', { rate: 45, depth: 35, mix: 25 }),
      createFragment('limiter', { amount: 45 }),
    ],
  },
  {
    id: 'abyssal-titan',
    label: 'Abyssal Titan',
    blurb: 'Colossal, subterranean god-voice — deep and long, clean power over a vast cavern tail.',
    intensity: 10,
    build: () => [
      // Cross of Glitch Beast (deep growl/power) and NerdRage (deep, clean, resonant).
      // Deeper + bigger throat than before; the choppy granular + metallic carve are GONE
      // (they made it muddy), replaced by a longer, larger reverb and a clarity lift.
      createFragment('pitchFormant', { semitones: -9, formantShift: -6, character: 55 }),
      createFragment('compressor', { amount: 50, makeup: 20 }),
      createFragment('saturation', { warmth: 55, drive: 28, edge: 8 }),
      // Clarity so the depth reads as "huge" rather than "muddy".
      createFragment('presenceAir', { presence: 35, air: 20 }),
      // Longer, larger tail — the "god from the deep" space.
      createFragment('convReverb', { space: 'cavern', mix: 55, decay: 95, preDelay: 50 }),
      createFragment('limiter', { amount: 48 }),
    ],
  },
];

/** Assemble a character preset into a StylizedGraph (canonical-ordered). */
export function characterPresetGraph(
  preset: CharacterPreset,
  intensity: number = preset.intensity,
  turbo = false,
): StylizedGraph {
  return {
    version: STYLIZED_GRAPH_VERSION,
    enabled: true,
    intensity,
    turbo,
    fragments: orderFragmentsCanonically(preset.build()),
  };
}

export function getCharacterPreset(id: string): CharacterPreset | undefined {
  return CHARACTER_PRESETS.find((preset) => preset.id === id);
}
