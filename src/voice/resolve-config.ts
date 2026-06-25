import { voiceConfigFromPreset } from './presets';
import {
  normalizeVoiceEffectConfig,
  VOICE_INTENSITY_DEFAULT,
  VOICE_INTENSITY_MAX,
  VOICE_SEMITONE_MAX,
  VOICE_SEMITONE_MIN,
  type EqBandConfig,
  type ReverbConfig,
  type VoiceEffectConfig,
  type VoiceEffectPresetId,
} from './types';

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

const REVERB_AMOUNT_MAX = 1;

/**
 * Bundled preset + live overrides (mirrors clip style preset + designOverrides).
 * Non-custom: rebuild SFX from preset table; only enabled/intensity/turbo are user-owned.
 * Custom: use stored pitch/EQ/dynamics as the full definition.
 */
export function resolveVoiceEffectConfig(config: VoiceEffectConfig): VoiceEffectConfig {
  const normalized = normalizeVoiceEffectConfig(config);
  if (normalized.presetId === 'custom') {
    return normalized;
  }

  const base = voiceConfigFromPreset(normalized.presetId as VoiceEffectPresetId);
  return normalizeVoiceEffectConfig({
    ...base,
    enabled: normalized.enabled,
    intensity: normalized.intensity,
    turbo: normalized.turbo,
    presetId: normalized.presetId,
  });
}

/**
 * Scale numeric effect magnitudes by intensity/10 (Turbo = 12 → 1.2×).
 * Resolves bundled presets first so intensity modulates the active preset SFX.
 */
export function scaleVoiceEffectByIntensity(config: VoiceEffectConfig): VoiceEffectConfig {
  const normalized = resolveVoiceEffectConfig(config);
  if (!normalized.enabled) return normalized;

  const intensity = normalized.intensity ?? VOICE_INTENSITY_DEFAULT;
  if (intensity <= 0) {
    return { ...normalized, enabled: false };
  }

  const factor = intensity / VOICE_INTENSITY_MAX;
  const roundGain = (value: number | undefined): number | undefined => {
    if (value === undefined || Number.isNaN(value)) return undefined;
    const scaled = Math.round(value * factor * 10) / 10;
    return scaled === 0 ? undefined : scaled;
  };

  const semitones = normalized.pitchShift?.semitones ?? 0;
  const scaledSemitones = clamp(
    Math.round(semitones * factor),
    VOICE_SEMITONE_MIN,
    VOICE_SEMITONE_MAX,
  );

  const eq = normalized.eq;
  const scaledEq: EqBandConfig | undefined = eq
    ? {
        lowGain: roundGain(eq.lowGain),
        midGain: roundGain(eq.midGain),
        highGain: roundGain(eq.highGain),
      }
    : undefined;

  const reverbAmount = normalized.reverb?.amount;
  const scaledReverb: ReverbConfig | undefined =
    reverbAmount !== undefined
      ? { amount: clamp(reverbAmount * factor, 0, REVERB_AMOUNT_MAX) }
      : undefined;

  return {
    ...normalized,
    pitchShift: normalized.pitchShift
      ? { ...normalized.pitchShift, semitones: scaledSemitones }
      : undefined,
    eq: scaledEq,
    reverb: scaledReverb,
  };
}

/** Compare user-facing voice state — preset picks match on id + intensity, not flattened SFX. */
export function voiceEffectUserIntentKey(config: VoiceEffectConfig): string {
  const normalized = normalizeVoiceEffectConfig(config);
  if (normalized.presetId !== 'custom') {
    return JSON.stringify({
      enabled: normalized.enabled,
      presetId: normalized.presetId,
      intensity: normalized.intensity,
      turbo: normalized.turbo,
    });
  }
  return JSON.stringify(normalized);
}

/** Stable equality for profile dirty checks and snapshots. */
export function voiceEffectConfigsEqual(
  a: VoiceEffectConfig,
  b: VoiceEffectConfig,
): boolean {
  return voiceEffectUserIntentKey(a) === voiceEffectUserIntentKey(b);
}

/** True when config would alter audio (used to skip FFmpeg -af and preview chains). */
export function voiceEffectIsActive(config: VoiceEffectConfig): boolean {
  const scaled = scaleVoiceEffectByIntensity(config);
  if (!scaled.enabled) return false;

  // Dulcet II (v5 / Branch 4): a composed graph with any enabled fragment is
  // active regardless of the legacy flat fields (it supersedes them on resolve).
  if (scaled.graph && scaled.graph.fragments.some((fragment) => fragment.enabled)) {
    return true;
  }

  const semitones = scaled.pitchShift?.semitones ?? 0;
  if (semitones !== 0) return true;

  // Dulcet II (v5): a formant-only / character-only custom voice is still active.
  if ((scaled.pitchShift?.formantShift ?? 0) !== 0) return true;
  if ((scaled.pitchShift?.character ?? 0) > 0) return true;

  const eq = scaled.eq;
  if (eq?.lowGain || eq?.midGain || eq?.highGain) return true;

  if (scaled.dynamics?.normalize || scaled.dynamics?.compressorEnabled) return true;

  const reverbAmount = scaled.reverb?.amount ?? 0;
  if (reverbAmount > 0) return true;

  return false;
}