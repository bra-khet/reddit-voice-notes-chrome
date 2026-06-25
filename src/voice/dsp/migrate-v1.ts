/**
 * Dulcet II (v5) — legacy v1 → fragment-graph migration (Sub-Phase 1.1).
 *
 * Maps the flat v3/v4 `VoiceEffectConfig` (single pitchShift / eq / dynamics /
 * reverb slot, optionally preset-driven) into the new {@link StylizedGraph}.
 *
 * Per the v5 decision (replace config + migrate; no production user data yet),
 * this exists to (a) load any pre-v5 dev profiles without crashing and (b)
 * prove the round-trip: a migrated legacy preset must render to an `-af` chain
 * equivalent to the legacy `buildFfmpegAudioFilter`.
 *
 * Migration stores **unscaled** preset values + the intensity/turbo flags; the
 * FFmpeg emitters apply intensity scaling at build time, matching the legacy
 * resolve→scale→build flow.
 */

import { resolveVoiceEffectConfig } from '../resolve-config';
import type { VoiceEffectConfig } from '../types';
import { orderFragmentsCanonically } from './build-stylized-graph';
import {
  createEmptyGraph,
  createFragment,
  STYLIZED_GRAPH_VERSION,
  type AnyFragment,
  type StylizedGraph,
} from './fragment-types';

/** Convert a legacy voice config (preset or custom) into a stylized graph. */
export function migrateVoiceEffectToGraph(config: VoiceEffectConfig): StylizedGraph {
  // Flatten any active preset into concrete pitch/eq/dynamics/reverb (unscaled).
  const resolved = resolveVoiceEffectConfig(config);

  if (!resolved.enabled) {
    return createEmptyGraph();
  }

  const fragments: AnyFragment[] = [];

  // Dulcet II (v5): semitones + formantShift + character all drive the one
  // pitchFormant fragment. formant/character are 0 for any pre-v5 config.
  const semitones = resolved.pitchShift?.semitones ?? 0;
  const formantShift = resolved.pitchShift?.formantShift ?? 0;
  const character = resolved.pitchShift?.character ?? 0;
  if (semitones !== 0 || formantShift !== 0 || character > 0) {
    fragments.push(createFragment('pitchFormant', { semitones, formantShift, character }));
  }

  const eq = resolved.eq;
  if (eq && (eq.lowGain || eq.midGain || eq.highGain)) {
    fragments.push(
      createFragment('eq', {
        lowGain: eq.lowGain ?? 0,
        midGain: eq.midGain ?? 0,
        highGain: eq.highGain ?? 0,
      }),
    );
  }

  // Legacy dynamics: compressor and "normalize" both map to the compressor
  // fragment (normalize ≈ gentle leveling). Presets that used normalize
  // (whisper) get rebuilt natively in Sub-Phase 1.3.
  if (resolved.dynamics?.compressorEnabled) {
    fragments.push(createFragment('compressor', { amount: 50, makeup: 30 }));
  } else if (resolved.dynamics?.normalize) {
    fragments.push(createFragment('compressor', { amount: 30, makeup: 40 }));
  }

  const reverbAmount = resolved.reverb?.amount ?? 0;
  if (reverbAmount > 0) {
    fragments.push(
      createFragment('algoReverb', {
        mix: Math.round(reverbAmount * 100),
        decay: 40,
        preDelay: 15,
      }),
    );
  }

  return {
    version: STYLIZED_GRAPH_VERSION,
    enabled: true,
    intensity: resolved.turbo ? 12 : resolved.intensity ?? 10,
    turbo: resolved.turbo === true,
    fragments: orderFragmentsCanonically(fragments),
  };
}
