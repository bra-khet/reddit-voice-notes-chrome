import type {
  AudioVisualRenderEnvironment,
  AudioVizFrame,
  LayoutMode,
  StackableEffect,
  StackableEffectDefinition,
  VisualizerParams,
} from '@/src/theme/audio-reactive';
import {
  colorWithAlpha,
  mixVisualColors,
  resolveVisualPalette,
} from '../palette';

export const NEON_GLOW_ID = 'neon-glow' as const;
export const NEON_GLOW_LABEL = 'Neon Glow' as const;
export const NEON_GLOW_MIN_TUBES = 3;
export const NEON_GLOW_MAX_TUBES = 7;
export const NEON_GLOW_POINTS_PER_TUBE = 18;
export const NEON_GLOW_PULSES_PER_TUBE = 2;
export const NEON_GLOW_MAX_GEOMETRY_POINTS = (
  NEON_GLOW_MAX_TUBES * NEON_GLOW_POINTS_PER_TUBE
);
/** Three tube strokes plus two halo/core charge pairs per tube. */
export const NEON_GLOW_MAX_ELEMENTS = NEON_GLOW_MAX_TUBES * (
  3 + NEON_GLOW_PULSES_PER_TUBE * 2
);

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function seededUnit(index: number, salt: number): number {
  const value = Math.sin(index * 79.113 + salt * 23.719) * 43758.5453;
  return value - Math.floor(value);
}

function resolveLayout(params: VisualizerParams): LayoutMode {
  return params.layoutMode === 'centered' || params.layoutMode === 'radial'
    ? params.layoutMode
    : 'linear';
}

export function resolveNeonGlowTubeLimit(density: number): number {
  return Math.round(
    NEON_GLOW_MIN_TUBES
      + clamp01(density) * (NEON_GLOW_MAX_TUBES - NEON_GLOW_MIN_TUBES),
  );
}

function bandWeight(params: VisualizerParams, bandIndex: number): number {
  if (bandIndex < 10) return params.bassWeight ?? 1;
  if (bandIndex < 22) return params.midWeight ?? 1;
  return params.trebleWeight ?? 1;
}

function weightedBandAverage(
  frame: AudioVizFrame,
  start: number,
  end: number,
  weight: number | undefined,
): number {
  let total = 0;
  let count = 0;
  for (let index = start; index < Math.min(end, frame.bands.length); index += 1) {
    total += clamp01(frame.bands[index] ?? 0);
    count += 1;
  }
  return clamp01(count > 0 ? total / count * (weight ?? 1) : 0);
}

function paletteColorAt(palette: readonly string[], amount: number): string {
  if (palette.length === 1) return palette[0] ?? '#ffffff';
  const position = clamp01(amount) * (palette.length - 1);
  const left = Math.min(palette.length - 1, Math.floor(position));
  const right = Math.min(palette.length - 1, left + 1);
  return mixVisualColors(
    palette[left] ?? '#ffffff',
    palette[right] ?? palette[left] ?? '#ffffff',
    position - left,
  );
}

function signedPower(value: number, power: number): number {
  return Math.sign(value) * Math.pow(Math.abs(value), power);
}

/**
 * CHANGED: Neon Glow is a bounded field of continuous sign-tubes and travelling charge knots.
 * WHY: the stackable should add atmospheric luminous geometry without reproducing Classic's bars.
 */
class NeonGlowEffect implements StackableEffect {
  readonly id = NEON_GLOW_ID;

  private readonly pointX = new Float32Array(NEON_GLOW_MAX_GEOMETRY_POINTS);
  private readonly pointY = new Float32Array(NEON_GLOW_MAX_GEOMETRY_POINTS);
  private readonly smoothedLevels = new Float32Array(NEON_GLOW_MAX_TUBES);
  private readonly pulsePhase = new Float32Array(
    NEON_GLOW_MAX_TUBES * NEON_GLOW_PULSES_PER_TUBE,
  );

  private pendingDt = 0;
  private tubeLimit = NEON_GLOW_MIN_TUBES;
  private layout: LayoutMode = 'linear';
  private drive = 0;
  private bassDrive = 0;
  private midDrive = 0;
  private trebleDrive = 0;
  private transientGlow = 0;
  private initialized = false;

  constructor() {
    for (let index = 0; index < this.pulsePhase.length; index += 1) {
      this.pulsePhase[index] = seededUnit(index, 11);
    }
  }

  update(_frame: AudioVizFrame, dt: number): void {
    this.pendingDt = Math.min(0.1, Math.max(0, Number.isFinite(dt) ? dt : 0));
  }

