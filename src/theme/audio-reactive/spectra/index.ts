import { registerAudioVisualIfAbsent } from '..';
import { CLASSIC_NEON_VISUAL_DEFINITION } from './classic-neon';
import { MINIMAL_VISUAL_DEFINITION } from './minimal';
import { PHOSPHOR_VISUAL_DEFINITION } from './phosphor';

export * from './classic-neon';
export * from './minimal';
export * from './phosphor';

/** Register spectrum definitions that are production-ready in the current v6 phase. */
export function registerCoreSpectrumVisuals(): void {
  registerAudioVisualIfAbsent(CLASSIC_NEON_VISUAL_DEFINITION);
  registerAudioVisualIfAbsent(MINIMAL_VISUAL_DEFINITION);
  registerAudioVisualIfAbsent(PHOSPHOR_VISUAL_DEFINITION);
}
