/**
 * CHANGED: v6 visual preset ids live in one allowlisted catalog.
 * WHY: preferences, the registry, and the future Style panel must agree on stable ids.
 */

export const SPECTRUM_PRESET_IDS = [
  'oscilloscope',
  'minimal',
  'classic-neon',
  'phosphor',
  'radial-spectrum',
  'central-pulse',
] as const;

export type SpectrumPresetId = (typeof SPECTRUM_PRESET_IDS)[number];

export const OVERLAY_PRESET_IDS = [
  'sparkle',
  'bokeh',
  'forest-spirits',
  'digital-rain',
  'inferno',
  'aurora',
  'glitch',
] as const;

export type OverlayPresetId = (typeof OVERLAY_PRESET_IDS)[number];

// CHANGED: the public effect name is centralized separately from its serialized id.
// WHY: `bokeh` remains a stability key, while every current/future picker must say Bubbles.
export const BUBBLES_OVERLAY_LABEL = 'Bubbles' as const;

export const STACKABLE_EFFECT_IDS = [
  'ember',
  'electric-arc',
  'lightning',
  'conway',
  'smoke',
  'neon-glow',
  'particle-burst',
] as const;

export type StackableEffectId = (typeof STACKABLE_EFFECT_IDS)[number];

export const MAX_STACKABLE_EFFECTS = 3;

function includesId<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

export function isSpectrumPresetId(value: unknown): value is SpectrumPresetId {
  return includesId(SPECTRUM_PRESET_IDS, value);
}

export function isOverlayPresetId(value: unknown): value is OverlayPresetId {
  return includesId(OVERLAY_PRESET_IDS, value);
}

export function isStackableEffectId(value: unknown): value is StackableEffectId {
  return includesId(STACKABLE_EFFECT_IDS, value);
}
