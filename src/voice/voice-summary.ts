import { getVoiceEffectPreset } from './presets';
import {
  effectiveVoiceIntensity,
  normalizeVoiceEffectConfig,
  voiceEffectIsActive,
  type VoiceEffectConfig,
} from './types';

/** One-line popup / studio summary for active voice settings. */
export function formatVoiceEffectSummary(config: VoiceEffectConfig | undefined): string {
  const normalized = normalizeVoiceEffectConfig(config);
  if (!voiceEffectIsActive(normalized)) return 'Off';

  const presetId = normalized.presetId ?? 'custom';
  const presetLabel =
    presetId === 'custom' ? 'Custom' : getVoiceEffectPreset(presetId).label;
  const intensity = effectiveVoiceIntensity(normalized);

  if (normalized.turbo) {
    return `${presetLabel} · Turbo`;
  }

  return `${presetLabel} · ${intensity}/10`;
}