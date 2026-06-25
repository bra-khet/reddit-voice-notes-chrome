import { normalizeVoiceEffectConfig, type VoiceEffectConfig } from './types';

/**
 * Stable, id-independent key describing the user's voice *intent* — the basis
 * for profile dirty-checks and snapshots.
 *
 * Branch 4 (4.3): graph-native. The legacy flat preset / custom-SFX branches are
 * gone; a voice is a composed graph, a character pick, or nothing. Two rules:
 *  - **No volatile ids.** `createFragment` assigns time+counter ids that differ
 *    on every rebuild; the key serializes only kind / enabled / params (the
 *    audio-affecting content), never `fragment.id`.
 *  - **Intent kind.** A graph and a character pick are distinct user choices;
 *    each gets its own discriminated key.
 */
export function voiceEffectUserIntentKey(config: VoiceEffectConfig): string {
  const n = normalizeVoiceEffectConfig(config);
  const base = { enabled: n.enabled, intensity: n.intensity, turbo: n.turbo };

  if (n.graph && n.graph.fragments.length > 0) {
    return JSON.stringify({
      ...base,
      kind: 'graph',
      // Strip ids; order is significant (the chain), params/enabled are the content.
      fragments: n.graph.fragments.map((fragment) => ({
        kind: fragment.kind,
        enabled: fragment.enabled,
        params: fragment.params,
      })),
    });
  }

  if (n.characterPresetId) {
    return JSON.stringify({ ...base, kind: 'character', characterPresetId: n.characterPresetId });
  }

  return JSON.stringify({ ...base, kind: 'none' });
}

/** Stable equality for profile dirty checks and snapshots. */
export function voiceEffectConfigsEqual(a: VoiceEffectConfig, b: VoiceEffectConfig): boolean {
  return voiceEffectUserIntentKey(a) === voiceEffectUserIntentKey(b);
}
