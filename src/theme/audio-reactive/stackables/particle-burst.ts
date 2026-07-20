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

export const PARTICLE_BURST_ID = 'particle-burst' as const;
export const PARTICLE_BURST_LABEL = 'Particle Burst' as const;
export const PARTICLE_BURST_MIN_PARTICLES = 14;
export const PARTICLE_BURST_MAX_PARTICLES = 28;
export const PARTICLE_BURST_MAX_CONCURRENT_BURSTS = 3;
export const PARTICLE_BURST_PARTICLE_PASSES = 3;
export const PARTICLE_BURST_BURST_PASSES = 3;
export const PARTICLE_BURST_MAX_POOL_SIZE =
  PARTICLE_BURST_MAX_PARTICLES * PARTICLE_BURST_MAX_CONCURRENT_BURSTS;
export const PARTICLE_BURST_MAX_ELEMENTS =
  PARTICLE_BURST_MAX_POOL_SIZE * PARTICLE_BURST_PARTICLE_PASSES
  + PARTICLE_BURST_MAX_CONCURRENT_BURSTS * PARTICLE_BURST_BURST_PASSES;

interface BurstParticle extends BoundedParticle {
  index: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  spin: number;
  drag: number;
  gravity: number;
  curl: number;
  heat: number;
  stretch: number;
}

interface BurstShell {
  active: boolean;
  age: number;
  lifetime: number;
  x: number;
  y: number;
  strength: number;
  seed: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function seededUnit(index: number, salt: number): number {
  const value = Math.sin(index * 73.319 + salt * 19.733) * 43758.5453;
  return value - Math.floor(value);
}

function resolveLayout(params: VisualizerParams): LayoutMode {
  return params.layoutMode === 'centered' || params.layoutMode === 'radial'
    ? params.layoutMode
    : 'linear';
}

function bandWeight(index: number, params: VisualizerParams): number {
  if (index < 10) return params.bassWeight ?? 1;
  if (index < 22) return params.midWeight ?? 1;
  return params.trebleWeight ?? 1;
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

export function resolveParticleBurstCount(density: number): number {
  return Math.round(
    PARTICLE_BURST_MIN_PARTICLES
      + clamp01(density) * (PARTICLE_BURST_MAX_PARTICLES - PARTICLE_BURST_MIN_PARTICLES),
  );
}

export function resolveParticleBurstPoolLimit(density: number): number {
  return resolveParticleBurstCount(density) * PARTICLE_BURST_MAX_CONCURRENT_BURSTS;
}

/**
 * CHANGED: Particle Burst is a bounded onset instrument with fixed local shells and lifetime-pooled shards.
 * WHY: speech punctuation should produce deliberate kinetic blooms without another continuous particle field or event framework.
 */
class ParticleBurstEffect implements StackableEffect {
  readonly id = PARTICLE_BURST_ID;

  private readonly emitter = new BoundedParticleEmitter<BurstParticle>(
    PARTICLE_BURST_MAX_POOL_SIZE,
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
      rotation: 0,
      spin: 0,
      drag: 1,
      gravity: 0,
      curl: 0,
      heat: 1,
      stretch: 1,
    }),
  );

  private readonly shells: BurstShell[] = Array.from(
    { length: PARTICLE_BURST_MAX_CONCURRENT_BURSTS },
    () => ({
      active: false,
      age: 0,
      lifetime: 0.8,
      x: 0,
      y: 0,
      strength: 0,
      seed: 0,
    }),
  );

  private readonly previousBands = new Float32Array(32);
  private pendingDt = 0;
  private canvasWidth = 0;
  private canvasHeight = 0;
  private layout: LayoutMode = 'linear';
  private drive = 0;
  private bassDrive = 0;
  private midDrive = 0;
  private trebleDrive = 0;
  private positiveFlux = 0;
  private dominantBand = 0;
  private hasBandHistory = false;
  private wasTransient = false;
  private wasReducedMotion = false;
  private cooldownRemaining = 0;
  private lastPreviewCycle = -1;
  private burstCursor = 0;
  private burstSerial = 0;
  private spawnOrdinal = 0;
  private spawningShell = 0;
  private spawnBaseAngle = 0;
  private spawnSpread = Math.PI * 2;

