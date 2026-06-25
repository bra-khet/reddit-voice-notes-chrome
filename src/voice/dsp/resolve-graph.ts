/**
 * Dulcet II (v5) — single source of truth for config → StylizedGraph resolution.
 *
 * Used by BOTH the live export (`ffmpeg-runner.ts`) and the one-shot Studio
 * preview (`preview-pipeline`) so the two always resolve the same graph — the
 * "Test" button is guaranteed to sound like the bake (roadmap Branch 3, §3.3).
 *
 * Pure data (no WASM): a selected v5 character preset builds its native graph;
 * otherwise the legacy flat VoiceEffectConfig is migrated.
 */

import {
  VOICE_INTENSITY_DEFAULT,
  VOICE_INTENSITY_TURBO,
  type VoiceEffectConfig,
} from '../types';
import type { StylizedGraph } from './fragment-types';
import { migrateVoiceEffectToGraph } from './migrate-v1';
import { characterPresetGraph, getCharacterPreset } from './preset-graphs';

/**
 * Resolve a (normalized) {@link VoiceEffectConfig} into the {@link StylizedGraph}
 * that gets rendered. Caller is expected to pass an already-normalized config.
 */
export function resolveVoiceGraph(config: VoiceEffectConfig): StylizedGraph {
  // Branch 4: a user-composed graph is authoritative when present. The stored
  // graph's own enabled/intensity/turbo are a baseline the global slider
  // overrides at resolve time (same contract as the preset path below), so the
  // Studio's Intensity/Turbo controls keep modulating a custom voice.
  if (config.graph && config.graph.fragments.length > 0) {
    return {
      ...config.graph,
      enabled: config.enabled !== false,
      intensity: config.turbo
        ? VOICE_INTENSITY_TURBO
        : config.intensity ?? VOICE_INTENSITY_DEFAULT,
      turbo: config.turbo === true,
    };
  }

  const preset = config.characterPresetId
    ? getCharacterPreset(config.characterPresetId)
    : undefined;

  if (preset) {
    const intensity = config.turbo
      ? VOICE_INTENSITY_TURBO
      : config.intensity ?? VOICE_INTENSITY_DEFAULT;
    return characterPresetGraph(preset, intensity, config.turbo === true);
  }

  return migrateVoiceEffectToGraph(config);
}
