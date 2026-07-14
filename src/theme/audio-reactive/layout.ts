/**
 * CHANGED: v6 visualizers declare their supported coordinate layout explicitly.
 * WHY: one shared vocabulary prevents presets from inventing incompatible mode strings.
 */
export const LAYOUT_MODES = ['linear', 'radial', 'centered'] as const;

export type LayoutMode = (typeof LAYOUT_MODES)[number];

export function isLayoutMode(value: unknown): value is LayoutMode {
  return typeof value === 'string' && (LAYOUT_MODES as readonly string[]).includes(value);
}