  private readonly initializeParticle: BoundedParticleInitializer<BurstParticle> = (
    particle,
  ) => {
    const shell = this.shells[this.spawningShell]!;
    const serial = this.burstSerial * 97 + this.spawnOrdinal;
    const unit = (this.spawnOrdinal + 0.5) / Math.max(1, resolveParticleBurstCount(this.currentDensity));
    const texture = seededUnit(serial, 7);
    const directionJitter = (seededUnit(serial, 13) - 0.5) * 0.19;
    const angle = this.spawnBaseAngle
      + (unit - 0.5) * this.spawnSpread
      + directionJitter;
    const minDimension = Math.max(24, Math.min(this.canvasWidth, this.canvasHeight));
    const speed = minDimension
      * (0.2 + this.drive * 0.31 + this.trebleDrive * 0.16)
      * (0.72 + texture * 0.56);

    particle.x = shell.x;
    particle.y = shell.y;
    particle.vx = Math.cos(angle) * speed;
    particle.vy = Math.sin(angle) * speed;
    particle.size = minDimension
      * (0.0035 + seededUnit(serial, 17) * 0.005)
      * (0.82 + this.drive * 0.44);
    particle.rotation = angle + (seededUnit(serial, 23) - 0.5) * 0.7;
    particle.spin = (seededUnit(serial, 29) - 0.5) * (5.5 + this.trebleDrive * 7);
    particle.drag = 0.82 + seededUnit(serial, 31) * 1.08;
    particle.gravity = this.layout === 'linear'
      ? minDimension * (0.09 + this.bassDrive * 0.1)
      : minDimension * 0.018;
    particle.curl = (seededUnit(serial, 37) - 0.5) * (13 + this.midDrive * 31);
    particle.heat = 0.46 + seededUnit(serial, 41) * 0.54;
    particle.stretch = 2.4 + seededUnit(serial, 43) * 3.7 + this.trebleDrive * 1.8;
    particle.lifetime = 0.68
      + seededUnit(serial, 47) * 0.72
      + this.currentSmoothing * 0.28;
    this.spawnOrdinal += 1;
  };

