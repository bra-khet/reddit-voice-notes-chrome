import { getCharacterPreset, resolveVoiceGraph, stylizedGraphIsActive } from './dsp';
import {
  effectiveVoiceIntensity,
  normalizeVoiceEffectConfig,
  type VoiceEffectConfig,
} from './types';

/**
 * One-line popup / studio summary for active voice settings.
 *
 * Dulcet II (v5 / Branch 4): reads the GRAPH world (resolveVoiceGraph +
 * stylizedGraphIsActive) — the same resolution the bake uses — so a composed
 * graph or a character preset is described correctly.
 */
export function formatVoiceEffectSummary(config: VoiceEffectConfig | undefined): string {
  const normalized = normalizeVoiceEffectConfig(config);
  const graph = resolveVoiceGraph(normalized);
  if (!stylizedGraphIsActive(graph)) return 'Off';

  const intensityLabel = normalized.turbo
    ? 'Turbo'
    : `${effectiveVoiceIntensity(normalized)}/10`;

  // A character preset is authoritative only when no composed graph overrides it
  // (graph wins in resolveVoiceGraph; mirror that priority here).
  const hasGraph = (normalized.graph?.fragments.length ?? 0) > 0;
  if (!hasGraph && normalized.characterPresetId) {
    const preset = getCharacterPreset(normalized.characterPresetId);
    if (preset) return `${preset.label} · ${intensityLabel}`;
  }

  return `Custom · ${intensityLabel}`;
}
