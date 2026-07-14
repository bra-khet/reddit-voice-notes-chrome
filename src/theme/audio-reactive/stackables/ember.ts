import type {
  AudioVisualRenderEnvironment,
  AudioVizFrame,
  BoundedParticle,
  BoundedParticleInitializer,
  LayoutMode,
  StackableEffect,
  StackableEffectDefinition,
  VisualizerParams,
} from '@/src/theme/audio-reactive';
import { BoundedParticleEmitter } from '@/src/theme/audio-reactive';
import {
  colorWithAlpha,
  mixVisualColors,
  resolveVisualPalette,
} from '../palette';

export const RISING_EMBER_ID = 'ember' as const;
export const RISING_EMBER_LABEL = 'Rising Ember' as const;
export const RISING_EMBER_MIN_PARTICLES = 16;
export const RISING_EMBER_MAX_PARTICLES = 44;
/** Trail, halo, and hot core are the only three passes per live ember. */
export const RISING_EMBER_MAX_ELEMENTS = RISING_EMBER_MAX_PARTICLES * 3;

interface RisingEmberParticle extends BoundedParticle {
  index: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  phase: number;
  heat: number;
  flicker: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function seededUnit(index: number, salt: number): number {
  const value = Math.sin(index * 91.733 + salt * 17.117) * 43758.5453;
  return value - Math.floor(value);
}

function resolveLayout(params: VisualizerParams): LayoutMode {
  return params.layoutMode === 'centered' || params.layoutMode === 'radial'
    ? params.layoutMode
    : 'linear';
}

export function resolveRisingEmberParticleLimit(density: number): number {
  return Math.round(
    RISING_EMBER_MIN_PARTICLES
      + clamp01(density) * (RISING_EMBER_MAX_PARTICLES - RISING_EMBER_MIN_PARTICLES),
  );
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
 * CHANGED: Rising Ember is the first ordered stackable, backed by a fixed lifetime pool.
 * WHY: users get a convincing low-cost cinder layer without a generalized particle or scene system.
 */
class RisingEmberEffect implements StackableEffect {
  readonly id = RISING_EMBER_ID;

  private readonly emitter = new BoundedParticleEmitter<RisingEmberParticle>(
    RISING_EMBER_MAX_PARTICLES,
    (index) => ({
      index,
      active: false,
      age: 0,
      lifetime: 1,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      size: 1,
      phase: 0,
      heat: 1,
      flicker: 0,
    }),
  );

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
  private priming = false;
  private wasReducedMotion = false;

  private readonly initializeParticle: BoundedParticleInitializer<RisingEmberParticle> = (
    particle,
  ) => {
    const serial = this.spawnSerial;
    this.spawnSerial += 1;
    const source = seededUnit(serial, 3);
    const texture = seededUnit(serial, 11);
    const direction = seededUnit(serial, 19) * 2 - 1;
    const minDimension = Math.max(24, Math.min(this.canvasWidth, this.canvasHeight));

    particle.phase = seededUnit(serial, 23) * Math.PI * 2;
    particle.heat = 0.58 + seededUnit(serial, 29) * 0.42;
    particle.flicker = 0.72 + seededUnit(serial, 31) * 1.35;
    particle.size = minDimension * (0.0035 + texture * 0.0055) * (0.78 + this.drive * 0.52);
    particle.lifetime = 1.35 + texture * 2.15 + (1 - this.trebleDrive) * 0.45;

    if (this.layout === 'radial') {
      const angle = source * Math.PI * 2;
      const radius = minDimension * (0.055 + texture * 0.055);
      const speed = 24 + this.drive * 34 + this.trebleDrive * 23;
      particle.x = this.canvasWidth / 2 + Math.cos(angle) * radius;
      particle.y = this.canvasHeight / 2 + Math.sin(angle) * radius;
      particle.vx = Math.cos(angle) * speed - Math.sin(angle) * direction * 16;
      particle.vy = Math.sin(angle) * speed + Math.cos(angle) * direction * 16;
    } else {
      const spread = this.layout === 'centered' ? 0.28 : 0.94;
      particle.x = this.canvasWidth * (0.5 + (source - 0.5) * spread);
      particle.y = this.canvasHeight * (this.layout === 'centered' ? 0.84 : 0.96)
        + texture * minDimension * 0.035;
      particle.vx = direction * (7 + this.midDrive * 19);
      particle.vy = -(31 + this.drive * 47 + this.trebleDrive * 34);
    }

    if (this.priming) {
      particle.age = particle.lifetime * seededUnit(serial, 37) * 0.78;
      particle.x += particle.vx * particle.age * 0.62;
      particle.y += particle.vy * particle.age * 0.62;
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
      this.clearParticles();
    }

    const particleLimit = this.emitter.configureLimit(
      resolveRisingEmberParticleLimit(params.density),
    );
    const reduceMotion = environment?.reduceMotion === true;
    if (reduceMotion !== this.wasReducedMotion) {
      this.clearParticles();
      this.wasReducedMotion = reduceMotion;
    }

    this.resolveAudioDrive(frame, params, environment, reduceMotion);
    const palette = resolveVisualPalette(params.color);
    if (reduceMotion) {
      this.drawReducedMotion(ctx, canvas, params, palette);
      this.pendingDt = 0;
      return;
    }

    if (this.emitter.activeCount === 0 && this.drive > 0.012) {
      const primeCount = Math.min(particleLimit, Math.round(3 + this.drive * particleLimit * 0.42));
      this.priming = true;
      for (let index = 0; index < primeCount; index += 1) {
        this.emitter.emit(this.initializeParticle);
      }
      this.priming = false;
    }

    this.emitter.advance(this.pendingDt);
    this.advanceParticles(frame, params, this.pendingDt);
    this.emitParticles(frame, params, particleLimit, environment);
    this.pendingDt = 0;
    this.drawParticles(ctx, frame, params, palette);
  }

  getPerformanceCost(): number {
    return this.emitter.limit * 3;
  }

  private clearParticles(): void {
    this.emitter.clear();
    this.emissionCarry = 0;
  }

  private resolveAudioDrive(
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
        ? 0.11
        : 0.105 + Math.sin(frame.timeMs / 1000 * 0.67) * 0.025
      : 0;
    const sensitivity = 0.55 + clamp01(params.sensitivity) * 1.45;
    this.drive = clamp01(
      (clamp01(frame.energy) * 0.32
        + this.bassDrive * 0.19
        + this.midDrive * 0.25
        + this.trebleDrive * 0.24
        + previewLift)
      * sensitivity,
    );
  }

  private emitParticles(
    frame: AudioVizFrame,
    params: VisualizerParams,
    particleLimit: number,
    environment: AudioVisualRenderEnvironment | undefined,
  ): void {
    const previewMinimum = environment?.amplitudeMode === 'preview' ? 2.5 : 0;
    const rate = this.drive <= 0.008
      ? previewMinimum
      : 2 + this.drive * (8 + clamp01(params.density) * 19) + this.trebleDrive * 7;
    this.emissionCarry += rate * this.pendingDt;
    if (frame.transient) {
      // CHANGED: transients ignite an immediate but pool-bounded cinder fan.
      // WHY: consonant snaps should read as sparks even between continuous emission ticks.
      this.emissionCarry += 3 + Math.round(this.trebleDrive * 5);
    }

    let emitted = 0;
    while (
      this.emissionCarry >= 1
      && emitted < 8
      && this.emitter.activeCount < particleLimit
    ) {
      this.emitter.emit(this.initializeParticle);
      this.emissionCarry -= 1;
      emitted += 1;
    }
    this.emissionCarry = Math.min(this.emissionCarry, 8);
  }

  private advanceParticles(
    frame: AudioVizFrame,
    params: VisualizerParams,
    dt: number,
  ): void {
    if (dt <= 0) return;
    const time = frame.timeMs / 1000;
    const drag = Math.exp(-dt * (0.22 + clamp01(params.smoothing) * 0.62));
    const intensity = 0.65 + clamp01(params.intensity) * 0.85;

    for (const particle of this.emitter.particles) {
      if (!particle.active) continue;
      const life = clamp01(particle.age / particle.lifetime);
      const weave = Math.sin(particle.phase + time * particle.flicker + life * 7.5);
      if (this.layout === 'radial') {
        const dx = particle.x - this.canvasWidth / 2;
        const dy = particle.y - this.canvasHeight / 2;
        const length = Math.max(1, Math.hypot(dx, dy));
        particle.vx += (dx / length * (5 + this.bassDrive * 9) - dy / length * weave * 7) * dt;
        particle.vy += (dy / length * (5 + this.bassDrive * 9) + dx / length * weave * 7) * dt;
      } else {
        particle.vx += weave * (5 + this.midDrive * 15) * dt;
        particle.vy -= (4 + this.bassDrive * 8) * intensity * dt;
      }
      particle.vx *= drag;
      particle.vy *= 0.998;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
    }
  }

  private drawParticles(
    ctx: CanvasRenderingContext2D,
    frame: AudioVizFrame,
    params: VisualizerParams,
    palette: readonly string[],
  ): void {
    const highContrast = params.highContrast === true;
    const intensity = 0.58 + clamp01(params.intensity) * 0.72;
    ctx.save();
    ctx.globalCompositeOperation = highContrast ? 'source-over' : 'lighter';

    for (const particle of this.emitter.particles) {
      if (!particle.active) continue;
      const life = clamp01(particle.age / particle.lifetime);
      const fade = Math.sin(Math.PI * Math.min(1, life / 0.92)) * (1 - life * 0.35);
      const flicker = 0.74 + Math.sin(frame.timeMs / 1000 * (5 + particle.flicker * 3) + particle.phase) * 0.26;
      const alpha = clamp01(fade * flicker * intensity);
      const color = paletteColorAt(palette, 0.38 + particle.heat * 0.62);
      const speed = Math.max(1, Math.hypot(particle.vx, particle.vy));
      const trailLength = particle.size * (highContrast ? 3.4 : 6.5) * (0.72 + this.trebleDrive * 0.55);
      const coreRadius = Math.max(0.7, particle.size * (0.48 + (1 - life) * 0.22));

      ctx.beginPath();
      ctx.moveTo(particle.x, particle.y);
      ctx.lineTo(
        particle.x - particle.vx / speed * trailLength,
        particle.y - particle.vy / speed * trailLength,
      );
      ctx.strokeStyle = colorWithAlpha(color, alpha * (highContrast ? 0.95 : 0.68));
      ctx.lineWidth = highContrast ? Math.max(1.25, coreRadius * 0.82) : Math.max(0.7, coreRadius * 0.55);
      ctx.shadowColor = highContrast ? 'transparent' : color;
      ctx.shadowBlur = highContrast ? 0 : particle.size * 2.8;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(particle.x, particle.y, coreRadius * (highContrast ? 1.18 : 2.25), 0, Math.PI * 2);
      ctx.fillStyle = colorWithAlpha(color, alpha * (highContrast ? 0.38 : 0.22));
      ctx.fill();

      const hot = mixVisualColors(color, '#fff7db', 0.55 + particle.heat * 0.35);
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, coreRadius, 0, Math.PI * 2);
      ctx.fillStyle = colorWithAlpha(hot, alpha);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawReducedMotion(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    params: VisualizerParams,
    palette: readonly string[],
  ): void {
    if (this.drive <= 0.01) return;
    const count = Math.min(
      resolveRisingEmberParticleLimit(params.density),
      Math.round(4 + this.drive * 14),
    );
    const highContrast = params.highContrast === true;
    const minDimension = Math.max(24, Math.min(canvas.width, canvas.height));
    ctx.save();
    ctx.globalCompositeOperation = highContrast ? 'source-over' : 'lighter';
    for (let index = 0; index < count; index += 1) {
      const unit = (index + 0.5) / Math.max(1, count);
      const texture = seededUnit(index, 71);
      const angle = unit * Math.PI * 2;
      const radius = minDimension * (0.004 + texture * 0.006) * (0.8 + this.drive * 0.5);
      let x: number;
      let y: number;
      if (this.layout === 'radial') {
        const orbit = minDimension * (0.09 + texture * 0.31);
        x = canvas.width / 2 + Math.cos(angle) * orbit;
        y = canvas.height / 2 + Math.sin(angle) * orbit;
      } else {
        const spread = this.layout === 'centered' ? 0.3 : 0.9;
        x = canvas.width * (0.5 + (unit - 0.5) * spread);
        y = canvas.height * (0.78 - texture * 0.57);
      }
      const color = paletteColorAt(palette, 0.55 + texture * 0.45);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.8, radius), 0, Math.PI * 2);
      ctx.fillStyle = colorWithAlpha(color, 0.5 + this.drive * 0.42);
      ctx.shadowColor = highContrast ? 'transparent' : color;
      ctx.shadowBlur = highContrast ? 0 : radius * 2.4;
      ctx.fill();
    }
    ctx.restore();
  }
}

export const RISING_EMBER_EFFECT_DEFINITION: StackableEffectDefinition = Object.freeze({
  id: RISING_EMBER_ID,
  label: RISING_EMBER_LABEL,
  maxElements: RISING_EMBER_MAX_ELEMENTS,
  defaultParams: Object.freeze({
    sensitivity: 0.62,
    intensity: 0.72,
    smoothing: 0.58,
    density: 0.52,
    color: Object.freeze(['#ff5a1f', '#ff9f1c', '#ffd166', '#fff4d6']),
  }),
  create: () => new RisingEmberEffect(),
});
