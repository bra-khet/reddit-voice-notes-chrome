import type {
  OverlayPresetId,
  SpectrumPresetId,
  StackableEffectId,
} from './catalog';
import { MAX_STACKABLE_EFFECTS } from './catalog';
import { getAudioVisualDefinition } from './index';
import { getStackableEffectDefinition } from './simulation/stackable';

/**
 * CHANGED: Phase 4 gives the visual catalog one pure, registry-backed cost policy.
 * WHY: the Studio warning and the capture renderer must suspend the same expensive accent.
 */
export const VISUAL_COST_COMFORTABLE_MAX = 560;
export const VISUAL_COST_ELEVATED_MAX = 980;

export type VisualPerformanceLevel = 'comfortable' | 'elevated' | 'guarded';

export interface VisualPerformanceInput {
  spectrumPreset?: SpectrumPresetId;
  overlayPreset?: OverlayPresetId | null;
  stackables?: readonly StackableEffectId[];
  density?: number;
}

export interface VisualPerformanceSnapshot {
  level: VisualPerformanceLevel;
  estimatedCost: number;
  effectiveCost: number;
  density: number;
  activeStackables: readonly StackableEffectId[];
  suspendedStackableId: StackableEffectId | null;
  suspendedStackableLabel: string | null;
}

const DEFAULT_SPECTRUM_ID: SpectrumPresetId = 'classic-neon';

function clamp01(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function scaledCost(maxElements: number | undefined, density: number, baseShare: number): number {
  if (!maxElements || !Number.isFinite(maxElements)) return 0;
  return Math.round(Math.max(0, maxElements) * (baseShare + (1 - baseShare) * density));
}

function levelForCost(cost: number): VisualPerformanceLevel {
  if (cost <= VISUAL_COST_COMFORTABLE_MAX) return 'comfortable';
  if (cost <= VISUAL_COST_ELEVATED_MAX) return 'elevated';
  return 'guarded';
}

function normalizedStackables(ids: readonly StackableEffectId[] | undefined): StackableEffectId[] {
  if (!ids) return [];
  const unique: StackableEffectId[] = [];
  for (const id of ids) {
    if (unique.includes(id) || !getStackableEffectDefinition(id)) continue;
    unique.push(id);
    if (unique.length >= MAX_STACKABLE_EFFECTS) break;
  }
  return unique;
}

/**
 * Estimate bounded paint passes, then pause one expensive accent when the red zone is crossed.
 * The saved selection stays intact so lowering Detail restores it automatically and visibly.
 */
export function evaluateVisualPerformance(
  input: VisualPerformanceInput,
): VisualPerformanceSnapshot {
  const density = clamp01(input.density);
  const spectrumId = input.spectrumPreset ?? DEFAULT_SPECTRUM_ID;
  const spectrumCost = scaledCost(
    getAudioVisualDefinition('spectrum', spectrumId)?.maxElements,
    density,
    0.65,
  );
  const overlayCost = input.overlayPreset
    ? scaledCost(
        getAudioVisualDefinition('overlay', input.overlayPreset)?.maxElements,
        density,
        0.3,
      )
    : 0;
  const stackables = normalizedStackables(input.stackables);
  const stackableCosts = stackables.map((id) => ({
    id,
    cost: scaledCost(getStackableEffectDefinition(id)?.maxElements, density, 0.3),
  }));
  const estimatedCost = spectrumCost
    + overlayCost
    + stackableCosts.reduce((sum, entry) => sum + entry.cost, 0);
  const level = levelForCost(estimatedCost);

  let suspendedStackableId: StackableEffectId | null = null;
  if (level === 'guarded' && stackableCosts.length > 0) {
    suspendedStackableId = stackableCosts.reduce((mostExpensive, entry) => (
      entry.cost > mostExpensive.cost ? entry : mostExpensive
    )).id;
  }

  const activeStackables = suspendedStackableId
    ? stackables.filter((id) => id !== suspendedStackableId)
    : stackables;
  const suspendedDefinition = suspendedStackableId
    ? getStackableEffectDefinition(suspendedStackableId)
    : null;
  const suspendedCost = suspendedStackableId
    ? stackableCosts.find((entry) => entry.id === suspendedStackableId)?.cost ?? 0
    : 0;

  return Object.freeze({
    level,
    estimatedCost,
    effectiveCost: estimatedCost - suspendedCost,
    density,
    activeStackables: Object.freeze(activeStackables),
    suspendedStackableId,
    suspendedStackableLabel: suspendedDefinition?.label ?? null,
  });
}
