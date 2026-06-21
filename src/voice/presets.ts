import type { VoiceEffectConfig, VoiceEffectPresetId } from './types';
import { DEFAULT_PITCH_SHIFT, normalizeVoiceEffectConfig } from './types';

export interface VoiceEffectPreset {
  id: VoiceEffectPresetId;
  label: string;
  description: string;
  /** Design Studio tip shown when selected — helps users compensate for preset quirks. */
  usageHint?: string;
  config: VoiceEffectConfig;
}

/**
 * Bundled voice presets — not persisted in savedProfiles (mirrors theme preset pattern).
 * dulcet-2 Studio UI reads this table; dulcet-4 may snapshot onto ClipProfile via apply.
 */
export const VOICE_EFFECT_PRESETS: readonly VoiceEffectPreset[] = [
  {
    id: 'deeper',
    label: 'Deeper',
    description: 'Lower pitch — casual “radio host” warmth.',
    config: {
      enabled: true,
      presetId: 'deeper',
      pitchShift: { semitones: -5, preserveDuration: true },
    },
  },
  {
    id: 'higher',
    label: 'Higher',
    description: 'Brighter, lighter tone.',
    config: {
      enabled: true,
      presetId: 'higher',
      pitchShift: { semitones: 5, preserveDuration: true },
    },
  },
  {
    id: 'slight-mask',
    label: 'Slight mask',
    description: 'Gentle pitch shift plus softened highs — light anonymization.',
    usageHint: 'Speak steadily at normal volume — mumbling is harder to mask.',
    config: {
      enabled: true,
      presetId: 'slight-mask',
      pitchShift: { semitones: -3, preserveDuration: true },
      eq: { highGain: -4, midGain: -1 },
    },
  },
  {
    id: 'robot',
    label: 'Robot',
    description: 'Down-pitch with compressed dynamics — stylized, not forensic.',
    usageHint: 'Speak clearly and enunciate — heavy processing can muddy unclear speech.',
    config: {
      enabled: true,
      presetId: 'robot',
      pitchShift: { semitones: -4, preserveDuration: true },
      dynamics: { compressorEnabled: true },
      eq: { midGain: 3, highGain: -2 },
    },
  },
  {
    id: 'whisper',
    label: 'Whisper',
    description: 'Softer highs and gentle lift — intimate, quiet delivery.',
    usageHint: 'Speak a little louder than usual — this preset softens quiet delivery.',
    config: {
      enabled: true,
      presetId: 'whisper',
      pitchShift: { semitones: 2, preserveDuration: true },
      eq: { highGain: -6, lowGain: -2 },
      dynamics: { normalize: true },
    },
  },
  {
    id: 'custom',
    label: 'Custom',
    description: 'Manual sliders — edits mark the active profile dirty.',
    config: {
      enabled: true,
      presetId: 'custom',
      pitchShift: { ...DEFAULT_PITCH_SHIFT },
    },
  },
] as const;

const PRESET_BY_ID = new Map<VoiceEffectPresetId, VoiceEffectPreset>(
  VOICE_EFFECT_PRESETS.map((preset) => [preset.id, preset]),
);

export function getVoiceEffectPreset(id: VoiceEffectPresetId): VoiceEffectPreset {
  return PRESET_BY_ID.get(id) ?? PRESET_BY_ID.get('custom')!;
}

export function voiceConfigFromPreset(id: VoiceEffectPresetId): VoiceEffectConfig {
  return normalizeVoiceEffectConfig(getVoiceEffectPreset(id).config);
}