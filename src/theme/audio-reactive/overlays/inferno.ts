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
/** Three bounded paint passes per particle plus the hearth/body accent. */
export const INFERNO_MAX_ELEMENTS = INFERNO_MAX_PARTICLES * 3 + 3;

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

  private readonly initializeParticle: BoundedParticleInitializer<InfernoParticle> = (
    particle,
    _index,
    _recycled,
  ) => {
    const serial = this.spawnSerial;
    this.spawnSerial += 1;
    const source = seededUnit(serial, 3);
    const texture = seededUnit(serial, 11);
    const kind: InfernoParticleKind = serial % 9 === 0
      ? 'smoke'
      : serial % 4 === 0
        ? 'ember'
        : 'flame';
    const minDimension = Math.max(24, Math.min(this.canvasWidth, this.canvasHeight));
    const intensity = 0.72 + this.drive * 0.72;

    particle.kind = kind;
    particle.phase = seededUnit(serial, 17) * Math.PI * 2;
    particle.heat = clamp01(0.55 + this.drive * 0.4 + texture * 0.18);
    particle.drift = (seededUnit(serial, 23) - 0.5) * 2;
    particle.size = minDimension * (
      kind === 'smoke'
        ? 0.018 + texture * 0.018
        : kind === 'ember'
          ? 0.0028 + texture * 0.0035
          : 0.008 + texture * 0.009
    ) * intensity;
    particle.lifetime = kind === 'smoke'
      ? 1.7 + texture * 1.5
      : kind === 'ember'
        ? 0.75 + texture * 0.95
        : 0.62 + texture * 0.92;

    if (this.layout === 'radial') {
      const angle = source * Math.PI * 2;
      const radius = minDimension * (0.07 + seededUnit(serial, 29) * 0.035);
      const speed = (kind === 'smoke' ? 16 : kind === 'ember' ? 78 : 42)
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
      particle.y = this.canvasHeight * (0.91 + seededUnit(serial, 31) * 0.055);
      const speed = (kind === 'smoke' ? 19 : kind === 'ember' ? 94 : 48)
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
      this.drawReducedMotion(ctx, canvas, params, palette, variant);
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

    this.emitter.advance(this.pendingDt);
    this.advanceParticles(frame, params, this.pendingDt);
    this.emitParticles(frame, params, particleLimit, environment);
    this.pendingDt = 0;

    this.drawInferno(ctx, canvas, params, palette, variant);
  }

  private resetParticles(): void {
    this.emitter.clear();
    this.emissionCarry = 0;
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

  private emitParticles(
    frame: AudioVizFrame,
    params: VisualizerParams,
    particleLimit: number,
    environment: AudioVisualRenderEnvironment | undefined,
  ): void {
    const previewMinimum = environment?.amplitudeMode === 'preview' ? 4 : 0;
    const rate = this.drive <= 0.01
      ? previewMinimum
      : 5 + this.drive * (17 + clamp01(params.density) * 36);
    this.emissionCarry += rate * this.pendingDt;
    if (frame.transient) {
      // CHANGED: onset bursts enter the already-bounded pool immediately.
      // WHY: brief consonants should throw sparks even when they land between continuous emission ticks.
      this.emissionCarry += 4 + Math.round(this.trebleDrive * 4);
    }

    let emitted = 0;
    while (this.emissionCarry >= 1 && emitted < 10 && this.emitter.activeCount <= particleLimit) {
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
    const flowStrength = 12 + this.midDrive * 30 + clamp01(params.intensity) * 13;
    const smoothingDrag = Math.exp(-dt * (0.28 + clamp01(params.smoothing) * 0.72));
    const minDimension = Math.max(24, Math.min(this.canvasWidth, this.canvasHeight));
    this.flowOptions.complexity = 0.42 + this.midDrive * 0.42;
    this.flowOptions.speed = 0.32 + (1 - clamp01(params.smoothing)) * 0.72;

    for (const particle of this.emitter.particles) {
      if (!particle.active) continue;
      const normalizedX = particle.x / this.canvasWidth * 2 - 1;
      const normalizedY = particle.y / this.canvasHeight * 2 - 1;
      this.flowOptions.seed = 61 + particle.index * 0.17;
      const flow = sampleLayeredVectorFlowField(
        normalizedX,
        normalizedY,
        timeSeconds,
        this.flowOptions,
        this.flowVector,
      );
      const life = clamp01(particle.age / particle.lifetime);
      const buoyancy = particle.kind === 'smoke' ? 13 : particle.kind === 'ember' ? 24 : 34;

      if (this.layout === 'radial') {
        const dx = particle.x - this.canvasWidth / 2;
        const dy = particle.y - this.canvasHeight / 2;
        const length = Math.max(1, Math.hypot(dx, dy));
        particle.vx += (dx / length * buoyancy + flow.x * flowStrength) * dt;
        particle.vy += (dy / length * buoyancy + flow.y * flowStrength) * dt;
      } else {
        particle.vx += (flow.x * flowStrength + Math.sin(particle.phase + life * 8) * 8) * dt;
        particle.vy += (-buoyancy + flow.y * flowStrength * 0.35) * dt;
      }

      particle.vx *= smoothingDrag;
      particle.vy *= particle.kind === 'ember' ? 0.998 : smoothingDrag;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      if (particle.kind === 'smoke') particle.size += minDimension * 0.009 * dt;
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

    ctx.globalCompositeOperation = variant === 'void-inferno' ? 'source-over' : 'lighter';
    for (const particle of this.emitter.particles) {
      if (!particle.active || particle.kind === 'smoke') continue;
      if (particle.kind === 'ember') this.drawEmber(ctx, particle, palette, variant);
      else this.drawFlame(ctx, particle, params, palette, variant);
    }
    ctx.restore();
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
    const centerY = this.layout === 'radial' ? canvas.height / 2 : canvas.height * 0.94;
    const radius = this.layout === 'linear'
      ? Math.max(canvas.width * 0.52, minDimension)
      : minDimension * (this.layout === 'radial' ? 0.17 : 0.31);
    const hot = paletteColorAt(palette, 1);
    const low = paletteColorAt(palette, variant === 'void-inferno' ? 0.2 : 0.52);

    if (variant === 'void-inferno') {
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

    const glow = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
    glow.addColorStop(0, colorWithAlpha(hot, 0.3 + this.drive * 0.24));
    glow.addColorStop(0.35, colorWithAlpha(low, 0.14 + this.drive * 0.16));
    glow.addColorStop(1, colorWithAlpha(low, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawSmoke(
    ctx: CanvasRenderingContext2D,
    particle: InfernoParticle,
    palette: readonly string[],
    variant: InfernoVariant,
  ): void {
    const life = clamp01(particle.age / particle.lifetime);
    const fade = Math.sin(life * Math.PI) * (0.12 + this.midDrive * 0.18);
    const radius = particle.size * (1.1 + life * 1.5);
    const color = variant === 'void-inferno'
      ? paletteColorAt(palette, 0.26 + life * 0.22)
      : mixVisualColors(paletteColorAt(palette, 0.05), '#5d6268', 0.58);
    ctx.shadowBlur = 0;
    ctx.fillStyle = colorWithAlpha(color, variant === 'void-inferno' ? 0.58 : fade);
    ctx.strokeStyle = colorWithAlpha(
      paletteColorAt(palette, variant === 'void-inferno' ? 0.78 : 0.34),
      variant === 'void-inferno' ? 0.72 : fade * 0.44,
    );
    ctx.lineWidth = variant === 'void-inferno' ? 1.25 : 0.7;
    ctx.beginPath();
    ctx.ellipse(
      particle.x,
      particle.y,
      radius * (1.05 + particle.drift * 0.08),
      radius * 0.72,
      particle.phase + life * 0.35,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.stroke();
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
    const outer = paletteColorAt(palette, 0.08 + heat * 0.8);
    const inner = paletteColorAt(palette, 0.48 + heat * 0.52);
    const opacity = Math.sin(Math.min(1, life * 1.5) * Math.PI / 2) * (1 - life) ** 0.42;

    if (variant === 'void-inferno') {
      this.traceFlameTongue(ctx, particle, 1.16);
      ctx.fillStyle = colorWithAlpha(paletteColorAt(palette, 0.04), 0.96);
      ctx.strokeStyle = colorWithAlpha(inner, 0.9);
      ctx.lineWidth = 1.35 + heat * 0.85;
      ctx.shadowBlur = 0;
      ctx.fill();
      ctx.stroke();
      return;
    }

    this.traceFlameTongue(ctx, particle, 1.22);
    ctx.fillStyle = colorWithAlpha(outer, opacity * (0.28 + clamp01(params.intensity) * 0.32));
    ctx.shadowColor = colorWithAlpha(outer, 0.7);
    ctx.shadowBlur = 5 + heat * 8;
    ctx.fill();

    this.traceFlameTongue(ctx, particle, 0.58);
    ctx.fillStyle = colorWithAlpha(inner, opacity * (0.54 + heat * 0.35));
    ctx.shadowBlur = 0;
    ctx.fill();
  }

  private traceFlameTongue(
    ctx: CanvasRenderingContext2D,
    particle: InfernoParticle,
    scale: number,
  ): void {
    const speed = Math.max(1, Math.hypot(particle.vx, particle.vy));
    const directionX = particle.vx / speed;
    const directionY = particle.vy / speed;
    const normalX = -directionY;
    const normalY = directionX;
    const life = clamp01(particle.age / particle.lifetime);
    const length = particle.size * scale * (3.2 + (1 - life) * 2.7);
    const width = particle.size * scale * (0.66 + (1 - life) * 0.46);
    const baseX = particle.x - directionX * length * 0.24;
    const baseY = particle.y - directionY * length * 0.24;
    const tipX = particle.x + directionX * length * 0.76;
    const tipY = particle.y + directionY * length * 0.76;
    const bend = Math.sin(particle.phase + life * 7) * width * 0.72;

    ctx.beginPath();
    ctx.moveTo(baseX - normalX * width, baseY - normalY * width);
    ctx.bezierCurveTo(
      particle.x - normalX * width * 1.18,
      particle.y - normalY * width * 1.18,
      tipX + normalX * bend,
      tipY + normalY * bend,
      tipX,
      tipY,
    );
    ctx.bezierCurveTo(
      tipX - normalX * bend * 0.35,
      tipY - normalY * bend * 0.35,
      particle.x + normalX * width * 1.18,
      particle.y + normalY * width * 1.18,
      baseX + normalX * width,
      baseY + normalY * width,
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
    ctx.beginPath();
    ctx.moveTo(particle.x, particle.y);
    ctx.lineTo(
      particle.x - particle.vx / speed * trail,
      particle.y - particle.vy / speed * trail,
    );
    ctx.strokeStyle = colorWithAlpha(color, variant === 'void-inferno' ? 0.95 : (1 - life) * 0.82);
    ctx.lineWidth = variant === 'void-inferno' ? 1.65 : Math.max(0.8, particle.size * 0.48);
    ctx.shadowColor = variant === 'void-inferno' ? 'transparent' : color;
    ctx.shadowBlur = variant === 'void-inferno' ? 0 : 5;
    ctx.stroke();
  }

  private drawReducedMotion(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    params: VisualizerParams,
    palette: readonly string[],
    variant: InfernoVariant,
  ): void {
    ctx.save();
    this.drawHearth(ctx, canvas, palette, variant);
    ctx.globalCompositeOperation = variant === 'void-inferno' ? 'source-over' : 'lighter';
    const count = this.drive <= 0.01
      ? 0
      : Math.min(
        resolveInfernoParticleLimit(params.density),
        Math.round(7 + this.drive * 17),
      );
    const minDimension = Math.max(24, Math.min(canvas.width, canvas.height));
    for (let index = 0; index < count; index += 1) {
      const unit = (index + 0.5) / Math.max(1, count);
      const texture = seededUnit(index, 71);
      const particle = this.reducedParticle;
      particle.index = index;
      particle.phase = seededUnit(index, 73) * Math.PI * 2;
      particle.age = particle.lifetime * (0.22 + texture * 0.32);
      particle.size = minDimension * (0.009 + texture * 0.009) * (0.7 + this.drive * 0.65);
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
        particle.vx = (texture - 0.5) * 0.24;
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
