/**
 * Dulcet II (v5) — voice-effect carrier type.
 *
 * Branch 4 (4.3) removed the flat v3/v4 fields (pitchShift / eq / dynamics /
 * reverb) and the legacy `presetId`: voice authoring is now fully graph-native.
 * A VoiceEffectConfig carries the global enabled / intensity / Turbo plus EITHER
 * a user-composed `graph` or a `characterPresetId`; `resolveVoiceGraph` turns
 * that into the StylizedGraph that previews and bakes.
 *
 * Leaf module: imports only fragment-types (itself a dependency-free leaf, no
 * WASM, no back-import) so the settings popup never pulls FFmpeg through a
 * circular import.
 */

import { normalizeStylizedGraph, type StylizedGraph } from './dsp/fragment-types';

/** dulcet-4: nominal effect strength; 0 = off, Turbo maps to the magic 12. */
export const VOICE_INTENSITY_MIN = 0;
export const VOICE_INTENSITY_MAX = 10;
export const VOICE_INTENSITY_TURBO = 12;
export const VOICE_INTENSITY_DEFAULT = 10;

/** Nominal export sample rate — matches AAC transcode path in ffmpeg-runner.ts. */
export const VOICE_EXPORT_SAMPLE_RATE_HZ = 48_000;

export interface VoiceEffectConfig {
  enabled: boolean;
  /** Effect strength 0–10 (off at 0). Turbo forces the magic 12. */
  intensity?: number;
  /** When true, intensity is VOICE_INTENSITY_TURBO and the slider is bypassed. */
  turbo?: boolean;
  /** v5 character preset id. When set (and no graph), export/preview use its native graph. */
  characterPresetId?: string;
  /**
   * User-composed fragment chain — the AUTHORITATIVE voice when present and
   * non-empty: `resolveVoiceGraph` prefers it over `characterPresetId`. The
   * global enabled / intensity / Turbo still own those three values at resolve
   * time, so the Studio sliders keep modulating a custom voice.
   */
  graph?: StylizedGraph;
}

/** Voice effects off — backward-compatible default for profiles without voiceEffectConfig. */
export const DEFAULT_VOICE_EFFECT_CONFIG: VoiceEffectConfig = {
  enabled: false,
  intensity: VOICE_INTENSITY_DEFAULT,
  turbo: false,
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Additive merge for prefs / clip profiles — missing fields inherit defaults;
 * voice-off when absent. Any legacy flat fields (pitchShift / eq / dynamics /
 * reverb / presetId) on a stored pre-v5 blob are simply ignored.
 */
export function normalizeVoiceEffectConfig(
  raw: VoiceEffectConfig | null | undefined,
): VoiceEffectConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_VOICE_EFFECT_CONFIG };
  }

  const turbo = raw.turbo === true;
  let intensity =
    typeof raw.intensity === 'number' && !Number.isNaN(raw.intensity)
      ? Math.round(raw.intensity)
      : VOICE_INTENSITY_DEFAULT;
  intensity = turbo
    ? VOICE_INTENSITY_TURBO
    : clamp(intensity, VOICE_INTENSITY_MIN, VOICE_INTENSITY_MAX);

  const characterPresetId =
    typeof raw.characterPresetId === 'string' && raw.characterPresetId
      ? raw.characterPresetId
      : undefined;

  // Branch 4: structurally clean a composed graph; an emptied composer (no
  // fragments) collapses back to no-graph so the carrier never stores dead state.
  const normalizedGraph = raw.graph ? normalizeStylizedGraph(raw.graph) : undefined;
  const graph =
    normalizedGraph && normalizedGraph.fragments.length > 0 ? normalizedGraph : undefined;

  return {
    enabled: raw.enabled === true,
    intensity,
    turbo,
    characterPresetId,
    graph,
  };
}

/** Resolved strength for export/preview scaling (0 when disabled). */
export function effectiveVoiceIntensity(config: VoiceEffectConfig): number {
  const normalized = normalizeVoiceEffectConfig(config);
  if (!normalized.enabled) return 0;
  return normalized.intensity ?? VOICE_INTENSITY_DEFAULT;
}
