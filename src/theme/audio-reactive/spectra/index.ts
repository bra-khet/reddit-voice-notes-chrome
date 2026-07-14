import { registerAudioVisualIfAbsent } from '..';
import { CLASSIC_NEON_VISUAL_DEFINITION } from './classic-neon';

export * from './classic-neon';

/** Register spectrum definitions that are production-ready in the current v6 phase. */
export function registerCoreSpectrumVisuals(): void {
  registerAudioVisualIfAbsent(CLASSIC_NEON_VISUAL_DEFINITION);
}
