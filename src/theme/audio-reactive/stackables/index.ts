import { registerStackableEffectIfAbsent } from '@/src/theme/audio-reactive';
import { RISING_EMBER_EFFECT_DEFINITION } from './ember';

export * from './ember';

/** Register only the stackables whose render contracts have landed. */
export function registerCoreStackableEffects(): void {
  registerStackableEffectIfAbsent(RISING_EMBER_EFFECT_DEFINITION);
}
