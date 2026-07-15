import { registerStackableEffectIfAbsent } from '@/src/theme/audio-reactive';
import { RISING_EMBER_EFFECT_DEFINITION } from './ember';
import { ELECTRIC_ARC_EFFECT_DEFINITION, LIGHTNING_EFFECT_DEFINITION } from './electricity';

export * from './ember';
export * from './electricity';

/** Register only the stackables whose render contracts have landed. */
export function registerCoreStackableEffects(): void {
  registerStackableEffectIfAbsent(RISING_EMBER_EFFECT_DEFINITION);
  registerStackableEffectIfAbsent(ELECTRIC_ARC_EFFECT_DEFINITION);
  registerStackableEffectIfAbsent(LIGHTNING_EFFECT_DEFINITION);
}
