import { registerAudioVisualIfAbsent } from '@/src/theme/audio-reactive';
import { BOKEH_VISUAL_DEFINITION } from './bokeh';
import { FOREST_SPIRITS_VISUAL_DEFINITION } from './forest-spirits';
import { SPARKLE_VISUAL_DEFINITION } from './sparkle';

export * from './bokeh';
export * from './forest-spirits';
export * from './sparkle';

/** Register v6's built-in overlay families without duplicate-import failures. */
export function registerCoreOverlayVisuals(): void {
  registerAudioVisualIfAbsent(SPARKLE_VISUAL_DEFINITION);
  registerAudioVisualIfAbsent(BOKEH_VISUAL_DEFINITION);
  registerAudioVisualIfAbsent(FOREST_SPIRITS_VISUAL_DEFINITION);
}
