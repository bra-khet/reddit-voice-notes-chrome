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

export const AURORA_ID = 'aurora' as const;
export const AURORA_LABEL = 'Aurora' as const;
export const AURORA_MIN_PARTICLES = 100;
export const AURORA_MAX_PARTICLES = 200;
/** Each shard has one translucent body and one luminous fold, plus three source accents. */
export const AURORA_MAX_ELEMENTS = AURORA_MAX_PARTICLES * 2 + 3;

interface AuroraRibbonParticle extends BoundedParticle {
  index: number;
  band: number;
  lane: number;
  x: number;
  y: number;
  previousX: number;
  previousY: number;
  vx: number;
  vy: number;
  width: number;
  phase: number;
  depth: number;
  colorPosition: number;
  sourceDrive: number;
}

const AURORA_BAND_COUNT = 32;
const AURORA_LANE_COUNT = 7;
const HIGH_CONTRAST_PALETTE = Object.freeze([
  '#00f5ff',
  '#39ff88',
  '#f6ff7a',
  '#ffffff',
]);

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function seededUnit(index: number, salt: number): number {
  const value = Math.sin(index * 78.233 + salt * 19.419) * 43758.5453;
  return value - Math.floor(value);
}

function resolveLayout(params: VisualizerParams): LayoutMode {
  return params.layoutMode === 'centered' || params.layoutMode === 'radial'
    ? params.layoutMode
    : 'linear';
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

export function resolveAuroraParticleLimit(density: number): number {
  return Math.round(
    AURORA_MIN_PARTICLES
      + clamp01(density) * (AURORA_MAX_PARTICLES - AURORA_MIN_PARTICLES),
  );
}

function bandWeight(index: number, params: VisualizerParams): number {
  if (index < 11) return params.bassWeight ?? 1;
  if (index < 22) return params.midWeight ?? 1;
  return params.trebleWeight ?? 1;
}

/**
 * CHANGED: Aurora is a registry-native field of finite, flow-advected ribbon shards.
 * WHY: layered curtains need coherent audio-shaped folds without retained canvas pixels or RAF allocation.
 */
class AuroraVisual implements AudioVisual {
  readonly id = AURORA_ID;
  readonly kind = 'overlay' as const;
  readonly supportedLayouts = Object.freeze(['linear', 'centered', 'radial'] as const);

  private readonly emitter = new BoundedParticleEmitter<AuroraRibbonParticle>(
    AURORA_MAX_PARTICLES,
    (index) => ({
      index,
      active: false,
      age: 0,
      lifetime: 1,
      band: 0,
      lane: 0,
      x: 0,
      y: 0,
      previousX: 0,
      previousY: 0,
      vx: 0,
      vy: 0,
      width: 1,
      phase: 0,
      depth: 1,
      colorPosition: 0,
      sourceDrive: 0,
    }),
  );
  private readonly bandDrives = new Float32Array(AURORA_BAND_COUNT);
  private readonly flowVector = { x: 0, y: -1 };
  private readonly flowOptions: LayeredFlowFieldOptions = {
    complexity: 0.58,
    speed: 0.46,
    seed: 83,
  };
  private readonly reducedParticle: AuroraRibbonParticle = {
    index: 0,
    active: true,
    age: 0.35,
    lifetime: 1,
    band: 0,
    lane: 0,
    x: 0,
    y: 0,
    previousX: 0,
    previousY: 0,
    vx: 0,
    vy: -1,
    width: 1,
    phase: 0,
    depth: 1,
    colorPosition: 0,
    sourceDrive: 0,
  };

  private canvasWidth = 0;
  private canvasHeight = 0;
  private layout: LayoutMode = 'linear';
  private pendingDt = 0;
  private emissionCarry = 0;
  private spawnSerial = 0;
  private drive = 0;
  private bassDrive = 0;
  private midDrive = 0;
  private trebleDrive = 0;
  private priming = false;
  private wasReducedMotion = false;

  private readonly initializeParticle: BoundedParticleInitializer<AuroraRibbonParticle> = (
    particle,
  ) => {
    const serial = this.spawnSerial;
    this.spawnSerial += 1;
    const band = serial % AURORA_BAND_COUNT;
    const lane = serial % AURORA_LANE_COUNT;
    const texture = seededUnit(serial, 3);
    const side = serial % 2 === 0 ? -1 : 1;
    const minDimension = Math.max(24, Math.min(this.canvasWidth, this.canvasHeight));
    const sourceDrive = this.bandDrives[band] ?? 0;

    particle.band = band;
    particle.lane = lane;
    particle.phase = seededUnit(serial, 7) * Math.PI * 2;
    particle.depth = 0.46 + seededUnit(serial, 11) * 0.54;
    particle.colorPosition = clamp01(lane / Math.max(1, AURORA_LANE_COUNT - 1)
      + (texture - 0.5) * 0.16);
    particle.sourceDrive = sourceDrive;
    particle.width = minDimension * (0.008 + texture * 0.014)
      * (0.76 + sourceDrive * 0.72);
    particle.lifetime = 1.65 + texture * 1.75 + this.midDrive * 0.55;

    if (this.layout === 'radial') {
      const angle = (band + 0.5) / AURORA_BAND_COUNT * Math.PI * 2
        + (texture - 0.5) * 0.1;
      const radius = minDimension * (0.17 + sourceDrive * 0.095);
      const speed = 19 + sourceDrive * 38 + particle.depth * 13;
      particle.x = this.canvasWidth / 2 + Math.cos(angle) * radius;
      particle.y = this.canvasHeight / 2 + Math.sin(angle) * radius;
      particle.vx = Math.cos(angle) * speed - Math.sin(angle) * side * 7;
      particle.vy = Math.sin(angle) * speed + Math.cos(angle) * side * 7;
    } else if (this.layout === 'centered') {
      const verticalUnit = (Math.floor(band / 2) + 0.5) / (AURORA_BAND_COUNT / 2);
      particle.x = side < 0 ? this.canvasWidth * 0.08 : this.canvasWidth * 0.92;
      particle.y = this.canvasHeight * (0.2 + verticalUnit * 0.65)
        - sourceDrive * minDimension * 0.09;
      particle.vx = -side * (25 + sourceDrive * 34);
      particle.vy = -(9 + sourceDrive * 24) + (texture - 0.5) * 7;
    } else {
      const unit = (band + 0.5) / AURORA_BAND_COUNT;
      particle.x = this.canvasWidth * (0.055 + unit * 0.89)
        + (texture - 0.5) * minDimension * 0.022;
      particle.y = this.canvasHeight * 0.89 - sourceDrive * this.canvasHeight * 0.31;
      particle.vx = (texture - 0.5) * (12 + this.midDrive * 20);
      particle.vy = -(25 + sourceDrive * 45 + particle.depth * 11);
    }

    particle.previousX = particle.x;
    particle.previousY = particle.y;
    if (this.priming) {
      const primeAge = particle.lifetime * seededUnit(serial, 17) * 0.72;
      particle.age = primeAge;
      particle.previousX = particle.x - particle.vx * 0.055;
      particle.previousY = particle.y - particle.vy * 0.055;
      particle.x += particle.vx * primeAge * 0.42;
      particle.y += particle.vy * primeAge * 0.42;
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

    const particleLimit = this.emitter.configureLimit(resolveAuroraParticleLimit(params.density));
    const reduceMotion = environment?.reduceMotion === true;
    if (reduceMotion !== this.wasReducedMotion) {
      this.resetParticles();
      this.wasReducedMotion = reduceMotion;
    }

    this.resolveAudioDrive(frame, params, environment, reduceMotion);
    const palette = params.highContrast
      ? HIGH_CONTRAST_PALETTE
      : resolveVisualPalette(params.color);

    if (reduceMotion) {
      this.drawReducedMotion(ctx, canvas, params, palette);
      this.pendingDt = 0;
      return;
    }

    if (this.emitter.activeCount === 0 && this.drive > 0.012) {
      const primeCount = Math.min(particleLimit, Math.round(34 + this.drive * 54));
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
    this.drawAurora(ctx, canvas, params, palette);
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
    let bass = 0;
    let mids = 0;
    let treble = 0;
    const sensitivity = 0.56 + clamp01(params.sensitivity) * 1.38;
    const previewTide = environment?.amplitudeMode === 'preview'
      ? reduceMotion
        ? 0.08
        : 0.065 + Math.sin(frame.timeMs / 1000 * 0.47) * 0.027
      : 0;

    for (let index = 0; index < AURORA_BAND_COUNT; index += 1) {
      const band = clamp01(frame.bands[index] ?? 0) * bandWeight(index, params);
      const shaped = clamp01((band * 0.88 + frame.energy * 0.22 + previewTide) * sensitivity);
      this.bandDrives[index] = shaped;
      if (index < 11) bass += shaped;
      else if (index < 22) mids += shaped;
      else treble += shaped;
    }
    this.bassDrive = bass / 11;
    this.midDrive = mids / 11;
    this.trebleDrive = treble / 10;
    this.drive = clamp01(
      clamp01(frame.energy) * 0.31
        + this.bassDrive * 0.31
        + this.midDrive * 0.25
        + this.trebleDrive * 0.13
        + previewTide,
    );
  }

  private emitParticles(
    frame: AudioVizFrame,
    params: VisualizerParams,
    particleLimit: number,
    environment: AudioVisualRenderEnvironment | undefined,
  ): void {
    const previewMinimum = environment?.amplitudeMode === 'preview' ? 18 : 0;
    const rate = this.drive <= 0.01
      ? previewMinimum
      : 24 + this.drive * (44 + clamp01(params.density) * 76);
    this.emissionCarry += rate * this.pendingDt;
    if (frame.transient) {
      // CHANGED: transients inject bright folds into the existing bounded curtain pool.
      // WHY: consonants and beats should visibly crease Aurora without a second burst system.
      this.emissionCarry += 10 + Math.round(this.trebleDrive * 8);
    }

    let emitted = 0;
    while (this.emissionCarry >= 1 && emitted < 20 && this.emitter.activeCount < particleLimit) {
      this.emitter.emit(this.initializeParticle);
      this.emissionCarry -= 1;
      emitted += 1;
    }
    this.emissionCarry = Math.min(this.emissionCarry, 20);
  }

  private advanceParticles(
    frame: AudioVizFrame,
    params: VisualizerParams,
    dt: number,
  ): void {
    if (dt <= 0) return;
    const timeSeconds = frame.timeMs / 1000;
    const flowStrength = 18 + this.midDrive * 34 + clamp01(params.intensity) * 18;
    const drag = Math.exp(-dt * (0.42 + clamp01(params.smoothing) * 0.82));
    this.flowOptions.complexity = 0.38 + this.midDrive * 0.52;
    this.flowOptions.speed = 0.24 + (1 - clamp01(params.smoothing)) * 0.62;

    for (const particle of this.emitter.particles) {
      if (!particle.active) continue;
      particle.previousX = particle.x;
      particle.previousY = particle.y;
      const normalizedX = particle.x / this.canvasWidth * 2 - 1;
      const normalizedY = particle.y / this.canvasHeight * 2 - 1;
      this.flowOptions.seed = 83 + particle.lane * 2.71 + particle.depth * 0.4;
      const flow = sampleLayeredVectorFlowField(
        normalizedX,
        normalizedY,
        timeSeconds + particle.phase * 0.025,
        this.flowOptions,
        this.flowVector,
      );
      const shimmer = Math.sin(timeSeconds * 1.7 + particle.phase) * (3 + this.trebleDrive * 8);

      if (this.layout === 'radial') {
        const dx = particle.x - this.canvasWidth / 2;
        const dy = particle.y - this.canvasHeight / 2;
        const length = Math.max(1, Math.hypot(dx, dy));
        particle.vx += (dx / length * (7 + particle.sourceDrive * 13)
          + flow.x * flowStrength - dy / length * shimmer) * dt;
        particle.vy += (dy / length * (7 + particle.sourceDrive * 13)
          + flow.y * flowStrength + dx / length * shimmer) * dt;
      } else if (this.layout === 'centered') {
        const towardCenter = particle.x < this.canvasWidth / 2 ? 1 : -1;
        particle.vx += (towardCenter * 5 + flow.x * flowStrength + shimmer) * dt;
        particle.vy += (-5 - this.bassDrive * 8 + flow.y * flowStrength * 0.62) * dt;
      } else {
        particle.vx += (flow.x * flowStrength + shimmer) * dt;
        particle.vy += (-8 - this.bassDrive * 11 + flow.y * flowStrength * 0.46) * dt;
      }

      particle.vx *= drag;
      particle.vy *= drag;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
    }
  }

  private drawAurora(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    params: VisualizerParams,
    palette: readonly string[],
  ): void {
    if (this.drive <= 0.01) return;
    ctx.save();
    this.drawSourceGlow(ctx, canvas, palette, params.highContrast === true);
    ctx.globalCompositeOperation = params.highContrast ? 'source-over' : 'lighter';
    for (const particle of this.emitter.particles) {
      if (particle.active) this.drawRibbonShard(ctx, particle, params, palette);
    }
    ctx.restore();
  }

  private drawSourceGlow(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    palette: readonly string[],
    highContrast: boolean,
  ): void {
    const color = paletteColorAt(palette, 0.55 + this.trebleDrive * 0.35);
    ctx.shadowBlur = highContrast ? 0 : 9 + this.drive * 14;
    ctx.shadowColor = color;
    ctx.strokeStyle = colorWithAlpha(color, highContrast ? 0.86 : 0.2 + this.drive * 0.24);
    ctx.lineWidth = highContrast ? 1.8 : 1 + this.drive * 1.2;
    ctx.beginPath();
    if (this.layout === 'radial') {
      const radius = Math.min(canvas.width, canvas.height) * (0.17 + this.bassDrive * 0.095);
      ctx.arc(canvas.width / 2, canvas.height / 2, radius, 0, Math.PI * 2);
    } else if (this.layout === 'centered') {
      ctx.moveTo(canvas.width * 0.08, canvas.height * 0.2);
      ctx.lineTo(canvas.width * 0.08, canvas.height * 0.85);
      ctx.moveTo(canvas.width * 0.92, canvas.height * 0.2);
      ctx.lineTo(canvas.width * 0.92, canvas.height * 0.85);
    } else {
      ctx.moveTo(canvas.width * 0.055, canvas.height * (0.89 - this.bassDrive * 0.17));
      ctx.bezierCurveTo(
        canvas.width * 0.3,
        canvas.height * (0.91 - this.midDrive * 0.22),
        canvas.width * 0.7,
        canvas.height * (0.87 - this.trebleDrive * 0.19),
        canvas.width * 0.945,
        canvas.height * (0.89 - this.bassDrive * 0.17),
      );
    }
    ctx.stroke();
  }

  private drawRibbonShard(
    ctx: CanvasRenderingContext2D,
    particle: AuroraRibbonParticle,
    params: VisualizerParams,
    palette: readonly string[],
  ): void {
    const life = clamp01(particle.age / particle.lifetime);
    const envelope = Math.sin(life * Math.PI) ** 0.72;
    const intensity = 0.34 + clamp01(params.intensity) * 0.66;
    const bodyColor = paletteColorAt(palette, particle.colorPosition);
    const foldColor = paletteColorAt(
      palette,
      clamp01(particle.colorPosition + 0.18 + particle.sourceDrive * 0.22),
    );

    this.traceRibbonShard(ctx, particle, 1);
    ctx.fillStyle = colorWithAlpha(
      bodyColor,
      envelope * intensity * (params.highContrast ? 0.64 : 0.13 + particle.depth * 0.16),
    );
    ctx.shadowColor = bodyColor;
    ctx.shadowBlur = params.highContrast ? 0 : 5 + particle.depth * 9;
    ctx.fill();

    this.traceRibbonFold(ctx, particle);
    ctx.strokeStyle = colorWithAlpha(
      params.highContrast ? '#ffffff' : foldColor,
      envelope * (params.highContrast ? 0.9 : 0.28 + particle.sourceDrive * 0.48),
    );
    ctx.lineWidth = Math.max(0.7, particle.width * (params.highContrast ? 0.16 : 0.1));
    ctx.shadowBlur = params.highContrast ? 0 : 3 + this.trebleDrive * 7;
    ctx.shadowColor = foldColor;
    ctx.stroke();
  }

  private traceRibbonShard(
    ctx: CanvasRenderingContext2D,
    particle: AuroraRibbonParticle,
    scale: number,
  ): void {
    const dx = particle.x - particle.previousX;
    const dy = particle.y - particle.previousY;
    const length = Math.max(1, Math.hypot(dx, dy));
    const normalX = -dy / length;
    const normalY = dx / length;
    const life = clamp01(particle.age / particle.lifetime);
    const width = particle.width * scale * (0.48 + Math.sin(life * Math.PI) * 1.3);
    const fold = Math.sin(particle.phase + life * 13) * width * 0.7;
    const headX = particle.x + normalX * fold;
    const headY = particle.y + normalY * fold;
    const tailX = particle.previousX - particle.vx * 0.045;
    const tailY = particle.previousY - particle.vy * 0.045;

    ctx.beginPath();
    ctx.moveTo(tailX - normalX * width * 0.45, tailY - normalY * width * 0.45);
    ctx.bezierCurveTo(
      particle.previousX - normalX * width,
      particle.previousY - normalY * width,
      headX - normalX * width * 0.65,
      headY - normalY * width * 0.65,
      headX,
      headY,
    );
    ctx.bezierCurveTo(
      headX + normalX * width * 0.65,
      headY + normalY * width * 0.65,
      particle.previousX + normalX * width,
      particle.previousY + normalY * width,
      tailX + normalX * width * 0.45,
      tailY + normalY * width * 0.45,
    );
    ctx.closePath();
  }

  private traceRibbonFold(
    ctx: CanvasRenderingContext2D,
    particle: AuroraRibbonParticle,
  ): void {
    const dx = particle.x - particle.previousX;
    const dy = particle.y - particle.previousY;
    const length = Math.max(1, Math.hypot(dx, dy));
    const normalX = -dy / length;
    const normalY = dx / length;
    const life = clamp01(particle.age / particle.lifetime);
    const fold = Math.sin(particle.phase + life * 13) * particle.width * 0.42;
    ctx.beginPath();
    ctx.moveTo(particle.previousX, particle.previousY);
    ctx.bezierCurveTo(
      particle.previousX + normalX * fold,
      particle.previousY + normalY * fold,
      particle.x + normalX * fold,
      particle.y + normalY * fold,
      particle.x,
      particle.y,
    );
  }

  private drawReducedMotion(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    params: VisualizerParams,
    palette: readonly string[],
  ): void {
    if (this.drive <= 0.01) return;
    ctx.save();
    this.drawSourceGlow(ctx, canvas, palette, params.highContrast === true);
    ctx.globalCompositeOperation = params.highContrast ? 'source-over' : 'lighter';
    const count = Math.min(
      resolveAuroraParticleLimit(params.density),
      Math.round(28 + this.drive * 38),
    );
    const minDimension = Math.max(24, Math.min(canvas.width, canvas.height));
    for (let index = 0; index < count; index += 1) {
      const particle = this.reducedParticle;
      const band = index % AURORA_BAND_COUNT;
      const unit = (band + 0.5) / AURORA_BAND_COUNT;
      const sourceDrive = this.bandDrives[band] ?? 0;
      const texture = seededUnit(index, 41);
      particle.index = index;
      particle.band = band;
      particle.lane = index % AURORA_LANE_COUNT;
      particle.phase = seededUnit(index, 43) * Math.PI * 2;
      particle.depth = 0.5 + texture * 0.5;
      particle.colorPosition = particle.lane / Math.max(1, AURORA_LANE_COUNT - 1);
      particle.sourceDrive = sourceDrive;
      particle.width = minDimension * (0.01 + texture * 0.012);
      particle.age = 0.28 + texture * 0.34;
      particle.lifetime = 1;
      if (this.layout === 'radial') {
        const angle = unit * Math.PI * 2;
        const sourceRadius = minDimension * (0.17 + sourceDrive * 0.095);
        const outerRadius = sourceRadius + minDimension * (0.08 + texture * 0.17);
        particle.previousX = canvas.width / 2 + Math.cos(angle) * sourceRadius;
        particle.previousY = canvas.height / 2 + Math.sin(angle) * sourceRadius;
        particle.x = canvas.width / 2 + Math.cos(angle + (texture - 0.5) * 0.18) * outerRadius;
        particle.y = canvas.height / 2 + Math.sin(angle + (texture - 0.5) * 0.18) * outerRadius;
      } else if (this.layout === 'centered') {
        const side = index % 2 === 0 ? -1 : 1;
        particle.previousX = side < 0 ? canvas.width * 0.08 : canvas.width * 0.92;
        particle.previousY = canvas.height * (0.2 + unit * 0.65);
        particle.x = particle.previousX - side * canvas.width * (0.08 + texture * 0.17);
        particle.y = particle.previousY - minDimension * (0.05 + sourceDrive * 0.11);
      } else {
        particle.previousX = canvas.width * (0.055 + unit * 0.89);
        particle.previousY = canvas.height * 0.89 - sourceDrive * canvas.height * 0.31;
        particle.x = particle.previousX + (texture - 0.5) * minDimension * 0.11;
        particle.y = particle.previousY - minDimension * (0.08 + texture * 0.19);
      }
      particle.vx = particle.x - particle.previousX;
      particle.vy = particle.y - particle.previousY;
      this.drawRibbonShard(ctx, particle, params, palette);
    }
    ctx.restore();
  }
}

export const AURORA_VISUAL_DEFINITION: AudioVisualDefinition = Object.freeze({
  id: AURORA_ID,
  label: AURORA_LABEL,
  kind: 'overlay',
  wants: Object.freeze({ bands: true }),
  family: 'flow-field-ribbons',
  maxElements: AURORA_MAX_ELEMENTS,
  defaultParams: Object.freeze({
    sensitivity: 0.7,
    intensity: 0.72,
    smoothing: 0.58,
    color: Object.freeze(['#071a52', '#174f8f', '#16c7a3', '#7cffcb', '#d7fff2']),
    density: 0.56,
    layoutMode: 'linear',
    highContrast: false,
  }),
  create: () => new AuroraVisual(),
});
