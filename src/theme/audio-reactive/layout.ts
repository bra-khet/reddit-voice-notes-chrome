/**
 * CHANGED: v6 visualizers declare their supported coordinate layout explicitly.
 * WHY: one shared vocabulary prevents presets from inventing incompatible mode strings.
 */
export const LAYOUT_MODES = ['linear', 'radial', 'centered'] as const;

export type LayoutMode = (typeof LAYOUT_MODES)[number];

export interface CartesianPoint {
  x: number;
  y: number;
}

export interface RadialSegmentPoint extends CartesianPoint {
  angle: number;
}

export function isLayoutMode(value: unknown): value is LayoutMode {
  return typeof value === 'string' && (LAYOUT_MODES as readonly string[]).includes(value);
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/** Convert one polar coordinate into the canvas coordinate system. */
export function polarToCartesian(
  centerX: number,
  centerY: number,
  radius: number,
  angle: number,
): CartesianPoint {
  const safeCenterX = finiteOr(centerX, 0);
  const safeCenterY = finiteOr(centerY, 0);
  const safeRadius = Math.max(0, finiteOr(radius, 0));
  const safeAngle = finiteOr(angle, 0);
  return {
    x: safeCenterX + Math.cos(safeAngle) * safeRadius,
    y: safeCenterY + Math.sin(safeAngle) * safeRadius,
  };
}

/**
 * CHANGED: non-linear presets can map a wrapped element index onto an evenly spaced ring.
 * WHY: Radial Spectrum needs one tested polar convention shared by its inner, outer, and trail points.
 */
export function mapRadialSegment(
  index: number,
  count: number,
  centerX: number,
  centerY: number,
  radius: number,
  startAngle = -Math.PI / 2,
): RadialSegmentPoint {
  const safeCount = Math.max(1, Math.floor(finiteOr(count, 1)));
  const integerIndex = Math.floor(finiteOr(index, 0));
  const wrappedIndex = ((integerIndex % safeCount) + safeCount) % safeCount;
  const angle = finiteOr(startAngle, -Math.PI / 2) + wrappedIndex * Math.PI * 2 / safeCount;
  return {
    ...polarToCartesian(centerX, centerY, radius, angle),
    angle,
  };
}

/** Resolve a canvas-centered origin with a bounded vertical composition bias. */
export function resolveCenteredOrigin(
  width: number,
  height: number,
  verticalBias = 0,
): CartesianPoint {
  const safeWidth = Math.max(0, finiteOr(width, 0));
  const safeHeight = Math.max(0, finiteOr(height, 0));
  const safeBias = Math.min(1, Math.max(-1, finiteOr(verticalBias, 0)));
  return {
    x: safeWidth / 2,
    y: safeHeight / 2 + safeHeight * safeBias / 2,
  };
}

/**
 * CHANGED: centered contours add a guarded radial displacement at one shared coordinate seam.
 * WHY: Central Pulse needs a closed organic outline without duplicating polar math or negative-radius guards.
 */
export function mapCenteredContourPoint(
  index: number,
  count: number,
  centerX: number,
  centerY: number,
  baseRadius: number,
  displacement = 0,
  startAngle = -Math.PI / 2,
): RadialSegmentPoint {
  const radius = Math.max(0, finiteOr(baseRadius, 0) + finiteOr(displacement, 0));
  return mapRadialSegment(index, count, centerX, centerY, radius, startAngle);
}
