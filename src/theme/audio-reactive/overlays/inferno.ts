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
    // CHANGED: higher continuous birth rate (pool-capped) packs the hearth row.
    // WHY: at speech drive the base read as isolated licks; fire needs overlapping tongues.
    const rate = this.drive <= 0.01
      ? previewMinimum
      : 7 + this.drive * (22 + clamp01(params.density) * 40);
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

    // CHANGED: flames paint as one additive pass, then embers paint above them.
    // WHY: interleaving kinds by pool slot let recycled sparks flicker under/over tongues;
    //      additive light is order-independent but the spark layer should stay in front.
    ctx.globalCompositeOperation = variant === 'void-inferno' ? 'source-over' : 'lighter';
    for (const particle of this.emitter.particles) {
      if (!particle.active || particle.kind !== 'flame') continue;
      this.drawFlame(ctx, particle, params, palette, variant);
    }
    for (const particle of this.emitter.particles) {
      if (!particle.active || particle.kind !== 'ember') continue;
      this.drawEmber(ctx, particle, palette, variant);
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
      ctx.shadowBlur = 0;
      ctx.fillStyle = colorWithAlpha(paletteColorAt(palette, 0.26 + life * 0.22), 0.58);
      ctx.strokeStyle = colorWithAlpha(paletteColorAt(palette, 0.78), 0.72);
      ctx.lineWidth = 1.25;
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
    // CHANGED: tongues shrink as they cool instead of only fading.
    // WHY: full-size faded tongues hovered detached above the bed; dying licks contract.
    const length = particle.size * lengthScale * (2.4 + (1 - life) * 3.4);
    const width = particle.size * widthScale * (0.55 + (1 - life) * 0.85);
    // Tips flutter harder than roots: whip amplitude grows over life.
    const whip = Math.sin(particle.phase * 1.7 + life * 9.5)
      * (0.3 + life * 1.1) * whipScale;
    const baseX = particle.x - directionX * length * 0.22;
    const baseY = particle.y - directionY * length * 0.22;
    const tipX = particle.x + directionX * length * 0.78 + normalX * whip * width * 1.5;
    const tipY = particle.y + directionY * length * 0.78 + normalY * whip * width * 1.5;

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
      baseX + normalX * width * 0.55 - directionX * width * 0.6,
      baseY + normalY * width * 0.55 - directionY * width * 0.6,
      baseX - normalX * width * 0.55 - directionX * width * 0.6,
      baseY - normalY * width * 0.55 - directionY * width * 0.6,
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
    ctx.beginPath();
    ctx.moveTo(particle.x, particle.y);
    ctx.lineTo(
      particle.x - particle.vx / speed * trail,
      particle.y - particle.vy / speed * trail,
    );
    ctx.strokeStyle = colorWithAlpha(color, variant === 'void-inferno' ? 0.95 : (1 - life) * 0.72);
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
