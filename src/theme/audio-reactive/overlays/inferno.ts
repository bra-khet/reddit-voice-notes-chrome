import type {
  AudioVisual,
  AudioVisualDefinition,
  AudioVisualRenderEnvironment,
  AudioVizFrame,
  BoundedParticle,
  BoundedParticleInitializer,
  LayeredFlowFieldOptions,
  LayoutMode,
  VisualizerParams,
} from '@/src/theme/audio-reactive';
import {
  BoundedParticleEmitter,
  sampleLayeredVectorFlowField,
} from '@/src/theme/audio-reactive';
import {
  colorWithAlpha,
  mixVisualColors,
  resolveVisualPalette,
} from '../palette';

export const INFERNO_ID = 'inferno' as const;
export const INFERNO_LABEL = 'Inferno' as const;
/** Contextual Style-panel label for Inferno's High Contrast treatment. */
export const VOID_INFERNO_LABEL = 'Void Inferno' as const;
export const INFERNO_MIN_PARTICLES = 28;
export const INFERNO_MAX_PARTICLES = 72;
/** Sampled columns of the smoothed flame-front height/radius field. */
export const INFERNO_FRONT_SAMPLES = 25;
/** Three bounded paint passes per particle plus hearth (2) and layered flame front (4) accents. */
export const INFERNO_MAX_ELEMENTS = INFERNO_MAX_PARTICLES * 3 + 6;

export type InfernoVariant = 'inferno' | 'void-inferno';

type InfernoParticleKind = 'flame' | 'ember' | 'smoke';

interface InfernoParticle extends BoundedParticle {
  index: number;
  kind: InfernoParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  phase: number;
  heat: number;
  drift: number;
}

