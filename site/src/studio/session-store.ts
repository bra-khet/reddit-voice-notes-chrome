/* Optional "last session" restore — purely a demo-UX convenience.
 *
 * Stores ONLY the in-memory voice config under our own localStorage key. It never
 * reads or writes any extension storage key or origin (the studio is a separate
 * site), so it cannot interfere with the extension. Normalized on the way in.
 */
import { normalizeVoiceEffectConfig, type VoiceEffectConfig } from '@/src/voice/types';

const KEY = 'rvn-static-studio-last-voice';

export function loadLastVoice(): VoiceEffectConfig | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return normalizeVoiceEffectConfig(JSON.parse(raw) as VoiceEffectConfig);
  } catch {
    return null;
  }
}

export function saveLastVoice(config: VoiceEffectConfig): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(config));
  } catch {
    /* private mode / quota / denied — session restore is best-effort. */
  }
}