  private currentDensity = 0.5;
  private currentSmoothing = 0.5;

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
      this.clearMotion(true);
    }

    this.currentDensity = clamp01(params.density);
    this.currentSmoothing = clamp01(params.smoothing);
    this.emitter.configureLimit(resolveParticleBurstPoolLimit(params.density));

    const reduceMotion = environment?.reduceMotion === true;
    if (reduceMotion !== this.wasReducedMotion) {
      this.clearMotion(true);
      this.wasReducedMotion = reduceMotion;
    }

    this.resolveAudio(frame, params, environment, reduceMotion);
    const palette = resolveVisualPalette(params.color);
    if (reduceMotion) {
      this.updateBandHistory(frame);
      this.wasTransient = frame.transient === true;
      this.drawReducedMotion(ctx, canvas, params, palette);
      this.pendingDt = 0;
      return;
    }

    this.advanceMotion(this.pendingDt);
    if (this.shouldTriggerBurst(frame, params, environment)) {
      this.spawnBurst(params);
    }
    this.updateBandHistory(frame);
    this.wasTransient = frame.transient === true;
    this.pendingDt = 0;
    this.drawAnimated(ctx, params, palette);
  }

  getPerformanceCost(): number {
    return this.emitter.limit * PARTICLE_BURST_PARTICLE_PASSES
      + PARTICLE_BURST_MAX_CONCURRENT_BURSTS * PARTICLE_BURST_BURST_PASSES;
  }

  private clearMotion(resetAudioHistory: boolean): void {
    this.emitter.clear();
    for (const shell of this.shells) {
      shell.active = false;
      shell.age = 0;
    }
    this.cooldownRemaining = 0;
    this.lastPreviewCycle = -1;
    this.burstCursor = 0;
    if (resetAudioHistory) {
      this.hasBandHistory = false;
      this.previousBands.fill(0);
    }
  }

  private resolveAudio(
    frame: AudioVizFrame,
    params: VisualizerParams,
    environment: AudioVisualRenderEnvironment | undefined,
    reduceMotion: boolean,
  ): void {
    let bass = 0;
    let mids = 0;
    let treble = 0;
    let flux = 0;
    let strongest = -1;
    let strongestIndex = 0;

    for (let index = 0; index < 32; index += 1) {
      const value = clamp01(frame.bands[index] ?? 0);
      const weighted = value * bandWeight(index, params);
      if (index < 10) bass += weighted / 10;
      else if (index < 22) mids += weighted / 12;
      else treble += weighted / 10;
      if (this.hasBandHistory) {
        flux += Math.max(0, value - this.previousBands[index]!)
          * bandWeight(index, params) / 32;
      }
      if (weighted > strongest) {
        strongest = weighted;
        strongestIndex = index;
      }
    }

    this.bassDrive = clamp01(bass);
    this.midDrive = clamp01(mids);
    this.trebleDrive = clamp01(treble);
    this.positiveFlux = clamp01(flux);
    this.dominantBand = strongestIndex;
    const previewLift = environment?.amplitudeMode === 'preview'
      ? reduceMotion
        ? 0.18
        : 0.18 + Math.sin(frame.timeMs / 1000 * 0.37) * 0.035
      : 0;
    const sensitivity = 0.58 + clamp01(params.sensitivity) * 1.42;
    this.drive = clamp01(
      (clamp01(frame.energy) * 0.28
        + this.bassDrive * 0.19
        + this.midDrive * 0.25
        + this.trebleDrive * 0.28
        + previewLift)
      * sensitivity,
    );
  }

  private updateBandHistory(frame: AudioVizFrame): void {
    for (let index = 0; index < this.previousBands.length; index += 1) {
      this.previousBands[index] = clamp01(frame.bands[index] ?? 0);
    }
    this.hasBandHistory = true;
  }

  private shouldTriggerBurst(
    frame: AudioVizFrame,
    params: VisualizerParams,
    environment: AudioVisualRenderEnvironment | undefined,
  ): boolean {
    const explicitOnset = frame.transient === true && !this.wasTransient;
    const fluxThreshold = 0.052
      + clamp01(params.smoothing) * 0.052
      - clamp01(params.sensitivity) * 0.026;
    // CHANGED: the effect keeps a preset-local positive-flux fallback beside the carrier hint.
    // WHY: live capture does not yet publish transient hints, so a one-shot effect must still react to real speech attacks.
    const spectralOnset = this.hasBandHistory
      && this.drive > 0.055
      && this.positiveFlux > fluxThreshold
      && this.cooldownRemaining <= 0;

    let previewOnset = false;
    if (environment?.amplitudeMode === 'preview') {
      const intervalMs = 1500 + clamp01(params.smoothing) * 900;
      const cycle = Math.floor(Math.max(0, frame.timeMs) / intervalMs);
      previewOnset = cycle !== this.lastPreviewCycle;
      this.lastPreviewCycle = cycle;
    }
    return explicitOnset || spectralOnset || previewOnset;
  }

  private spawnBurst(params: VisualizerParams): void {
    const shellIndex = this.burstCursor;
    this.burstCursor = (this.burstCursor + 1) % this.shells.length;
    const shell = this.shells[shellIndex]!;
    const serial = this.burstSerial;
    this.burstSerial += 1;
    const minDimension = Math.max(24, Math.min(this.canvasWidth, this.canvasHeight));
    const bandUnit = (this.dominantBand + 0.5) / 32;
    const texture = seededUnit(serial, 59);

    shell.active = true;
    shell.age = 0;
    shell.lifetime = 0.58 + clamp01(params.smoothing) * 0.38;
    shell.strength = 0.68 + this.drive * 0.52;
    shell.seed = texture;

    if (this.layout === 'centered') {
      const orbit = minDimension * (0.025 + texture * 0.055);
      const angle = bandUnit * Math.PI * 2 - Math.PI / 2;
      shell.x = this.canvasWidth / 2 + Math.cos(angle) * orbit;
      shell.y = this.canvasHeight / 2 + Math.sin(angle) * orbit;
      this.spawnBaseAngle = texture * Math.PI * 2;
      this.spawnSpread = Math.PI * 2;
    } else if (this.layout === 'radial') {
      const angle = bandUnit * Math.PI * 2 - Math.PI / 2;
      const radius = minDimension * (0.12 + texture * 0.09);
      shell.x = this.canvasWidth / 2 + Math.cos(angle) * radius;
      shell.y = this.canvasHeight / 2 + Math.sin(angle) * radius;
      this.spawnBaseAngle = angle;
      this.spawnSpread = Math.PI * (0.72 + this.midDrive * 0.5);
    } else {
      shell.x = this.canvasWidth * (0.12 + bandUnit * 0.76);
      shell.y = this.canvasHeight * (0.73 + texture * 0.16);
      this.spawnBaseAngle = -Math.PI / 2;
      this.spawnSpread = Math.PI * (0.84 + this.midDrive * 0.42);
    }

    this.spawningShell = shellIndex;
    this.spawnOrdinal = 0;
    const count = resolveParticleBurstCount(params.density);
    for (let index = 0; index < count; index += 1) {
      this.emitter.emit(this.initializeParticle);
    }
    this.cooldownRemaining = 0.16 + clamp01(params.smoothing) * 0.34;
  }

  private advanceMotion(dt: number): void {
    if (dt <= 0) return;
    this.cooldownRemaining = Math.max(0, this.cooldownRemaining - dt);
    this.emitter.advance(dt);
    for (const shell of this.shells) {
      if (!shell.active) continue;
      shell.age += dt;
      if (shell.age >= shell.lifetime) shell.active = false;
    }

    for (const particle of this.emitter.particles) {
      if (!particle.active) continue;
      const speed = Math.max(1, Math.hypot(particle.vx, particle.vy));
      const normalX = -particle.vy / speed;
      const normalY = particle.vx / speed;
      particle.vx += normalX * particle.curl * dt;
      particle.vy += normalY * particle.curl * dt + particle.gravity * dt;
      const drag = Math.exp(-particle.drag * dt);
      particle.vx *= drag;
      particle.vy *= drag;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.rotation += particle.spin * dt;
    }
  }

  private drawAnimated(
    ctx: CanvasRenderingContext2D,
    params: VisualizerParams,
    palette: readonly string[],
  ): void {
    if (this.emitter.activeCount === 0 && !this.shells.some((shell) => shell.active)) return;
    const highContrast = params.highContrast === true;
    const intensity = 0.58 + clamp01(params.intensity) * 0.76;
    const minDimension = Math.max(24, Math.min(this.canvasWidth, this.canvasHeight));
    ctx.save();
    ctx.globalCompositeOperation = highContrast ? 'source-over' : 'lighter';

    for (const shell of this.shells) {
      if (!shell.active) continue;
      const life = clamp01(shell.age / shell.lifetime);
      const alpha = (1 - life) ** 1.35 * shell.strength * intensity;
      const radius = minDimension * (0.018 + life * (0.13 + shell.seed * 0.05));
      const color = paletteColorAt(palette, 0.36 + shell.seed * 0.5);
      ctx.shadowColor = highContrast ? 'transparent' : color;
      ctx.shadowBlur = highContrast ? 0 : minDimension * 0.035 * (1 - life);

      ctx.beginPath();
      ctx.arc(shell.x, shell.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = colorWithAlpha(color, alpha * (highContrast ? 0.92 : 0.48));
      ctx.lineWidth = Math.max(highContrast ? 1.5 : 0.75, minDimension * 0.0035 * (1 - life * 0.55));
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(shell.x, shell.y, radius * (0.42 + life * 0.2), 0, Math.PI * 2);
      ctx.strokeStyle = colorWithAlpha(mixVisualColors(color, '#ffffff', 0.66), alpha * 0.58);
      ctx.lineWidth = Math.max(0.8, minDimension * 0.0022);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(shell.x, shell.y, Math.max(0.8, minDimension * 0.009 * (1 - life)), 0, Math.PI * 2);
      ctx.fillStyle = colorWithAlpha('#ffffff', alpha * 0.88);
      ctx.fill();
    }

    for (const particle of this.emitter.particles) {
      if (!particle.active) continue;
      const life = clamp01(particle.age / particle.lifetime);
      const fade = Math.sin(Math.PI * Math.min(1, life / 0.92)) * (1 - life * 0.28);
      const alpha = clamp01(fade * intensity);
      const speed = Math.max(1, Math.hypot(particle.vx, particle.vy));
      const directionX = particle.vx / speed;
      const directionY = particle.vy / speed;
      const trailLength = particle.size * particle.stretch * (0.75 + (1 - life) * 0.5);
      const color = paletteColorAt(palette, clamp01(particle.heat - life * 0.34));
      const hot = mixVisualColors(color, '#ffffff', 0.55 + particle.heat * 0.36);

      ctx.shadowColor = highContrast ? 'transparent' : color;
      ctx.shadowBlur = highContrast ? 0 : particle.size * 3.8;
      const trailX = particle.x - directionX * trailLength;
      const trailY = particle.y - directionY * trailLength;
      ctx.beginPath();
      ctx.moveTo(particle.x, particle.y);
      ctx.lineTo(trailX, trailY);
      // CHANGED: the fragment streak fades full-alpha head to zero tail in both
      //          contrast modes (QA Pass D §3 line-taper note).
      // WHY: a flat-alpha straight segment reads as a bare drawn line; the
      //      lengthwise gradient is the prescribed performant smoothing.
      const taper = ctx.createLinearGradient(particle.x, particle.y, trailX, trailY);
      taper.addColorStop(0, colorWithAlpha(color, alpha * (highContrast ? 0.92 : 0.62)));
      taper.addColorStop(1, colorWithAlpha(color, 0));
      ctx.strokeStyle = taper;
      ctx.lineWidth = Math.max(highContrast ? 1.1 : 0.65, particle.size * 0.44);
      ctx.stroke();

      const cos = Math.cos(particle.rotation);
      const sin = Math.sin(particle.rotation);
      const long = particle.size * (1.25 + (1 - life) * 0.72);
      const short = particle.size * 0.58;
      ctx.beginPath();
      ctx.moveTo(particle.x + cos * long, particle.y + sin * long);
      ctx.lineTo(particle.x - sin * short, particle.y + cos * short);
      ctx.lineTo(particle.x - cos * long, particle.y - sin * long);
      ctx.lineTo(particle.x + sin * short, particle.y - cos * short);
      ctx.closePath();
      ctx.fillStyle = colorWithAlpha(color, alpha * (highContrast ? 0.76 : 0.52));
      ctx.fill();

      ctx.beginPath();
      ctx.arc(particle.x, particle.y, Math.max(0.65, particle.size * 0.42), 0, Math.PI * 2);
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
    const count = resolveParticleBurstCount(params.density);
    const highContrast = params.highContrast === true;
    const minDimension = Math.max(24, Math.min(canvas.width, canvas.height));
    const bandUnit = (this.dominantBand + 0.5) / 32;
    let originX = canvas.width / 2;
    let originY = canvas.height / 2;
    let baseAngle = 0;
    let spread = Math.PI * 2;
    if (this.layout === 'linear') {
      originX = canvas.width * (0.12 + bandUnit * 0.76);
      originY = canvas.height * 0.82;
      baseAngle = -Math.PI / 2;
      spread = Math.PI * 0.92;
    } else if (this.layout === 'radial') {
      baseAngle = bandUnit * Math.PI * 2 - Math.PI / 2;
      originX += Math.cos(baseAngle) * minDimension * 0.16;
      originY += Math.sin(baseAngle) * minDimension * 0.16;
      spread = Math.PI * 0.86;
    }

    ctx.save();
    ctx.globalCompositeOperation = highContrast ? 'source-over' : 'lighter';
    for (let index = 0; index < count; index += 1) {
      const unit = (index + 0.5) / count;
      const texture = seededUnit(index, 83);
      const angle = baseAngle + (unit - 0.5) * spread;
      const radius = minDimension * (0.045 + texture * 0.19) * (0.72 + this.drive * 0.38);
      const x = originX + Math.cos(angle) * radius;
      const y = originY + Math.sin(angle) * radius;
      const color = paletteColorAt(palette, 0.28 + texture * 0.7);
      ctx.shadowColor = highContrast ? 'transparent' : color;
      ctx.shadowBlur = highContrast ? 0 : minDimension * 0.012;
      ctx.beginPath();
      ctx.moveTo(originX, originY);
      ctx.lineTo(x, y);
      // CHANGED: frozen rays fade from the burst origin (inner, full alpha) to
      //          zero at the fragment tip; the tip dot still anchors the outer
      //          end (QA Pass D §3 line-taper note).
      const rayTaper = ctx.createLinearGradient(originX, originY, x, y);
      rayTaper.addColorStop(0, colorWithAlpha(color, 0.24 + this.drive * 0.38));
      rayTaper.addColorStop(1, colorWithAlpha(color, 0));
      ctx.strokeStyle = rayTaper;
      ctx.lineWidth = highContrast ? 1.3 : 0.75;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.8, minDimension * (0.003 + texture * 0.003)), 0, Math.PI * 2);
      ctx.fillStyle = colorWithAlpha(mixVisualColors(color, '#ffffff', 0.62), 0.64 + this.drive * 0.3);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(originX, originY, minDimension * (0.025 + this.drive * 0.018), 0, Math.PI * 2);
    ctx.strokeStyle = colorWithAlpha(palette[palette.length - 1] ?? '#ffffff', 0.72);
    ctx.lineWidth = highContrast ? 2 : 1.1;
    ctx.stroke();
    ctx.restore();
  }
}

export const PARTICLE_BURST_EFFECT_DEFINITION: StackableEffectDefinition = Object.freeze({
  id: PARTICLE_BURST_ID,
  label: PARTICLE_BURST_LABEL,
  maxElements: PARTICLE_BURST_MAX_ELEMENTS,
  defaultParams: Object.freeze({
    sensitivity: 0.72,
    intensity: 0.78,
    smoothing: 0.36,
    density: 0.58,
    color: Object.freeze(['#7dd3fc', '#a78bfa', '#f472b6', '#fef08a', '#ffffff']),
  }),
  create: () => new ParticleBurstEffect(),
});