const VOID_INFERNO_PALETTE = Object.freeze([
  '#05020b',
  '#190834',
  '#5b21b6',
  '#22d3ee',
  '#f8fafc',
]);

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function seededUnit(index: number, salt: number): number {
  const value = Math.sin(index * 78.233 + salt * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * CHANGED: deterministic lattice value noise, smoothstep-interpolated in space AND time,
 * optionally periodic in space so the radial ring has no seam.
 * WHY: the crest was undulating on a sum of sines, which pulses on fixed audible periods
 *      (QA Pass C §3e); scrolling value noise never repeats, which is what makes fire
 *      read as organic instead of mechanical.
 */
function latticeNoise(x: number, t: number, seed: number, wrap: number): number {
  const xIndex = Math.floor(x);
  const tIndex = Math.floor(t);
  const xFraction = x - xIndex;
  const tFraction = t - tIndex;
  const xSmooth = xFraction * xFraction * (3 - 2 * xFraction);
  const tSmooth = tFraction * tFraction * (3 - 2 * tFraction);
  const lattice = (dx: number, dt: number): number => {
    const rawX = xIndex + dx;
    const wrappedX = wrap > 0 ? ((rawX % wrap) + wrap) % wrap : rawX;
    return seededUnit(wrappedX + (tIndex + dt) * 57.31, seed);
  };
  const bottom = lattice(0, 0) + (lattice(1, 0) - lattice(0, 0)) * xSmooth;
  const top = lattice(0, 1) + (lattice(1, 1) - lattice(0, 1)) * xSmooth;
  return bottom + (top - bottom) * tSmooth;
}

function resolveLayout(params: VisualizerParams): LayoutMode {
  return params.layoutMode === 'centered' || params.layoutMode === 'radial'
    ? params.layoutMode
    : 'linear';
}

export function resolveInfernoParticleLimit(density: number): number {
  return Math.round(
    INFERNO_MIN_PARTICLES
      + clamp01(density) * (INFERNO_MAX_PARTICLES - INFERNO_MIN_PARTICLES),
  );
}

/** Inferno's accessibility treatment is intentionally the product's named Void variant. */
export function resolveInfernoVariant(params: Pick<VisualizerParams, 'highContrast'>): InfernoVariant {
  return params.highContrast === true ? 'void-inferno' : 'inferno';
}

function weightedBandAt(
  frame: AudioVizFrame,
  index: number,
  params: VisualizerParams,
): number {
  const bandIndex = Math.min(frame.bands.length - 1, Math.max(0, Math.floor(index)));
  const band = clamp01(frame.bands[bandIndex] ?? 0);
  const normalized = bandIndex / Math.max(1, frame.bands.length - 1);
  const weight = normalized < 1 / 3
    ? params.bassWeight ?? 1
    : normalized < 2 / 3
      ? params.midWeight ?? 1
      : params.trebleWeight ?? 1;
  return clamp01(band * weight);
}

/** Linear interpolation between adjacent weighted bands for smooth cross-canvas sampling. */
function weightedBandAtUnit(
  frame: AudioVizFrame,
  unit: number,
  params: VisualizerParams,
): number {
  const position = clamp01(unit) * (frame.bands.length - 1);
  const left = Math.floor(position);
  const leftBand = weightedBandAt(frame, left, params);
  const rightBand = weightedBandAt(frame, left + 1, params);
  return leftBand + (rightBand - leftBand) * (position - left);
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

/**
 * CHANGED: Inferno is a registry-native, audio-weighted fire/smoke/spark simulation with a Void treatment.
 * WHY: v6 needs a convincing bounded fire family that shares capture/preview state instead of a decorative loop.
 */
class InfernoVisual implements AudioVisual {
  readonly id = INFERNO_ID;
  readonly kind = 'overlay' as const;
  readonly supportedLayouts = Object.freeze(['linear', 'centered', 'radial'] as const);

  private readonly emitter = new BoundedParticleEmitter<InfernoParticle>(
    INFERNO_MAX_PARTICLES,
    (index) => ({
      index,
      active: false,
      age: 0,
      lifetime: 1,
      kind: 'flame',
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      size: 1,
      phase: 0,
      heat: 0,
      drift: 0,
    }),
  );
  private readonly flowVector = { x: 0, y: -1 };
  private readonly flowOptions: LayeredFlowFieldOptions = {
    complexity: 0.5,
    speed: 0.5,
    seed: 61,
  };
  private readonly reducedParticle: InfernoParticle = {
    index: 0,
    active: true,
    age: 0,
    lifetime: 1,
    kind: 'flame',
    x: 0,
    y: 0,
    vx: 0,
    vy: -1,
    size: 1,
    phase: 0,
    heat: 1,
    drift: 0,
  };

  private pendingDt = 0;
  private emissionCarry = 0;
  private spawnSerial = 0;
  private canvasWidth = 0;
  private canvasHeight = 0;
  private layout: LayoutMode = 'linear';
  private drive = 0;
  private bassDrive = 0;
  private midDrive = 0;
  private trebleDrive = 0;
  private sensitivity = 1;
  private priming = false;
  private wasReducedMotion = false;
  /** Smoothed flame-front field: crest heights (linear/centered) or ring radii (radial). */
  private readonly frontField = new Float32Array(INFERNO_FRONT_SAMPLES);
  private readonly reducedFrontField = new Float32Array(INFERNO_FRONT_SAMPLES);
  /** Per-sample refractory timers so one flare cannot machine-gun licks frame after frame. */
  private readonly peakCooldown = new Float32Array(INFERNO_FRONT_SAMPLES);
  /** Shared flare-noise channel: bulges the bright core layer AND gates lick emission. */
  private readonly flareField = new Float32Array(INFERNO_FRONT_SAMPLES);
  /** Scratch for the per-layer noise-masked silhouettes (computed, traced, then reused). */
  private readonly layerField = new Float32Array(INFERNO_FRONT_SAMPLES);
  private frontTime = 0;
  private frontPrimed = false;
  private lickSpawnX = 0;
  private lickSpawnY = 0;
  private lickSpawnVx = 0;
  private lickSpawnVy = 0;

  private readonly initializeParticle: BoundedParticleInitializer<InfernoParticle> = (
    particle,
    _index,
    _recycled,
  ) => {
    const serial = this.spawnSerial;
    this.spawnSerial += 1;
    const source = seededUnit(serial, 3);
    const texture = seededUnit(serial, 11);
    // CHANGED: the hearth's kind mix now favors smoke/embers (flames mostly come from
    //          the crest peaks); the lower total rate keeps smoke/ember flux roughly level.
    const kind: InfernoParticleKind = serial % 5 === 0
      ? 'smoke'
      : serial % 4 === 1
        ? 'ember'
        : 'flame';
    const minDimension = Math.max(24, Math.min(this.canvasWidth, this.canvasHeight));
    const intensity = 0.72 + this.drive * 0.72;
    // CHANGED: squared size texture gives a natural few-large/many-small tongue distribution.
    // WHY: near-uniform sizes read as confetti; real fire is a handful of dominant licks over small ones.
    const bulk = 0.55 + seededUnit(serial, 41) ** 2 * 1.6;

    particle.kind = kind;
    particle.phase = seededUnit(serial, 17) * Math.PI * 2;
    particle.heat = clamp01(0.55 + this.drive * 0.4 + texture * 0.18);
    particle.drift = (seededUnit(serial, 23) - 0.5) * 2;
    particle.size = minDimension * (
      kind === 'smoke'
        ? 0.02 + texture * 0.02
        : kind === 'ember'
          ? 0.0028 + texture * 0.0035
          : (0.009 + texture * 0.01) * bulk
    ) * intensity;
    particle.lifetime = kind === 'smoke'
      ? 1.9 + texture * 1.6
      : kind === 'ember'
        ? 0.75 + texture * 0.95
        : 0.62 + texture * 0.92;

    if (this.layout === 'radial') {
      const angle = source * Math.PI * 2;
      const radius = minDimension * (0.07 + seededUnit(serial, 29) * 0.035);
      const speed = (kind === 'smoke' ? 16 : kind === 'ember' ? 84 : 46)
        * (0.7 + this.drive * 1.05);
      particle.x = this.canvasWidth / 2 + Math.cos(angle) * radius;
      particle.y = this.canvasHeight / 2 + Math.sin(angle) * radius;
      particle.vx = Math.cos(angle) * speed + particle.drift * 8;
      particle.vy = Math.sin(angle) * speed + particle.drift * 5;
    } else {
      const spread = this.layout === 'centered'
        ? (source - 0.5) * (0.18 + this.bassDrive * 0.22)
        : source - 0.5;
      particle.x = this.canvasWidth * (0.5 + spread * (this.layout === 'centered' ? 1 : 0.92));
      particle.y = this.canvasHeight * (0.93 + seededUnit(serial, 31) * 0.04);
      const speed = (kind === 'smoke' ? 18 : kind === 'ember' ? 98 : 52)
        * (0.66 + this.drive * 1.08);
      particle.vx = particle.drift * (kind === 'smoke' ? 7 : 15 + this.midDrive * 17);
      particle.vy = -speed;
    }

    if (this.priming) {
      const progress = seededUnit(serial, 37) * (kind === 'smoke' ? 0.54 : 0.72);
      particle.age = particle.lifetime * progress;
      particle.x += particle.vx * particle.age * 0.58;
      particle.y += particle.vy * particle.age * 0.58;
    }
  };

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
    const layout = resolveLayout(params);
    const geometryChanged = canvas.width !== this.canvasWidth
      || canvas.height !== this.canvasHeight
      || layout !== this.layout;
    if (geometryChanged) {
      this.canvasWidth = Math.max(1, canvas.width);
      this.canvasHeight = Math.max(1, canvas.height);
      this.layout = layout;
      this.resetParticles();
    }

    const particleLimit = this.emitter.configureLimit(resolveInfernoParticleLimit(params.density));
    const reduceMotion = environment?.reduceMotion === true;
    if (reduceMotion !== this.wasReducedMotion) {
      this.resetParticles();
      this.wasReducedMotion = reduceMotion;
    }

    this.resolveAudioDrive(frame, params, environment, reduceMotion);
    const variant = resolveInfernoVariant(params);
    const palette = variant === 'void-inferno'
      ? VOID_INFERNO_PALETTE
      : resolveVisualPalette(params.color);

    if (reduceMotion) {
      this.drawReducedMotion(ctx, canvas, frame, params, palette, variant);
      this.pendingDt = 0;
      return;
    }

    if (this.emitter.activeCount === 0 && this.drive > 0.015) {
      const primeCount = Math.min(particleLimit, Math.round(7 + this.drive * particleLimit * 0.42));
      this.priming = true;
      for (let index = 0; index < primeCount; index += 1) {
        this.emitter.emit(this.initializeParticle);
      }
      this.priming = false;
    }

    this.updateFlameFront(frame, params, this.pendingDt);
    this.emitter.advance(this.pendingDt);
    this.advanceParticles(frame, params, this.pendingDt);
    this.emitParticles(frame, params, particleLimit, environment);
    this.emitPeakLicks(particleLimit);
    this.pendingDt = 0;

    this.drawInferno(ctx, canvas, params, palette, variant);
  }

  private resetParticles(): void {
    this.emitter.clear();
    this.emissionCarry = 0;
    this.frontPrimed = false;
    this.peakCooldown.fill(0);
  }

  private resolveAudioDrive(
    frame: AudioVizFrame,
    params: VisualizerParams,
    environment: AudioVisualRenderEnvironment | undefined,
    reduceMotion: boolean,
  ): void {
    this.sensitivity = 0.58 + clamp01(params.sensitivity) * 1.42;
    this.bassDrive = weightedBandAverage(frame, 0, 10, params.bassWeight);
    this.midDrive = weightedBandAverage(frame, 10, 22, params.midWeight);
    this.trebleDrive = weightedBandAverage(frame, 22, 32, params.trebleWeight);
    const previewLift = environment?.amplitudeMode === 'preview'
      ? reduceMotion
        ? 0.1
        : 0.09 + Math.sin(frame.timeMs / 1000 * 0.79) * 0.035
      : 0;
    this.drive = clamp01(
      (clamp01(frame.energy) * 0.38
        + this.bassDrive * 0.36
        + this.midDrive * 0.18
        + this.trebleDrive * 0.08
        + previewLift)
      * this.sensitivity,
    );
  }

  /** Broad, slow silhouette swell — the front's large-scale undulation channel. */
  private frontSwell(unit: number, timeSeconds: number): number {
    const radial = this.layout === 'radial';
    return latticeNoise(unit * (radial ? 4 : 3.6), timeSeconds * 0.62, 3, radial ? 4 : 0);
  }

  /** Fine, faster crest flicker layered over the swell. */
  private frontFlicker(unit: number, timeSeconds: number): number {
    const radial = this.layout === 'radial';
    return latticeNoise(unit * (radial ? 9 : 8.3), timeSeconds * 1.7, 11, radial ? 9 : 0);
  }

  /**
   * The fastest channel: where this noise flares, the bright core layer visibly bulges
   * AND licks peel off — one phase source for both, so pulse and spawn are the same event.
   */
  private flareAt(unit: number, timeSeconds: number): number {
    const radial = this.layout === 'radial';
    return latticeNoise(unit * (radial ? 7 : 6.4), timeSeconds * 2.3, 19, radial ? 7 : 0);
  }

  /**
   * CHANGED: a smoothed, band-lifted flame front rises from the emission edge and is drawn
   * over the tongue roots, capped at half the canvas.
   * WHY: QA read the bare particle field as "wobbling candle flames"; a coherent front with
   * tongues licking out of its crest is what makes the scene read as one fire (§3e).
   */
  private frontTargetAt(
    frame: AudioVizFrame,
    params: VisualizerParams,
    unit: number,
    timeSeconds: number,
    minDimension: number,
  ): number {
    const local = clamp01(
      weightedBandAtUnit(frame, unit, params) * (0.55 + this.sensitivity * 0.5),
    );
    // CHANGED: the five-sine ripple became two octaves of scrolling lattice value noise
    //          (broad swell + fine flicker), periodic around the radial ring (Pass C).
    // WHY: sine sums pulse on fixed periods the eye locks onto; non-repeating noise is
    //      the procedural backbone of an organic flame silhouette (QA §3e).
    const swell = this.frontSwell(unit, timeSeconds);
    const flicker = this.frontFlicker(unit, timeSeconds);
    const ripple = 0.6 + swell * 0.58 + flicker * 0.24;
    if (this.layout === 'radial') {
      const radius = minDimension * (0.11 + this.drive * 0.12) * (0.62 + local * 0.75) * ripple;
      return Math.min(minDimension * 0.3, Math.max(minDimension * 0.05, radius));
    }
    const envelope = this.layout === 'centered' ? Math.sin(Math.PI * clamp01(unit)) ** 1.3 : 1;
    const height = minDimension * (0.05 + this.drive * 0.24) * (0.6 + local * 0.8) * ripple * envelope;
    // 0.43 cap keeps even the sheath layer's 1.16× mask ceiling at or below half screen.
    return Math.min(this.canvasHeight * 0.43, Math.max(0, height));
  }

  private updateFlameFront(frame: AudioVizFrame, params: VisualizerParams, dt: number): void {
    const minDimension = Math.max(24, Math.min(this.canvasWidth, this.canvasHeight));
    const timeSeconds = frame.timeMs / 1000;
    this.frontTime = timeSeconds;
    for (let index = 0; index < INFERNO_FRONT_SAMPLES; index += 1) {
      this.peakCooldown[index] = Math.max(0, (this.peakCooldown[index] ?? 0) - dt);
    }
    for (let index = 0; index < INFERNO_FRONT_SAMPLES; index += 1) {
      const unit = index / (INFERNO_FRONT_SAMPLES - 1);
      // The flare channel is sampled once here and shared by drawing and emission.
      this.flareField[index] = this.flareAt(unit, timeSeconds);
      const target = this.frontTargetAt(frame, params, unit, timeSeconds, minDimension);
      if (!this.frontPrimed) {
        this.frontField[index] = target;
        continue;
      }
      const previous = this.frontField[index] ?? 0;
      // CHANGED: the crest climbs quickly but relaxes slowly (minor hysteresis).
      // WHY: tongues must always overshoot a front that lags their release, not chase it.
      const rate = target > previous ? 9 : 2.4;
      this.frontField[index] = previous + (target - previous) * (1 - Math.exp(-rate * dt));
    }
    this.frontPrimed = true;
  }

  /**
   * CHANGED: tall crest peaks actively peel off short-lived, hot "lick" tongues (Pass B).
   * WHY: the fire read as "wavy base + separate rising particles"; licks must visibly
   *      originate at the peaks so the front and the tongues form one organism.
   */
  private readonly initializeLick: BoundedParticleInitializer<InfernoParticle> = (
    particle,
  ) => {
    const serial = this.spawnSerial;
    this.spawnSerial += 1;
    const texture = seededUnit(serial, 11);
    const minDimension = Math.max(24, Math.min(this.canvasWidth, this.canvasHeight));
    particle.kind = 'flame';
    particle.phase = seededUnit(serial, 17) * Math.PI * 2;
    // Hotter and shorter-lived than hearth tongues: a lick flares and dies quickly.
    particle.heat = clamp01(0.75 + this.drive * 0.25);
    particle.drift = (seededUnit(serial, 23) - 0.5) * 2;
    particle.size = minDimension * (0.01 + texture * 0.01) * (0.8 + this.drive * 0.5);
    particle.lifetime = 0.45 + texture * 0.5;
    particle.x = this.lickSpawnX;
    particle.y = this.lickSpawnY;
    particle.vx = this.lickSpawnVx;
    particle.vy = this.lickSpawnVy;
  };

  private emitPeakLicks(particleLimit: number): void {
    if (!this.frontPrimed || this.drive <= 0.02) return;
    const minDimension = Math.max(24, Math.min(this.canvasWidth, this.canvasHeight));
    const radial = this.layout === 'radial';
    const base = radial
      ? minDimension * (0.11 + this.drive * 0.12)
      : minDimension * (0.05 + this.drive * 0.24);
    // CHANGED: geometric local-maxima detection became a flare-noise gate (Pass C).
    // WHY: the crest pulsed on its own rhythm while licks spawned on cooldown timers —
    //      QA read the mismatch instantly. The core layer bulges where flareField is
    //      high, so gating emission on the same channel makes the visible surge and the
    //      lick leaving it one event. Louder voice opens the gate wider.
    const flareGate = 0.72 - this.drive * 0.2;
    const heightFloor = base * (radial ? 0.88 : 0.9);
    let spawned = 0;
    for (let index = 1; index < INFERNO_FRONT_SAMPLES - 1 && spawned < 3; index += 1) {
      if ((this.peakCooldown[index] ?? 0) > 0) continue;
      const flare = this.flareField[index] ?? 0;
      const flareLeft = this.flareField[index - 1] ?? 0;
      const flareRight = this.flareField[index + 1] ?? 0;
      if (flare < flareGate || flare < flareLeft || flare < flareRight) continue;
      const value = this.frontField[index] ?? 0;
      if (value < heightFloor) continue;
      if (this.emitter.activeCount >= particleLimit) break;

      const unit = index / (INFERNO_FRONT_SAMPLES - 1);
      const left = this.frontField[index - 1] ?? 0;
      const right = this.frontField[index + 1] ?? 0;
      const lean = (left - right) * (1.1 + seededUnit(index, this.spawnSerial) * 0.8);
      if (radial) {
        const angle = unit * Math.PI * 2 - Math.PI / 2;
        const speed = 55 + this.drive * 70;
        this.lickSpawnX = this.canvasWidth / 2 + Math.cos(angle) * value;
        this.lickSpawnY = this.canvasHeight / 2 + Math.sin(angle) * value;
        this.lickSpawnVx = Math.cos(angle) * speed - Math.sin(angle) * lean;
        this.lickSpawnVy = Math.sin(angle) * speed + Math.cos(angle) * lean;
      } else {
        this.lickSpawnX = unit * this.canvasWidth;
        this.lickSpawnY = this.canvasHeight - value;
        this.lickSpawnVx = lean;
        this.lickSpawnVy = -(58 + this.drive * 75);
      }
      this.emitter.emit(this.initializeLick);
      // Refractory windows: the fired sample rests, neighbors cool briefly so twin
      // samples of one physical flare cannot double-fire.
      this.peakCooldown[index] = 0.2 + seededUnit(index * 3 + this.spawnSerial, 47) * 0.26;
      this.peakCooldown[index - 1] = Math.max(this.peakCooldown[index - 1] ?? 0, 0.1);
      this.peakCooldown[index + 1] = Math.max(this.peakCooldown[index + 1] ?? 0, 0.1);
      spawned += 1;
    }
  }

  private frontFieldAt(field: Float32Array, unit: number): number {
    const position = clamp01(unit) * (INFERNO_FRONT_SAMPLES - 1);
    const left = Math.floor(position);
    const right = Math.min(INFERNO_FRONT_SAMPLES - 1, left + 1);
    const leftValue = field[left] ?? 0;
    const rightValue = field[right] ?? leftValue;
    return leftValue + (rightValue - leftValue) * (position - left);
  }

  /** Catmull-Rom-smoothed crest curve across the canvas; optionally closed along the bottom. */
  private traceFrontCurve(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    field: Float32Array,
    scale: number,
    close: boolean,
  ): void {
    const count = INFERNO_FRONT_SAMPLES;
    const xAt = (index: number): number => index / (count - 1) * canvas.width;
    const yAt = (index: number): number => {
      const clamped = Math.min(count - 1, Math.max(0, index));
      return canvas.height - (field[clamped] ?? 0) * scale;
    };
    ctx.beginPath();
    if (close) {
      ctx.moveTo(-6, canvas.height + 4);
      ctx.lineTo(-6, yAt(0));
    } else {
      ctx.moveTo(-6, yAt(0));
    }
    for (let index = 0; index < count - 1; index += 1) {
      const x0 = xAt(Math.max(0, index - 1));
      const y0 = yAt(index - 1);
      const x1 = xAt(index);
      const y1 = yAt(index);
      const x2 = xAt(index + 1);
      const y2 = yAt(index + 1);
      const x3 = xAt(Math.min(count - 1, index + 2));
      const y3 = yAt(index + 2);
      ctx.bezierCurveTo(
        x1 + (x2 - x0) / 6, y1 + (y2 - y0) / 6,
        x2 - (x3 - x1) / 6, y2 - (y3 - y1) / 6,
        x2, y2,
      );
    }
    ctx.lineTo(canvas.width + 6, yAt(count - 1));
    if (close) {
      ctx.lineTo(canvas.width + 6, canvas.height + 4);
      ctx.closePath();
    }
  }

  /** Closed smoothed ring for the radial layout's corona front. */
  private traceFrontRing(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    field: Float32Array,
    scale: number,
  ): void {
    const count = INFERNO_FRONT_SAMPLES;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const pointAt = (index: number): readonly [number, number] => {
      const wrapped = ((index % count) + count) % count;
      const angle = wrapped / count * Math.PI * 2 - Math.PI / 2;
      const radius = (field[wrapped] ?? 0) * scale;
      return [centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius];
    };
    ctx.beginPath();
    const [startX, startY] = pointAt(0);
    ctx.moveTo(startX, startY);
    for (let index = 0; index < count; index += 1) {
      const [x0, y0] = pointAt(index - 1);
      const [x1, y1] = pointAt(index);
      const [x2, y2] = pointAt(index + 1);
      const [x3, y3] = pointAt(index + 2);
      ctx.bezierCurveTo(
        x1 + (x2 - x0) / 6, y1 + (y2 - y0) / 6,
        x2 - (x3 - x1) / 6, y2 - (y3 - y1) / 6,
        x2, y2,
      );
    }
    ctx.closePath();
  }

  /**
   * Fill the scratch layer with `field` eroded by a scrolling noise mask. Each front
   * layer owns a frequency/speed/seed, so the silhouettes slide over each other.
   */
  private maskLayer(
    field: Float32Array,
    timeSeconds: number,
    floor: number,
    gain: number,
    frequency: number,
    speed: number,
    seed: number,
  ): void {
    const wrap = this.layout === 'radial' ? Math.round(frequency) : 0;
    for (let index = 0; index < INFERNO_FRONT_SAMPLES; index += 1) {
      const unit = index / (INFERNO_FRONT_SAMPLES - 1);
      const mask = latticeNoise(unit * frequency, timeSeconds * speed, seed, wrap);
      this.layerField[index] = (field[index] ?? 0) * (floor + mask * gain);
    }
  }

  /** Fill the scratch layer with `field` eroded by the shared flare channel. */
  private maskLayerFromFlare(field: Float32Array, timeSeconds: number): void {
    for (let index = 0; index < INFERNO_FRONT_SAMPLES; index += 1) {
      const unit = index / (INFERNO_FRONT_SAMPLES - 1);
      this.layerField[index] = (field[index] ?? 0)
        * (0.24 + this.flareAt(unit, timeSeconds) * 0.5);
    }
  }

  /**
   * CHANGED: the halo + gradient + stroke sandwich became noise-masked silhouette layers —
   * a deep translucent sheath, a gradient-bodied main silhouette with its crest stroke,
   * and a bright core eroded by the flare channel that also spawns licks (Pass C).
   * WHY: one smooth filled curve can never look organic; procedural fire is drawn as
   *      stacked ragged sheets whose edges slide at different speeds, and the core must
   *      surge exactly where licks leave so pulse and spawn read as one event (§3e).
   */
  private drawFlameFront(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    palette: readonly string[],
    variant: InfernoVariant,
    field: Float32Array,
    timeSeconds: number,
  ): void {
    if (this.drive <= 0.01) return;
    let peak = 0;
    for (let index = 0; index < INFERNO_FRONT_SAMPLES; index += 1) {
      peak = Math.max(peak, field[index] ?? 0);
    }
    if (peak <= 1) return;
    const radial = this.layout === 'radial';
    const traceLayer = (close: boolean): void => {
      if (radial) this.traceFrontRing(ctx, canvas, this.layerField, 1);
      else this.traceFrontCurve(ctx, canvas, this.layerField, 1, close);
    };

    if (variant === 'void-inferno') {
      // Dark bulk with one hot crest outline keeps the Void treatment's inverted
      // language; the bulk silhouette carries the noise mask so Void stays organic too.
      this.maskLayer(field, timeSeconds, 0.74, 0.32, radial ? 7 : 6.7, 1.15, 7);
      traceLayer(true);
      ctx.fillStyle = '#030106';
      ctx.shadowBlur = 0;
      ctx.fill();
      traceLayer(false);
      ctx.strokeStyle = colorWithAlpha(paletteColorAt(palette, 0.82), 0.92);
      ctx.lineWidth = 1.7 + this.drive * 0.6;
      ctx.stroke();
      return;
    }

    // CHANGED: sheath and core now carry their own vertical heat ramps (the body
    //          already had one) — each layer's gradient is tuned to its role
    //          (QA Pass D §3e).
    // WHY: flat fills gave the masked silhouettes hard uniform sheets; a per-layer
    //      vertical falloff is what makes the stacked front read as one gradual
    //      volume of heat instead of three cut-outs.
    // Sheath: the deep-red outer envelope, slow broad erosion, up to 1.16× the field.
    // Its ramp dissolves upward so the outermost ragged edge feathers into the scene.
    this.maskLayer(field, timeSeconds, 0.84, 0.32, radial ? 4 : 4.3, 0.8, 23);
    traceLayer(true);
    const sheathAlpha = 0.3 + this.drive * 0.22;
    const sheath = radial
      ? ctx.createRadialGradient(
        canvas.width / 2, canvas.height / 2, peak * 0.15,
        canvas.width / 2, canvas.height / 2, peak * 1.16,
      )
      : ctx.createLinearGradient(0, canvas.height, 0, canvas.height - peak * 1.16);
    sheath.addColorStop(0, colorWithAlpha(paletteColorAt(palette, 0.26), sheathAlpha));
    sheath.addColorStop(0.55, colorWithAlpha(paletteColorAt(palette, 0.2), sheathAlpha * 0.72));
    sheath.addColorStop(1, colorWithAlpha(paletteColorAt(palette, 0.12), sheathAlpha * 0.16));
    ctx.fillStyle = sheath;
    ctx.shadowBlur = 0;
    ctx.fill();

    // Body: the main silhouette carrying the vertical heat-ramp gradient.
    this.maskLayer(field, timeSeconds, 0.62, 0.42, radial ? 7 : 6.7, 1.15, 7);
    traceLayer(true);
    const body = radial
      ? ctx.createRadialGradient(
        canvas.width / 2, canvas.height / 2, peak * 0.12,
        canvas.width / 2, canvas.height / 2, peak,
      )
      : ctx.createLinearGradient(0, canvas.height, 0, canvas.height - peak * 1.05);
    if (radial) {
      body.addColorStop(0, colorWithAlpha(paletteColorAt(palette, 0.97), 0.9));
      body.addColorStop(0.6, colorWithAlpha(paletteColorAt(palette, 0.6), 0.86));
      body.addColorStop(1, colorWithAlpha(paletteColorAt(palette, 0.2), 0.8));
    } else {
      body.addColorStop(0, colorWithAlpha(paletteColorAt(palette, 0.14), 0.78));
      body.addColorStop(0.45, colorWithAlpha(paletteColorAt(palette, 0.5), 0.85));
      body.addColorStop(0.82, colorWithAlpha(paletteColorAt(palette, 0.8), 0.88));
      body.addColorStop(1, colorWithAlpha(paletteColorAt(palette, 0.97), 0.9));
    }
    ctx.fillStyle = body;
    ctx.fill();

    // Crest stroke rides the SAME body silhouette (scratch still holds it).
    traceLayer(false);
    ctx.strokeStyle = colorWithAlpha(paletteColorAt(palette, 0.92), 0.5 + this.drive * 0.3);
    ctx.lineWidth = 1.2 + this.drive * 1.2;
    ctx.shadowColor = colorWithAlpha(paletteColorAt(palette, 0.9), 0.85);
    ctx.shadowBlur = 5 + this.drive * 6;
    ctx.stroke();

    // Core: the bright inner tongue mass, gated by the flare channel — it bulges at
    // exactly the samples that are eligible to peel off a lick this instant. Its ramp
    // is hottest at the hearth and cools toward the crest so surges glow from within.
    this.maskLayerFromFlare(field, timeSeconds);
    traceLayer(true);
    const coreAlpha = 0.5 + this.drive * 0.3;
    const core = radial
      ? ctx.createRadialGradient(
        canvas.width / 2, canvas.height / 2, peak * 0.12,
        canvas.width / 2, canvas.height / 2, peak,
      )
      : ctx.createLinearGradient(0, canvas.height, 0, canvas.height - peak);
    core.addColorStop(0, colorWithAlpha(paletteColorAt(palette, 0.99), coreAlpha));
    core.addColorStop(0.6, colorWithAlpha(paletteColorAt(palette, 0.93), coreAlpha * 0.68));
    core.addColorStop(1, colorWithAlpha(paletteColorAt(palette, 0.85), coreAlpha * 0.24));
    ctx.fillStyle = core;
    ctx.shadowBlur = 0;
    ctx.fill();
  }

  private emitParticles(
    frame: AudioVizFrame,
    params: VisualizerParams,
    particleLimit: number,
    environment: AudioVisualRenderEnvironment | undefined,
  ): void {
    const previewMinimum = environment?.amplitudeMode === 'preview' ? 4 : 0;
    // CHANGED: continuous hearth emission cut back sharply now that the front occludes
    //          the base and crest peaks emit the visible licks (Pass B).
    // WHY: most rising tongues must originate at the front's tall peaks, not stream up
    //      from underneath it.
    const rate = this.drive <= 0.01
      ? previewMinimum
      : 3 + this.drive * (9 + clamp01(params.density) * 16);
    this.emissionCarry += rate * this.pendingDt;
    if (frame.transient) {
      // CHANGED: onset bursts enter the already-bounded pool immediately.
      // WHY: brief consonants should throw sparks even when they land between continuous emission ticks.
      this.emissionCarry += 4 + Math.round(this.trebleDrive * 4);
    }

    let emitted = 0;
    // BUG FIX: Inferno mid-life flame pop-out at the particle cap
    // Fix: `<=` allowed emission at a full pool, which force-recycled a live slot and visibly
    //      deleted a mid-life tongue every tick during sustained loud speech; `<` waits for expiry.
    while (this.emissionCarry >= 1 && emitted < 10 && this.emitter.activeCount < particleLimit) {
      this.emitter.emit(this.initializeParticle);
      this.emissionCarry -= 1;
      emitted += 1;
    }
    this.emissionCarry = Math.min(this.emissionCarry, 10);
  }

  private advanceParticles(
    frame: AudioVizFrame,
    params: VisualizerParams,
    dt: number,
  ): void {
    if (dt <= 0) return;
    const timeSeconds = frame.timeMs / 1000;
    const flowStrength = 24 + this.midDrive * 44 + clamp01(params.intensity) * 15;
    const smoothingDrag = Math.exp(-dt * (0.42 + clamp01(params.smoothing) * 0.88));
    const minDimension = Math.max(24, Math.min(this.canvasWidth, this.canvasHeight));
    this.flowOptions.complexity = 0.46 + this.midDrive * 0.4;
    this.flowOptions.speed = 0.5 + (1 - clamp01(params.smoothing)) * 0.85;

    for (const particle of this.emitter.particles) {
      if (!particle.active) continue;
      const normalizedX = particle.x / this.canvasWidth * 2 - 1;
      const normalizedY = particle.y / this.canvasHeight * 2 - 1;
      // CHANGED: one shared convection field per kind (smoke rides a lagged copy of the flame field).
      // WHY: per-particle seeds destroyed spatial coherence — neighbouring tongues must lean into the
      //      same gust or the column reads as independent jitter instead of convection.
      this.flowOptions.seed = particle.kind === 'smoke' ? 67 : 61;
      const flow = sampleLayeredVectorFlowField(
        normalizedX,
        normalizedY,
        timeSeconds,
        this.flowOptions,
        this.flowVector,
      );
      const life = clamp01(particle.age / particle.lifetime);
      // CHANGED: buoyancy decays over life (embers can stall and flutter downward).
      // WHY: constant lift made every particle coast upward forever; cooling gas decelerates.
      const buoyancy = particle.kind === 'smoke'
        ? 15
        : particle.kind === 'ember'
          ? 30 * (1 - life * 1.2)
          : 40 * (1 - life * 0.55);
      const turbulence = flowStrength
        * (particle.kind === 'smoke' ? 0.7 : 0.45 + life * 0.85);

      if (this.layout === 'radial') {
        const dx = particle.x - this.canvasWidth / 2;
        const dy = particle.y - this.canvasHeight / 2;
        const length = Math.max(1, Math.hypot(dx, dy));
        particle.vx += (dx / length * buoyancy + flow.x * turbulence) * dt;
        particle.vy += (dy / length * buoyancy + flow.y * turbulence) * dt;
      } else {
        const flutter = particle.kind === 'ember'
          ? Math.sin(particle.phase + life * 13) * 24
          : Math.sin(particle.phase + life * 7.5) * 10;
        particle.vx += (flow.x * turbulence + flutter) * dt;
        particle.vy += (-buoyancy + flow.y * turbulence * 0.4) * dt;
      }

      particle.vx *= smoothingDrag;
      particle.vy *= particle.kind === 'ember' ? 0.995 : smoothingDrag;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      if (particle.kind === 'smoke') {
        particle.size += minDimension * (0.014 + this.midDrive * 0.008) * dt;
      }
    }
  }

  private drawInferno(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    params: VisualizerParams,
    palette: readonly string[],
    variant: InfernoVariant,
  ): void {
    ctx.save();
    this.drawHearth(ctx, canvas, palette, variant);

    ctx.globalCompositeOperation = 'source-over';
    for (const particle of this.emitter.particles) {
      if (particle.active && particle.kind === 'smoke') {
        this.drawSmoke(ctx, particle, palette, variant);
      }
    }

    // CHANGED: tongues paint first, then the flame front paints over their roots, then embers.
    // WHY: occluding the lower tongue bodies behind the crest is what turns "a swarm of candle
    //      flames" into tips licking out of one coherent front (§3e); sparks stay in front.
    ctx.globalCompositeOperation = variant === 'void-inferno' ? 'source-over' : 'lighter';
    for (const particle of this.emitter.particles) {
      if (!particle.active || particle.kind !== 'flame') continue;
      if (this.tongueFullyBehindFront(particle)) continue;
      this.drawFlame(ctx, particle, params, palette, variant);
    }
    ctx.globalCompositeOperation = 'source-over';
    this.drawFlameFront(ctx, canvas, palette, variant, this.frontField, this.frontTime);
    ctx.globalCompositeOperation = variant === 'void-inferno' ? 'source-over' : 'lighter';
    for (const particle of this.emitter.particles) {
      if (!particle.active || particle.kind !== 'ember') continue;
      this.drawEmber(ctx, particle, palette, variant);
    }
    ctx.restore();
  }

  /** Skip painting tongues whose tips never clear the front — they would be fully occluded. */
  private tongueFullyBehindFront(particle: InfernoParticle): boolean {
    if (!this.frontPrimed) return false;
    const life = clamp01(particle.age / particle.lifetime);
    const length = particle.size * 1.18 * (2.4 + (1 - life) * 3.4);
    const speed = Math.max(1, Math.hypot(particle.vx, particle.vy));
    const tipX = particle.x + particle.vx / speed * length * 0.78;
    const tipY = particle.y + particle.vy / speed * length * 0.78;
    if (this.layout === 'radial') {
      const dx = tipX - this.canvasWidth / 2;
      const dy = tipY - this.canvasHeight / 2;
      const angleUnit = (Math.atan2(dy, dx) + Math.PI / 2) / (Math.PI * 2);
      const ring = this.frontFieldAt(this.frontField, angleUnit - Math.floor(angleUnit));
      // CHANGED: occlusion tightened 0.72 → 0.95 of the local front height (Pass B).
      // WHY: partially-buried tongue bodies under the crest broke the "one fire" read.
      return Math.hypot(dx, dy) < ring * 0.95;
    }
    const front = this.frontFieldAt(this.frontField, tipX / Math.max(1, this.canvasWidth));
    return tipY > this.canvasHeight - front * 0.95;
  }

  private drawHearth(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    palette: readonly string[],
    variant: InfernoVariant,
  ): void {
    if (this.drive <= 0.01) return;
    const minDimension = Math.max(24, Math.min(canvas.width, canvas.height));
    const centerX = canvas.width / 2;
    const centerY = this.layout === 'radial' ? canvas.height / 2 : canvas.height * 0.93;

    if (variant === 'void-inferno') {
      const radius = this.layout === 'linear'
        ? Math.max(canvas.width * 0.52, minDimension)
        : minDimension * (this.layout === 'radial' ? 0.17 : 0.31);
      const hot = paletteColorAt(palette, 1);
      ctx.fillStyle = '#030106';
      ctx.strokeStyle = colorWithAlpha(hot, 0.9);
      ctx.lineWidth = 1.7;
      ctx.shadowBlur = 0;
      ctx.beginPath();
      if (this.layout === 'radial') {
        ctx.arc(centerX, centerY, radius * 0.68, 0, Math.PI * 2);
      } else {
        ctx.ellipse(centerX, centerY, radius, minDimension * 0.026, 0, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.stroke();
      return;
    }

    // CHANGED: the single canvas-wide dome became a broad ambient wash plus a tight hot bed.
    // WHY: one huge gradient at 0.3+ alpha pre-saturated the lower half, so additive tongues
    //      clipped to white; a compact bright core over a faint wash keeps headroom for the flames.
    const wideRadius = this.layout === 'linear'
      ? canvas.width * 0.36
      : minDimension * (this.layout === 'radial' ? 0.24 : 0.3);
    const ambient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, wideRadius);
    ambient.addColorStop(0, colorWithAlpha(paletteColorAt(palette, 0.45), 0.1 + this.drive * 0.12));
    ambient.addColorStop(0.55, colorWithAlpha(paletteColorAt(palette, 0.22), 0.05 + this.drive * 0.07));
    ambient.addColorStop(1, colorWithAlpha(paletteColorAt(palette, 0.12), 0));
    ctx.fillStyle = ambient;
    ctx.beginPath();
    ctx.arc(centerX, centerY, wideRadius, 0, Math.PI * 2);
    ctx.fill();

    const coreRadius = wideRadius * 0.42;
    const bed = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, coreRadius);
    bed.addColorStop(0, colorWithAlpha(paletteColorAt(palette, 0.96), 0.3 + this.drive * 0.32));
    bed.addColorStop(0.55, colorWithAlpha(paletteColorAt(palette, 0.72), 0.13 + this.drive * 0.17));
    bed.addColorStop(1, colorWithAlpha(paletteColorAt(palette, 0.5), 0));
    ctx.fillStyle = bed;
    ctx.beginPath();
    ctx.arc(centerX, centerY, coreRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawSmoke(
    ctx: CanvasRenderingContext2D,
    particle: InfernoParticle,
    palette: readonly string[],
    variant: InfernoVariant,
  ): void {
    const life = clamp01(particle.age / particle.lifetime);
    const radius = Math.max(1, particle.size * (1 + life * 2.2));

    if (variant === 'void-inferno') {
      // BUG FIX: Void smoke read as fast-growing large ovals (QA §7a)
      // Fix: One stroked ellipse ballooning at 2.2× life-growth is replaced by three smaller
      //      seeded-noise lobes in a single path with slower growth, so the silhouette reads
      //      as a clustered smoke puff instead of an inflating balloon.
      const puffRadius = Math.max(1, particle.size * (1 + life * 1.1));
      ctx.shadowBlur = 0;
      ctx.fillStyle = colorWithAlpha(paletteColorAt(palette, 0.26 + life * 0.22), 0.58);
      ctx.strokeStyle = colorWithAlpha(paletteColorAt(palette, 0.78), 0.72);
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      for (let lobe = 0; lobe < 3; lobe += 1) {
        const angle = particle.phase + lobe * 2.094 + life * 0.5;
        const offset = puffRadius * (0.34 + seededUnit(particle.index * 3 + lobe, 53) * 0.22);
        const lobeRadius = puffRadius * (0.42 + seededUnit(particle.index * 5 + lobe, 57) * 0.22);
        const lobeX = particle.x + Math.cos(angle) * offset;
        const lobeY = particle.y + Math.sin(angle) * offset * 0.7;
        ctx.moveTo(lobeX + lobeRadius, lobeY);
        ctx.arc(lobeX, lobeY, lobeRadius, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.stroke();
      return;
    }

    // CHANGED: smoke is a soft radial-gradient puff with an off-center dense lobe and no outline.
    // WHY: hard-edged stroked ellipses at ~0.15 alpha read as gray balloons; smoke needs a feathered
    //      edge, an early density peak just above the flames, and a long transparent dissolve.
    const birth = Math.min(1, life * 3.2);
    const fade = birth * (1 - life) ** 1.6 * (0.16 + this.midDrive * 0.2);
    const body = mixVisualColors(paletteColorAt(palette, 0.08), '#6b6f75', 0.66);
    const puff = ctx.createRadialGradient(
      particle.x - radius * 0.2,
      particle.y - radius * 0.24,
      radius * 0.1,
      particle.x,
      particle.y,
      radius,
    );
    puff.addColorStop(0, colorWithAlpha(body, fade));
    puff.addColorStop(0.62, colorWithAlpha(body, fade * 0.55));
    puff.addColorStop(1, colorWithAlpha(body, 0));
    ctx.shadowBlur = 0;
    ctx.fillStyle = puff;
    ctx.beginPath();
    ctx.ellipse(
      particle.x,
      particle.y,
      radius * (1.12 + particle.drift * 0.1),
      radius * 0.78,
      particle.phase + life * 0.6,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  private drawFlame(
    ctx: CanvasRenderingContext2D,
    particle: InfernoParticle,
    params: VisualizerParams,
    palette: readonly string[],
    variant: InfernoVariant,
  ): void {
    const life = clamp01(particle.age / particle.lifetime);
    const heat = (1 - life) ** 0.64 * particle.heat;
    // CHANGED: the sheath sits low on the palette (deep red/orange) and the core sits high.
    // WHY: mapping both near the pale end painted flat yellow petals — the red envelope around
    //      an amber-white core is what makes fire read as fire, and it must cool as tongues rise.
    const sheath = paletteColorAt(palette, 0.16 + heat * 0.34);
    const core = paletteColorAt(palette, 0.55 + heat * 0.45);
    // Brightest at ignition, decaying upward — with a fast fade-in so births do not pop.
    const opacity = Math.min(1, life * 5) * (1 - life) ** 1.25;

    if (variant === 'void-inferno') {
      this.traceFlameTongue(ctx, particle, 1.16, 1, 1);
      ctx.fillStyle = colorWithAlpha(paletteColorAt(palette, 0.04), 0.96);
      ctx.strokeStyle = colorWithAlpha(core, 0.9);
      ctx.lineWidth = 1.35 + heat * 0.85;
      ctx.shadowBlur = 0;
      ctx.fill();
      ctx.stroke();
      return;
    }

    this.traceFlameTongue(ctx, particle, 1.18, 1, 1);
    ctx.fillStyle = colorWithAlpha(sheath, opacity * (0.24 + clamp01(params.intensity) * 0.24));
    ctx.shadowColor = colorWithAlpha(core, 0.8);
    ctx.shadowBlur = 4 + heat * 7;
    ctx.fill();

    this.traceFlameTongue(ctx, particle, 0.62, 0.5, 0.8);
    ctx.fillStyle = colorWithAlpha(core, opacity * (0.42 + heat * 0.34));
    ctx.shadowBlur = 0;
    ctx.fill();
  }

  /**
   * CHANGED: tongues are asymmetric — a wide rounded base, a mid bulge, and a thin tip that is
   * displaced laterally by a life-advancing whip phase (the tip travels, not just its controls).
   * WHY: the previous symmetric lens kept every apex locked on the velocity axis, producing a
   * field of identical flat petals; a licking flame needs its tip to whip off-axis as it cools.
   */
  private traceFlameTongue(
    ctx: CanvasRenderingContext2D,
    particle: InfernoParticle,
    lengthScale: number,
    widthScale: number,
    whipScale: number,
  ): void {
    const speed = Math.max(1, Math.hypot(particle.vx, particle.vy));
    const directionX = particle.vx / speed;
    const directionY = particle.vy / speed;
    const normalX = -directionY;
    const normalY = directionX;
    const life = clamp01(particle.age / particle.lifetime);
    // CHANGED: tongues morph over life instead of only shrinking (QA Pass D §3e) —
    //          the final approach to death pinches both axes toward a small point.
    // WHY: same-shaped candlelight lozenges at every age read as cartoons; a lick
    //      must end its arc as a contracting point, not a fading full-size petal.
    const endPinch = life <= 0.78 ? 0 : ((life - 0.78) / 0.22) ** 1.2;
    const length = particle.size * lengthScale * (2.4 + (1 - life) * 3.4)
      * (1 - endPinch * 0.55);
    const width = particle.size * widthScale * (0.55 + (1 - life) * 0.85)
      * (1 - endPinch * 0.75);
    // Tips flutter harder than roots: whip amplitude grows over life.
    const whip = Math.sin(particle.phase * 1.7 + life * 9.5)
      * (0.3 + life * 1.1) * whipScale;
    const baseX = particle.x - directionX * length * 0.22;
    const baseY = particle.y - directionY * length * 0.22;
    const tipX = particle.x + directionX * length * 0.78 + normalX * whip * width * 1.5;
    const tipY = particle.y + directionY * length * 0.78 + normalY * whip * width * 1.5;
    // CHANGED: the rounded bottom cap became a life-retracting tendril (QA Pass D §3e).
    // WHY: a young tongue's bottom stretches into an elongated tendril rooted back
    //      toward where it rose; as the lick climbs past the front the tendril masks
    //      upward and retracts, leaving the original candle shape that then pinches
    //      to a point — the "lick of flame" arc the operator described.
    const tendril = (1 - Math.min(1, life / 0.55)) ** 1.4;
    const tailLength = width * 0.6 + length * 0.95 * tendril;
    const tailSway = Math.sin(particle.phase * 2.3 + life * 6.2)
      * width * (0.25 + tendril * 0.6);
    const tailX = baseX - directionX * tailLength + normalX * tailSway;
    const tailY = baseY - directionY * tailLength + normalY * tailSway;

    ctx.beginPath();
    ctx.moveTo(baseX - normalX * width, baseY - normalY * width);
    ctx.bezierCurveTo(
      baseX - normalX * width * 1.3 + directionX * length * 0.3,
      baseY - normalY * width * 1.3 + directionY * length * 0.3,
      tipX - directionX * length * 0.3 - normalX * width * 0.5,
      tipY - directionY * length * 0.3 - normalY * width * 0.5,
      tipX,
      tipY,
    );
    ctx.bezierCurveTo(
      tipX - directionX * length * 0.34 + normalX * width * 0.34,
      tipY - directionY * length * 0.34 + normalY * width * 0.34,
      baseX + normalX * width * 1.24 + directionX * length * 0.34,
      baseY + normalY * width * 1.24 + directionY * length * 0.34,
      baseX + normalX * width,
      baseY + normalY * width,
    );
    ctx.bezierCurveTo(
      baseX + normalX * width * 0.38 - directionX * tailLength * 0.46,
      baseY + normalY * width * 0.38 - directionY * tailLength * 0.46,
      tailX + normalX * width * 0.12,
      tailY + normalY * width * 0.12,
      tailX,
      tailY,
    );
    ctx.bezierCurveTo(
      tailX - normalX * width * 0.12,
      tailY - normalY * width * 0.12,
      baseX - normalX * width * 0.38 - directionX * tailLength * 0.46,
      baseY - normalY * width * 0.38 - directionY * tailLength * 0.46,
      baseX - normalX * width,
      baseY - normalY * width,
    );
    ctx.closePath();
  }

  private drawEmber(
    ctx: CanvasRenderingContext2D,
    particle: InfernoParticle,
    palette: readonly string[],
    variant: InfernoVariant,
  ): void {
    const life = clamp01(particle.age / particle.lifetime);
    const color = paletteColorAt(palette, 0.62 + (1 - life) * 0.38);
    const speed = Math.max(1, Math.hypot(particle.vx, particle.vy));
    const trail = particle.size * (variant === 'void-inferno' ? 4 : 7);
    const trailX = particle.x - particle.vx / speed * trail;
    const trailY = particle.y - particle.vy / speed * trail;
    ctx.beginPath();
    ctx.moveTo(particle.x, particle.y);
    ctx.lineTo(trailX, trailY);
    // CHANGED: the spark streak fades along its length — full alpha at the
    //          incandescent head, zero at the tail — in both variants (Pass D §3).
    // WHY: a flat-alpha straight segment reads as a bare drawn line; the taper is
    //      the performant line-smoothing treatment the operator prescribed.
    const headAlpha = variant === 'void-inferno' ? 0.95 : (1 - life) * 0.72;
    const taper = ctx.createLinearGradient(particle.x, particle.y, trailX, trailY);
    taper.addColorStop(0, colorWithAlpha(color, headAlpha));
    taper.addColorStop(1, colorWithAlpha(color, 0));
    ctx.strokeStyle = taper;
    ctx.lineWidth = variant === 'void-inferno' ? 1.65 : Math.max(0.8, particle.size * 0.48);
    ctx.shadowColor = variant === 'void-inferno' ? 'transparent' : color;
    ctx.shadowBlur = variant === 'void-inferno' ? 0 : 4;
    ctx.stroke();

    // CHANGED: each spark carries a bright head point over its trail.
    // WHY: a bare motion streak has no locus; the eye tracks embers by their incandescent head.
    const head = mixVisualColors(color, '#fff7d6', 0.7);
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, Math.max(0.6, particle.size * 0.85), 0, Math.PI * 2);
    ctx.fillStyle = colorWithAlpha(head, variant === 'void-inferno' ? 0.95 : (1 - life) * 0.92);
    ctx.shadowBlur = 0;
    ctx.fill();
  }

  private drawReducedMotion(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    frame: AudioVizFrame,
    params: VisualizerParams,
    palette: readonly string[],
    variant: InfernoVariant,
  ): void {
    ctx.save();
    this.drawHearth(ctx, canvas, palette, variant);
    // CHANGED: reduced motion shows a frozen flame front sculpted from the same audio field.
    // WHY: the front is the effect's new identity; the static treatment must include it.
    const minDimension = Math.max(24, Math.min(canvas.width, canvas.height));
    for (let index = 0; index < INFERNO_FRONT_SAMPLES; index += 1) {
      const unit = index / (INFERNO_FRONT_SAMPLES - 1);
      this.reducedFrontField[index] = this.frontTargetAt(frame, params, unit, 0, minDimension);
    }
    ctx.globalCompositeOperation = 'source-over';
    // Time 0 keeps the reduced treatment's noise masks frozen and render-order stable.
    this.drawFlameFront(ctx, canvas, palette, variant, this.reducedFrontField, 0);
    ctx.globalCompositeOperation = variant === 'void-inferno' ? 'source-over' : 'lighter';
    const count = this.drive <= 0.01
      ? 0
      : Math.min(
        resolveInfernoParticleLimit(params.density),
        Math.round(7 + this.drive * 17),
      );
    for (let index = 0; index < count; index += 1) {
      const unit = (index + 0.5) / Math.max(1, count);
      const texture = seededUnit(index, 71);
      const particle = this.reducedParticle;
      particle.index = index;
      particle.phase = seededUnit(index, 73) * Math.PI * 2;
      particle.age = particle.lifetime * (0.18 + texture * 0.42);
      particle.size = minDimension * (0.009 + texture * 0.01) * (0.7 + this.drive * 0.65);
      particle.heat = clamp01(0.64 + this.drive * 0.3);
      if (this.layout === 'radial') {
        const angle = unit * Math.PI * 2;
        const radius = minDimension * 0.1;
        particle.x = canvas.width / 2 + Math.cos(angle) * radius;
        particle.y = canvas.height / 2 + Math.sin(angle) * radius;
        particle.vx = Math.cos(angle);
        particle.vy = Math.sin(angle);
      } else {
        const spread = this.layout === 'centered' ? 0.24 : 0.86;
        particle.x = canvas.width * (0.5 + (unit - 0.5) * spread);
        particle.y = canvas.height * (0.91 + texture * 0.025);
        particle.vx = (texture - 0.5) * 0.8;
        particle.vy = -1;
      }
      this.drawFlame(ctx, particle, params, palette, variant);
    }
    ctx.restore();
  }
}

export const INFERNO_VISUAL_DEFINITION: AudioVisualDefinition = Object.freeze({
  id: INFERNO_ID,
  label: INFERNO_LABEL,
  kind: 'overlay',
  wants: Object.freeze({ bands: true }),
  family: 'flow-field-fire',
  maxElements: INFERNO_MAX_ELEMENTS,
  defaultParams: Object.freeze({
    sensitivity: 0.72,
    intensity: 0.76,
    smoothing: 0.42,
    color: Object.freeze(['#3b0805', '#9e1b08', '#ed4b0b', '#ff9f0a', '#fff1b8']),
    density: 0.58,
    layoutMode: 'linear',
    highContrast: false,
  }),
  create: () => new InfernoVisual(),
});