  render(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    frame: AudioVizFrame,
    params: VisualizerParams,
    environment?: AudioVisualRenderEnvironment,
  ): void {
    this.layout = resolveLayout(params);
    this.tubeLimit = resolveNeonGlowTubeLimit(params.density);
    const reduceMotion = environment?.reduceMotion === true;
    this.resolveAudio(frame, params, environment, reduceMotion);
    this.advanceState(frame, params, reduceMotion);

    if (this.drive <= 0.008 && this.transientGlow <= 0.01 && !this.hasVisibleLevel()) {
      this.pendingDt = 0;
      return;
    }

    const time = reduceMotion ? 0 : frame.timeMs / 1000;
    const palette = resolveVisualPalette(params.color);
    const minDimension = Math.max(24, Math.min(canvas.width, canvas.height));
    const closed = this.layout !== 'linear';

    ctx.save();
    ctx.globalCompositeOperation = params.highContrast === true ? 'source-over' : 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let tubeIndex = 0; tubeIndex < this.tubeLimit; tubeIndex += 1) {
      this.buildGeometry(tubeIndex, canvas, time);
      const level = this.smoothedLevels[tubeIndex] ?? 0;
      const color = paletteColorAt(
        palette,
        (tubeIndex + 0.35 + level * 0.45) / Math.max(1, this.tubeLimit),
      );
      this.drawTube(ctx, tubeIndex, color, level, params, minDimension, closed);
      this.drawChargeKnots(
        ctx,
        tubeIndex,
        color,
        level,
        params,
        minDimension,
        closed,
        reduceMotion,
      );
    }
    ctx.restore();
    this.pendingDt = 0;
  }

  getPerformanceCost(): number {
    return this.tubeLimit * (3 + NEON_GLOW_PULSES_PER_TUBE * 2);
  }

  private resolveAudio(
    frame: AudioVizFrame,
    params: VisualizerParams,
    environment: AudioVisualRenderEnvironment | undefined,
    reduceMotion: boolean,
  ): void {
    this.bassDrive = weightedBandAverage(frame, 0, 10, params.bassWeight);
    this.midDrive = weightedBandAverage(frame, 10, 22, params.midWeight);
    this.trebleDrive = weightedBandAverage(frame, 22, 32, params.trebleWeight);
    const previewLift = environment?.amplitudeMode === 'preview'
      ? reduceMotion
        ? 0.12
        : 0.12 + Math.sin(frame.timeMs / 1000 * 0.39) * 0.018
      : 0;
    const sensitivity = 0.55 + clamp01(params.sensitivity) * 1.45;
    this.drive = clamp01(
      (clamp01(frame.energy) * 0.23
        + this.bassDrive * 0.17
        + this.midDrive * 0.34
        + this.trebleDrive * 0.26
        + previewLift)
      * sensitivity,
    );
  }

  private advanceState(
    frame: AudioVizFrame,
    params: VisualizerParams,
    reduceMotion: boolean,
  ): void {
    // CHANGED: snappier level follow (6→7.5 base) and a hotter per-tube gain
    //          (0.78+s·0.98 → 0.85+s·1.05), the second small reactivity bump (Pass C).
    // WHY: QA asked for a bit more reactivity from the tubes (§4a neon-glow).
    const follow = this.initialized && !reduceMotion
      ? 1 - Math.exp(-this.pendingDt * (7.5 + (1 - clamp01(params.smoothing)) * 16))
      : 1;
    const sensitivity = 0.85 + clamp01(params.sensitivity) * 1.05;

    for (let tubeIndex = 0; tubeIndex < NEON_GLOW_MAX_TUBES; tubeIndex += 1) {
      if (tubeIndex >= this.tubeLimit) {
        this.smoothedLevels[tubeIndex] = 0;
        continue;
      }
      const centerBand = Math.min(
        31,
        Math.floor((tubeIndex + 0.5) / Math.max(1, this.tubeLimit) * 32),
      );
      let local = 0;
      let sampleWeight = 0;
      for (let offset = -2; offset <= 2; offset += 1) {
        const bandIndex = Math.min(31, Math.max(0, centerBand + offset));
        const proximity = 3 - Math.abs(offset);
        local += clamp01(frame.bands[bandIndex] ?? 0)
          * bandWeight(params, bandIndex)
          * proximity;
        sampleWeight += proximity;
      }
      const target = clamp01(
        (local / Math.max(1, sampleWeight) * 0.62 + this.drive * 0.38) * sensitivity,
      );
      const current = this.smoothedLevels[tubeIndex] ?? 0;
      this.smoothedLevels[tubeIndex] = current + (target - current) * follow;
    }

    if (reduceMotion) {
      this.transientGlow = 0;
    } else if (frame.transient) {
      // CHANGED: a transient surges existing tube cores and charge knots without spawning geometry.
      // WHY: vocal attacks should flash immediately while the hard state and paint ceilings remain fixed.
      this.transientGlow = 1;
    } else {
      this.transientGlow *= Math.exp(-this.pendingDt * 5.8);
    }

    if (!reduceMotion && this.pendingDt > 0) {
      const speed = 0.035 + this.drive * 0.09 + this.trebleDrive * 0.055;
      for (let index = 0; index < this.pulsePhase.length; index += 1) {
        this.pulsePhase[index] = (this.pulsePhase[index] + this.pendingDt * speed
          * (0.82 + seededUnit(index, 19) * 0.42)) % 1;
      }
    }
    this.initialized = true;
  }

  private hasVisibleLevel(): boolean {
    for (let index = 0; index < this.tubeLimit; index += 1) {
      if ((this.smoothedLevels[index] ?? 0) > 0.008) return true;
    }
    return false;
  }

  private buildGeometry(
    tubeIndex: number,
    canvas: HTMLCanvasElement,
    time: number,
  ): void {
    if (this.layout === 'centered') {
      this.buildCenteredGeometry(tubeIndex, canvas, time);
      return;
    }
    if (this.layout === 'radial') {
      this.buildRadialGeometry(tubeIndex, canvas, time);
      return;
    }
    this.buildLinearGeometry(tubeIndex, canvas, time);
  }

  private buildLinearGeometry(
    tubeIndex: number,
    canvas: HTMLCanvasElement,
    time: number,
  ): void {
    const level = this.smoothedLevels[tubeIndex] ?? 0;
    const minDimension = Math.max(24, Math.min(canvas.width, canvas.height));
    const lane = (tubeIndex + 0.5) / Math.max(1, this.tubeLimit);
    const baseY = canvas.height * (0.16 + lane * 0.68);
    const phase = seededUnit(tubeIndex, 29) * Math.PI * 2;
    const amplitude = minDimension * (0.012 + level * 0.055 + this.transientGlow * 0.012);
    const margin = canvas.width * 0.055;

    for (let pointIndex = 0; pointIndex < NEON_GLOW_POINTS_PER_TUBE; pointIndex += 1) {
      const unit = pointIndex / (NEON_GLOW_POINTS_PER_TUBE - 1);
      const edgeEnvelope = Math.sin(unit * Math.PI);
      const wave = Math.sin(unit * Math.PI * (2.4 + tubeIndex * 0.22) + phase + time * 0.54)
        + Math.sin(unit * Math.PI * 5.2 - phase * 0.7 - time * 0.31) * 0.32;
      const slot = tubeIndex * NEON_GLOW_POINTS_PER_TUBE + pointIndex;
      this.pointX[slot] = margin + unit * (canvas.width - margin * 2)
        + Math.sin(unit * Math.PI * 2 + phase) * minDimension * 0.008 * edgeEnvelope;
      this.pointY[slot] = baseY + wave * amplitude * edgeEnvelope;
    }
  }

  private buildCenteredGeometry(
    tubeIndex: number,
    canvas: HTMLCanvasElement,
    time: number,
  ): void {
    const level = this.smoothedLevels[tubeIndex] ?? 0;
    const minDimension = Math.max(24, Math.min(canvas.width, canvas.height));
    const nesting = (tubeIndex + 1) / (this.tubeLimit + 1);
    const radiusX = minDimension * (0.15 + nesting * 0.36);
    const radiusY = minDimension * (0.09 + nesting * 0.24);
    const phase = seededUnit(tubeIndex, 31) * Math.PI * 2;

    for (let pointIndex = 0; pointIndex < NEON_GLOW_POINTS_PER_TUBE; pointIndex += 1) {
      const angle = pointIndex / NEON_GLOW_POINTS_PER_TUBE * Math.PI * 2;
      const ripple = 1 + Math.sin(angle * 3 + phase + time * 0.42)
        * (0.012 + level * 0.045 + this.transientGlow * 0.012);
      const slot = tubeIndex * NEON_GLOW_POINTS_PER_TUBE + pointIndex;
      this.pointX[slot] = canvas.width / 2
        + signedPower(Math.cos(angle), 0.42) * radiusX * ripple;
      this.pointY[slot] = canvas.height / 2
        + signedPower(Math.sin(angle), 0.42) * radiusY * ripple;
    }
  }

  private buildRadialGeometry(
    tubeIndex: number,
    canvas: HTMLCanvasElement,
    time: number,
  ): void {
    const level = this.smoothedLevels[tubeIndex] ?? 0;
    const minDimension = Math.max(24, Math.min(canvas.width, canvas.height));
    const radius = minDimension * (0.13 + (tubeIndex + 1) * 0.047);
    const phase = seededUnit(tubeIndex, 37) * Math.PI * 2;
    const rotation = time * (0.09 + tubeIndex * 0.012);

    for (let pointIndex = 0; pointIndex < NEON_GLOW_POINTS_PER_TUBE; pointIndex += 1) {
      const unit = pointIndex / NEON_GLOW_POINTS_PER_TUBE;
      const angle = unit * Math.PI * 2 + rotation;
      const ripple = Math.sin(angle * (4 + tubeIndex % 3) + phase - time * 0.48)
        * minDimension * (0.006 + level * 0.023 + this.transientGlow * 0.006);
      const slot = tubeIndex * NEON_GLOW_POINTS_PER_TUBE + pointIndex;
      this.pointX[slot] = canvas.width / 2 + Math.cos(angle) * (radius + ripple);
      this.pointY[slot] = canvas.height / 2 + Math.sin(angle) * (radius + ripple);
    }
  }

  private traceTube(
    ctx: CanvasRenderingContext2D,
    tubeIndex: number,
    closed: boolean,
  ): void {
    const start = tubeIndex * NEON_GLOW_POINTS_PER_TUBE;
    ctx.beginPath();
    if (closed) {
      const last = start + NEON_GLOW_POINTS_PER_TUBE - 1;
      ctx.moveTo(
        ((this.pointX[last] ?? 0) + (this.pointX[start] ?? 0)) / 2,
        ((this.pointY[last] ?? 0) + (this.pointY[start] ?? 0)) / 2,
      );
      for (let pointIndex = 0; pointIndex < NEON_GLOW_POINTS_PER_TUBE; pointIndex += 1) {
        const current = start + pointIndex;
        const next = start + ((pointIndex + 1) % NEON_GLOW_POINTS_PER_TUBE);
        ctx.quadraticCurveTo(
          this.pointX[current] ?? 0,
          this.pointY[current] ?? 0,
          ((this.pointX[current] ?? 0) + (this.pointX[next] ?? 0)) / 2,
          ((this.pointY[current] ?? 0) + (this.pointY[next] ?? 0)) / 2,
        );
      }
      ctx.closePath();
      return;
    }

    ctx.moveTo(this.pointX[start] ?? 0, this.pointY[start] ?? 0);
    for (let pointIndex = 1; pointIndex < NEON_GLOW_POINTS_PER_TUBE - 1; pointIndex += 1) {
      const current = start + pointIndex;
      const next = current + 1;
      ctx.quadraticCurveTo(
        this.pointX[current] ?? 0,
        this.pointY[current] ?? 0,
        ((this.pointX[current] ?? 0) + (this.pointX[next] ?? 0)) / 2,
        ((this.pointY[current] ?? 0) + (this.pointY[next] ?? 0)) / 2,
      );
    }
    const last = start + NEON_GLOW_POINTS_PER_TUBE - 1;
    ctx.lineTo(this.pointX[last] ?? 0, this.pointY[last] ?? 0);
  }

  private drawTube(
    ctx: CanvasRenderingContext2D,
    tubeIndex: number,
    color: string,
    level: number,
    params: VisualizerParams,
    minDimension: number,
    closed: boolean,
  ): void {
    const highContrast = params.highContrast === true;
    const intensity = 0.58 + clamp01(params.intensity) * 0.72;
    const surge = 1 + this.transientGlow * 0.32;
    const tubeWidth = Math.max(1.15, minDimension * 0.0042 * (0.8 + level * 0.65));

    this.traceTube(ctx, tubeIndex, closed);
    ctx.strokeStyle = highContrast
      ? colorWithAlpha(mixVisualColors(color, '#020617', 0.76), 0.92)
      : colorWithAlpha(color, (0.12 + level * 0.16) * intensity);
    ctx.lineWidth = tubeWidth * (highContrast ? 3.4 : 5.6) * surge;
    ctx.shadowColor = highContrast ? 'transparent' : color;
    ctx.shadowBlur = highContrast ? 0 : minDimension * (0.025 + level * 0.035) * surge;
    ctx.stroke();

    this.traceTube(ctx, tubeIndex, closed);
    ctx.strokeStyle = colorWithAlpha(color, (0.48 + level * 0.42) * intensity);
    ctx.lineWidth = tubeWidth * (highContrast ? 2.05 : 2.35) * surge;
    ctx.shadowBlur = highContrast ? 0 : minDimension * 0.009 * surge;
    ctx.stroke();

    this.traceTube(ctx, tubeIndex, closed);
    ctx.strokeStyle = colorWithAlpha(
      mixVisualColors(color, '#ffffff', highContrast ? 0.48 : 0.72),
      clamp01((0.7 + level * 0.3) * intensity),
    );
    ctx.lineWidth = Math.max(0.7, tubeWidth * (highContrast ? 0.92 : 0.62));
    ctx.shadowColor = highContrast ? 'transparent' : '#ffffff';
    ctx.shadowBlur = highContrast ? 0 : minDimension * 0.004;
    ctx.stroke();
  }

  private drawChargeKnots(
    ctx: CanvasRenderingContext2D,
    tubeIndex: number,
    color: string,
    level: number,
    params: VisualizerParams,
    minDimension: number,
    closed: boolean,
    reduceMotion: boolean,
  ): void {
    const highContrast = params.highContrast === true;
    const start = tubeIndex * NEON_GLOW_POINTS_PER_TUBE;
    const intensity = 0.62 + clamp01(params.intensity) * 0.62;

    for (let pulseIndex = 0; pulseIndex < NEON_GLOW_PULSES_PER_TUBE; pulseIndex += 1) {
      const pulseSlot = tubeIndex * NEON_GLOW_PULSES_PER_TUBE + pulseIndex;
      const rawPosition = reduceMotion
        ? seededUnit(pulseSlot, 43)
        : (this.pulsePhase[pulseSlot] ?? 0);
      const position = closed ? rawPosition : 0.06 + rawPosition * 0.88;
      const scaled = position * (closed
        ? NEON_GLOW_POINTS_PER_TUBE
        : NEON_GLOW_POINTS_PER_TUBE - 1);
      const pointIndex = Math.min(
        NEON_GLOW_POINTS_PER_TUBE - (closed ? 1 : 2),
        Math.floor(scaled),
      );
      const nextIndex = closed
        ? (pointIndex + 1) % NEON_GLOW_POINTS_PER_TUBE
        : pointIndex + 1;
      const mix = scaled - Math.floor(scaled);
      const from = start + pointIndex;
      const to = start + nextIndex;
      const x = (this.pointX[from] ?? 0) + ((this.pointX[to] ?? 0) - (this.pointX[from] ?? 0)) * mix;
      const y = (this.pointY[from] ?? 0) + ((this.pointY[to] ?? 0) - (this.pointY[from] ?? 0)) * mix;
      const radius = Math.max(
        1.2,
        minDimension * (0.005 + level * 0.004 + this.transientGlow * 0.003),
      );

      ctx.beginPath();
      ctx.arc(x, y, radius * (highContrast ? 1.65 : 2.7), 0, Math.PI * 2);
      ctx.fillStyle = highContrast
        ? colorWithAlpha(mixVisualColors(color, '#020617', 0.7), 0.9)
        : colorWithAlpha(color, clamp01((0.14 + level * 0.2) * intensity));
      ctx.shadowColor = highContrast ? 'transparent' : color;
      ctx.shadowBlur = highContrast ? 0 : radius * 3.8;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(x, y, radius * (highContrast ? 0.78 : 0.58), 0, Math.PI * 2);
      ctx.fillStyle = colorWithAlpha(
        mixVisualColors(color, '#ffffff', 0.82),
        clamp01((0.76 + level * 0.24) * intensity),
      );
      ctx.shadowColor = highContrast ? 'transparent' : '#ffffff';
      ctx.shadowBlur = highContrast ? 0 : radius * 1.4;
      ctx.fill();
    }
  }
}

export const NEON_GLOW_EFFECT_DEFINITION: StackableEffectDefinition = Object.freeze({
  id: NEON_GLOW_ID,
  label: NEON_GLOW_LABEL,
  maxElements: NEON_GLOW_MAX_ELEMENTS,
  defaultParams: Object.freeze({
    sensitivity: 0.7,
    intensity: 0.76,
    smoothing: 0.54,
    density: 0.56,
    color: Object.freeze(['#00f5ff', '#6c63ff', '#d946ef', '#ff4ecd']),
  }),
  create: () => new NeonGlowEffect(),
});
