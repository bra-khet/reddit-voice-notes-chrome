import {
  normalizeUserBackgroundLayout,
} from './background-layout';
import type {
  BackgroundImagePosition,
  BackgroundScaleMode,
  NormalizedUserBackgroundLayout,
} from './types';

export const BUNDLED_USER_BACKGROUND_IDS = [
  'bg-bundled-aurora',
  'bg-bundled-warm-glow',
] as const;

export type BundledUserBackgroundId = (typeof BUNDLED_USER_BACKGROUND_IDS)[number];

export interface BundledUserBackgroundDefinition {
  id: BundledUserBackgroundId;
  label: string;
  assetKey: 'aurora' | 'warm-glow';
  assetPath: string;
  width: number;
  height: number;
}

// CHANGED: Phase 4 gives the two existing bundled 16:9 images stable personal-background references.
// WHY: preset Apply must select an image without copying public assets into ImageDB or adding a relay/store.
export const BUNDLED_USER_BACKGROUNDS: readonly BundledUserBackgroundDefinition[] = Object.freeze([
  Object.freeze({
    id: 'bg-bundled-aurora',
    label: 'Aurora',
    assetKey: 'aurora',
    assetPath: 'assets/backgrounds/aurora.svg',
    width: 1280,
    height: 720,
  }),
  Object.freeze({
    id: 'bg-bundled-warm-glow',
    label: 'Warm Glow',
    assetKey: 'warm-glow',
    assetPath: 'assets/backgrounds/warm-glow.svg',
    width: 1280,
    height: 720,
  }),
]);

const bundledBackgroundById = new Map(
  BUNDLED_USER_BACKGROUNDS.map((background) => [background.id, background]),
);

export function isBundledUserBackgroundId(
  value: string | null | undefined,
): value is BundledUserBackgroundId {
  return typeof value === 'string' && bundledBackgroundById.has(value as BundledUserBackgroundId);
}

export function getBundledUserBackground(
  value: string | null | undefined,
): BundledUserBackgroundDefinition | null {
  if (!isBundledUserBackgroundId(value)) return null;
  return bundledBackgroundById.get(value) ?? null;
}

export interface BackgroundLayoutPresetDefinition {
  id: 'aurora-balance' | 'aurora-thirds' | 'warm-focus' | 'warm-wide';
  label: string;
  description: string;
  backgroundId: BundledUserBackgroundId;
  scaleMode: BackgroundScaleMode;
  position: BackgroundImagePosition;
  customPosition: { x: number; y: number };
  manualScale: number;
  dim: number;
}

// CHANGED: presets are small declarative image/layout recipes, separate from Track A visual registries.
// WHY: hover and Apply must resolve the same normalized payload without mutating effects owned by Phase 5.
export const BACKGROUND_LAYOUT_PRESETS: readonly BackgroundLayoutPresetDefinition[] = Object.freeze([
  Object.freeze({
    id: 'aurora-balance',
    label: 'Aurora balance',
    description: 'Centered, calm, and ready for most voices.',
    backgroundId: 'bg-bundled-aurora',
    scaleMode: 'fill',
    position: 'center',
    customPosition: Object.freeze({ x: 0.5, y: 0.5 }),
    manualScale: 1,
    dim: 0.35,
  }),
  Object.freeze({
    id: 'aurora-thirds',
    label: 'Aurora thirds',
    description: 'Moves the cool focal glow onto the left third.',
    backgroundId: 'bg-bundled-aurora',
    scaleMode: 'fill',
    position: 'left',
    customPosition: Object.freeze({ x: 0.33, y: 0.44 }),
    manualScale: 1.16,
    dim: 0.4,
  }),
  Object.freeze({
    id: 'warm-focus',
    label: 'Warm focus',
    description: 'A closer right-third crop with richer contrast.',
    backgroundId: 'bg-bundled-warm-glow',
    scaleMode: 'fill',
    position: 'right',
    customPosition: Object.freeze({ x: 0.68, y: 0.42 }),
    manualScale: 1.18,
    dim: 0.42,
  }),
  Object.freeze({
    id: 'warm-wide',
    label: 'Warm wide',
    description: 'A quieter full-frame treatment with open edges.',
    backgroundId: 'bg-bundled-warm-glow',
    scaleMode: 'fit',
    position: 'center',
    customPosition: Object.freeze({ x: 0.5, y: 0.5 }),
    manualScale: 0.92,
    dim: 0.28,
  }),
]);

export function resolveBackgroundLayoutPreset(
  preset: BackgroundLayoutPresetDefinition,
  current: NormalizedUserBackgroundLayout,
): NormalizedUserBackgroundLayout {
  return normalizeUserBackgroundLayout({
    ...current,
    scaleMode: preset.scaleMode,
    position: preset.position,
    customPosition: preset.customPosition,
    manualScale: preset.manualScale,
    dim: preset.dim,
  });
}
