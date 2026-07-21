export interface StickyAxisState {
  snappedTo: number | null;
}

export interface PositionGuides {
  x: readonly number[];
  y: readonly number[];
}

export interface PositionSnapState {
  x: StickyAxisState;
  y: StickyAxisState;
}

export interface NormalizedBand {
  start: number;
  end: number;
}

export type AxisSnapStrength = number | { x: number; y: number };

const STICKY_RELEASE_MULTIPLIER = 1.75;

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function sliderToScale(t: number, minScale: number, maxScale: number): number {
  const min = Number.isFinite(minScale) && minScale > 0 ? minScale : 1;
  const max = Number.isFinite(maxScale) && maxScale > min ? maxScale : min;
  if (max === min) return min;
  return min * Math.exp(clamp01(t) * Math.log(max / min));
}

export function scaleToSlider(scale: number, minScale: number, maxScale: number): number {
  const min = Number.isFinite(minScale) && minScale > 0 ? minScale : 1;
  const max = Number.isFinite(maxScale) && maxScale > min ? maxScale : min;
  if (max === min) return 0;
  const normalizedScale = Math.min(max, Math.max(min, Number.isFinite(scale) ? scale : min));
  return clamp01(Math.log(normalizedScale / min) / Math.log(max / min));
}

function closestCandidate(raw: number, candidates: readonly number[]): number | null {
  let closest: number | null = null;
  let closestDistance = Infinity;
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate)) continue;
    const normalized = clamp01(candidate);
    const distance = Math.abs(raw - normalized);
    if (distance < closestDistance) {
      closest = normalized;
      closestDistance = distance;
    }
  }
  return closest;
}

export function resolveStickySnap1D(
  rawValue: number,
  candidates: readonly number[],
  strength: number,
  state: StickyAxisState,
): { value: number; snappedTo: number | null } {
  // CHANGED: background magnetism uses the timeline's acquire/hold/release shape in a domain-neutral unit interval.
  // WHY: a wider release threshold prevents guide flicker without importing cue/time concepts into layout controls.
  const raw = clamp01(rawValue);
  const enterStrength = Math.max(0, Number.isFinite(strength) ? strength : 0);
  const held = state.snappedTo;
  if (
    held !== null
    && Number.isFinite(held)
    && Math.abs(raw - held) <= enterStrength * STICKY_RELEASE_MULTIPLIER
  ) {
    return { value: clamp01(held), snappedTo: clamp01(held) };
  }

  const candidate = closestCandidate(raw, candidates);
  if (candidate !== null && Math.abs(raw - candidate) <= enterStrength) {
    return { value: candidate, snappedTo: candidate };
  }
  return { value: raw, snappedTo: null };
}

export function snapPosition(
  position: { x: number; y: number },
  guides: PositionGuides,
  strength: AxisSnapStrength,
  state: PositionSnapState,
): { x: number; y: number; snapped: { x: number | null; y: number | null } } {
  const strengthX = typeof strength === 'number' ? strength : strength.x;
  const strengthY = typeof strength === 'number' ? strength : strength.y;
  const x = resolveStickySnap1D(position.x, guides.x, strengthX, state.x);
  const y = resolveStickySnap1D(position.y, guides.y, strengthY, state.y);
  return {
    x: x.value,
    y: y.value,
    snapped: { x: x.snappedTo, y: y.snappedTo },
  };
}

export function constrainPointOutsideBand(
  value: number,
  band: NormalizedBand,
  padding = 0.035,
): number {
  const start = clamp01(Math.min(band.start, band.end));
  const end = clamp01(Math.max(band.start, band.end));
  const point = clamp01(value);
  if (point < start || point > end) return point;
  const before = clamp01(start - Math.max(0, padding));
  const after = clamp01(end + Math.max(0, padding));
  return Math.abs(point - before) <= Math.abs(point - after) ? before : after;
}
