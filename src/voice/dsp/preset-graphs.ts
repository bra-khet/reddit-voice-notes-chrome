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
    blurb: 'Deep, metallic prophet intoning from a vast digital cathedral.',
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
      createFragment('compressor', { amount: 60, makeup: 35 }),
      createFragment('saturation', { warmth: 35, drive: 55, edge: 45 }),
      createFragment('ringMod', { frequency: 140, mix: 28 }),
      createFragment('granular', { grainSize: 30, density: 60, randomization: 50, pitchScatter: 30, mix: 35 }),
      createFragment('convReverb', { space: 'cyber-chamber', mix: 30, decay: 45, preDelay: 15 }),
    ],
  },
  {
    id: 'ethereal-singer',
    label: 'Ethereal Singer',
    blurb: 'Bright, breathy spirit with a shimmering synth halo.',
    intensity: 8,
    build: () => [
      createFragment('pitchFormant', { semitones: 3, formantShift: 2, character: 30 }),
      createFragment('presenceAir', { presence: 30, air: 55 }),
      createFragment('chorus', { rate: 30, depth: 55, mix: 50 }),
      createFragment('hybridLayer', { layerMix: 35, carrier: 'noise', followStrength: 60, harmonicEmphasis: 40 }),
      createFragment('convReverb', { space: 'fantasy-hall', mix: 40, decay: 60, preDelay: 25 }),
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
      createFragment('compressor', { amount: 75, makeup: 45 }),
      createFragment('saturation', { warmth: 20, drive: 45, edge: 60 }),
      createFragment('convReverb', { space: 'phone', mix: 35, decay: 30, preDelay: 10 }),
      createFragment('limiter', { amount: 60 }),
    ],
  },
  {
    id: 'helium-sprite',
    label: 'Helium Sprite',
    blurb: 'Tiny, hyper, cartoon-pixie chatter.',
    intensity: 8,
    build: () => [
      createFragment('pitchFormant', { semitones: 7, formantShift: 5, character: 20 }),
      createFragment('deEsser', { amount: 45 }),
      createFragment('presenceAir', { presence: 40, air: 35 }),
      createFragment('flanger', { rate: 45, depth: 35, mix: 25 }),
    ],
  },
  {
    id: 'abyssal-titan',
    label: 'Abyssal Titan',
    blurb: 'Colossal, subterranean god-voice from the deep dark.',
    intensity: 10,
    build: () => [
      createFragment('pitchFormant', { semitones: -8, formantShift: -5, character: 60 }),
      createFragment('compressor', { amount: 45, makeup: 30 }),
      createFragment('saturation', { warmth: 50, drive: 30, edge: 10 }),
      createFragment('spectralCarve', { amount: 35, character: 20 }),
      createFragment('convReverb', { space: 'cavern', mix: 50, decay: 85, preDelay: 40 }),
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
