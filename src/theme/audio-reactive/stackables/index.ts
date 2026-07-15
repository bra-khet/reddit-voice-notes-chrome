import { registerStackableEffectIfAbsent } from '@/src/theme/audio-reactive';
import { CONWAY_LIFE_EFFECT_DEFINITION } from './conway';
import { RISING_EMBER_EFFECT_DEFINITION } from './ember';
import { ELECTRIC_ARC_EFFECT_DEFINITION, LIGHTNING_EFFECT_DEFINITION } from './electricity';
import { LAYERED_SMOKE_EFFECT_DEFINITION } from './smoke';

export * from './conway';
export * from './ember';
export * from './electricity';
export * from './smoke';

/** Register only the stackables whose render contracts have landed. */
export function registerCoreStackableEffects(): void {
  registerStackableEffectIfAbsent(RISING_EMBER_EFFECT_DEFINITION);
  registerStackableEffectIfAbsent(ELECTRIC_ARC_EFFECT_DEFINITION);
  registerStackableEffectIfAbsent(LIGHTNING_EFFECT_DEFINITION);
  registerStackableEffectIfAbsent(CONWAY_LIFE_EFFECT_DEFINITION);
  registerStackableEffectIfAbsent(LAYERED_SMOKE_EFFECT_DEFINITION);
}
