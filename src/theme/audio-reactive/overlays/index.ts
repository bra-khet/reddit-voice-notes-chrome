import { registerAudioVisualIfAbsent } from '@/src/theme/audio-reactive';
import { AURORA_VISUAL_DEFINITION } from './aurora';
import { BOKEH_VISUAL_DEFINITION } from './bokeh';
import { DIGITAL_RAIN_VISUAL_DEFINITION } from './digital-rain';
import { FOREST_SPIRITS_VISUAL_DEFINITION } from './forest-spirits';
import { GLITCH_VISUAL_DEFINITION } from './glitch';
import { INFERNO_VISUAL_DEFINITION } from './inferno';
import { SPARKLE_VISUAL_DEFINITION } from './sparkle';

export * from './aurora';
export * from './bokeh';
export * from './digital-rain';
export * from './forest-spirits';
export * from './glitch';
export * from './inferno';
export * from './sparkle';

/** Register v6's built-in overlay families without duplicate-import failures. */
export function registerCoreOverlayVisuals(): void {
  registerAudioVisualIfAbsent(SPARKLE_VISUAL_DEFINITION);
  registerAudioVisualIfAbsent(BOKEH_VISUAL_DEFINITION);
  registerAudioVisualIfAbsent(FOREST_SPIRITS_VISUAL_DEFINITION);
  registerAudioVisualIfAbsent(DIGITAL_RAIN_VISUAL_DEFINITION);
  registerAudioVisualIfAbsent(INFERNO_VISUAL_DEFINITION);
  registerAudioVisualIfAbsent(AURORA_VISUAL_DEFINITION);
  registerAudioVisualIfAbsent(GLITCH_VISUAL_DEFINITION);
}
