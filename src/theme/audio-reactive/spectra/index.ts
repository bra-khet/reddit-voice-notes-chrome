import { registerAudioVisualIfAbsent } from '..';
import { CLASSIC_NEON_VISUAL_DEFINITION } from './classic-neon';
import { CENTRAL_PULSE_VISUAL_DEFINITION } from './central-pulse';
import { MINIMAL_VISUAL_DEFINITION } from './minimal';
import { OSCILLOSCOPE_VISUAL_DEFINITION } from './oscilloscope';
import { PHOSPHOR_VISUAL_DEFINITION } from './phosphor';
import { RADIAL_SPECTRUM_VISUAL_DEFINITION } from './radial-spectrum';

export * from './classic-neon';
export * from './central-pulse';
export * from './minimal';
export * from './oscilloscope';
export * from './phosphor';
export * from './radial-spectrum';

/** Register spectrum definitions that are production-ready in the current v6 phase. */
export function registerCoreSpectrumVisuals(): void {
  registerAudioVisualIfAbsent(CLASSIC_NEON_VISUAL_DEFINITION);
  registerAudioVisualIfAbsent(CENTRAL_PULSE_VISUAL_DEFINITION);
  registerAudioVisualIfAbsent(MINIMAL_VISUAL_DEFINITION);
  registerAudioVisualIfAbsent(OSCILLOSCOPE_VISUAL_DEFINITION);
  registerAudioVisualIfAbsent(PHOSPHOR_VISUAL_DEFINITION);
  registerAudioVisualIfAbsent(RADIAL_SPECTRUM_VISUAL_DEFINITION);
}
