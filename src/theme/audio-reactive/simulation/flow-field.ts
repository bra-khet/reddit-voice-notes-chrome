export interface LayeredFlowFieldOptions {
  /** 0–1; adds finer harmonics without changing the deterministic contract. */
  complexity?: number;
  /** 0–4 temporal multiplier. Zero freezes the field. */
  speed?: number;
  /** Stable phase offset for independently shaped consumers. */
  seed?: number;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function seedPhase(seed: number): number {
  const hashed = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return (hashed - Math.floor(hashed)) * Math.PI * 2;
}

/**
 * CHANGED: Central Pulse introduces one allocation-free, deterministic layered 2D flow sampler.
 * WHY: organic contour motion needs coherent spatial texture that future field-based overlays can reuse.
 */
export function sampleLayeredFlowField(
  x: number,
  y: number,
  timeSeconds: number,
  options: LayeredFlowFieldOptions = {},
): number {
  const safeX = finiteOr(x, 0);
  const safeY = finiteOr(y, 0);
  const safeTime = finiteOr(timeSeconds, 0);
  const complexity = clamp(finiteOr(options.complexity, 0.5), 0, 1);
  const speed = clamp(finiteOr(options.speed, 1), 0, 4);
  const phase = seedPhase(finiteOr(options.seed, 0));
  const frequency = 1.15 + complexity * 2.35;
  const clock = safeTime * speed;

  const primary = Math.sin(
    (safeX * 0.86 + safeY * 0.52) * frequency * Math.PI + clock + phase,
  );
  const cross = Math.sin(
    (-safeX * 0.42 + safeY * 0.91)
      * frequency * (1.45 + complexity * 0.75) * Math.PI
      - clock * 1.31
      + phase * 0.73,
  );
  const detail = Math.sin(
    (safeX + safeY) * frequency * (2.7 + complexity * 2.3) * Math.PI
      + clock * 1.87
      + phase * 1.61,
  );
  // A low-amplitude irrational harmonic supplies light texture without random per-frame pixels.
  const texture = Math.sin(
    safeX * 12.9898 + safeY * 78.233 + phase * 4.1 + clock * 0.37,
  );
  return clamp(
    primary * 0.5
      + cross * 0.3
      + detail * (0.12 + complexity * 0.08)
      + texture * 0.06,
    -1,
    1,
  );
}
