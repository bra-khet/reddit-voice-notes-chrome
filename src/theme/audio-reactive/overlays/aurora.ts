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
export const AURORA_LANE_COUNT = 7;
// BUG FIX: Aurora one-frame shards + UI sluggishness (QA §3f)
// Fix: shards drawn per-particle (up to 200 fills+strokes per frame) read as disjoint pieces
//      and dragged the frame budget. Particles are halved and now serve as control points for
//      AURORA_LANE_COUNT connected ribbons, so the paint cost is per-lane, not per-particle.
export const AURORA_MIN_PARTICLES = 42;
export const AURORA_MAX_PARTICLES = 84;
/** One ribbon body fill and one fold stroke per lane, plus the source front accents. */
export const AURORA_MAX_ELEMENTS = AURORA_LANE_COUNT * 2 + 3;

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
/** Sampled points along the linear emission front curve. */
const AURORA_FRONT_SAMPLES = 16;
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
 * CHANGED: Aurora is a field of flow-advected control points joined into per-lane ribbons.
 * WHY: audio-shaped curtains must read as coherent waves; disjoint one-frame shards read as
 *      debris and cost a paint pass each (QA §3f).
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
  /** Per-lane member slots (fixed stride) plus reusable path point buffers. */
  private readonly laneMembers = new Int16Array(AURORA_LANE_COUNT * AURORA_MAX_PARTICLES);
  private readonly laneCounts = new Int16Array(AURORA_LANE_COUNT);
  private readonly pathX = new Float32Array(AURORA_MAX_PARTICLES);
  private readonly pathY = new Float32Array(AURORA_MAX_PARTICLES);
  private readonly pathWidth = new Float32Array(AURORA_MAX_PARTICLES);
  private readonly pathFold = new Float32Array(AURORA_MAX_PARTICLES);
  private readonly normalX = new Float32Array(AURORA_MAX_PARTICLES);
  private readonly normalY = new Float32Array(AURORA_MAX_PARTICLES);

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
    const minDimension = Math.max(24, Math.min(this.canvasWidth, this.canvasHeight));
    // CHANGED: the radial ring reads its drive from a vertically-mirrored band (Pass C).
    // WHY: mapping band index straight around the ring parked all the treble on one
    //      side, leaving a persistently quiet sector; mirroring across the vertical
    //      axis carries the full spectrum on both halves — the same treatment that
    //      fixed Central Pulse's symmetry — while keeping every aurora behavior.
    const slotUnit = (band + 0.5) / AURORA_BAND_COUNT;
    const sourceBand = this.layout === 'radial'
      ? Math.round(Math.min(slotUnit, 1 - slotUnit) * 2 * (AURORA_BAND_COUNT - 1))
      : band;
    const sourceDrive = this.bandDrives[sourceBand] ?? 0;

    particle.band = sourceBand;
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
      // -PI/2 pins the mirror axis vertically: the top is bass, both sides symmetric.
      const angle = slotUnit * Math.PI * 2 - Math.PI / 2
        + (texture - 0.5) * 0.1;
      const radius = minDimension * (0.17 + sourceDrive * 0.095);
      const speed = 19 + sourceDrive * 38 + particle.depth * 13;
      particle.x = this.canvasWidth / 2 + Math.cos(angle) * radius;
      particle.y = this.canvasHeight / 2 + Math.sin(angle) * radius;
      particle.vx = Math.cos(angle) * speed - Math.sin(angle) * 7;
      particle.vy = Math.sin(angle) * speed + Math.cos(angle) * 7;
    } else if (this.layout === 'centered') {
      // CHANGED: centered lanes keep one side each (even left, odd right).
      // WHY: a joined lane ribbon must not zigzag between opposite screen edges.
      const side = lane % 2 === 0 ? -1 : 1;
      const verticalUnit = (Math.floor(band / 2) + 0.5) / (AURORA_BAND_COUNT / 2);
      // Spawn on the live source line (deflected inward by band drive) so ribbon
      // roots visibly grow out of it — mirrors the linear front fix (Pass C).
      particle.x = (side < 0 ? this.canvasWidth * 0.08 : this.canvasWidth * 0.92)
        - side * sourceDrive * this.canvasWidth * 0.07;
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
      const primeCount = Math.min(particleLimit, Math.round(18 + this.drive * 30));
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
    const previewMinimum = environment?.amplitudeMode === 'preview' ? 8 : 0;
    // CHANGED: emission rates track the halved control-point pool.
    // WHY: ribbons need enough points per lane for a smooth curve, not a dense particle field.
    const rate = this.drive <= 0.01
      ? previewMinimum
      : 10 + this.drive * (18 + clamp01(params.density) * 30);
    this.emissionCarry += rate * this.pendingDt;
    if (frame.transient) {
      this.emissionCarry += 6 + Math.round(this.trebleDrive * 5);
    }

    let emitted = 0;
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
      // CHANGED: every point in a lane samples the exact same flow layer.
      // WHY: shared gusts are what bind a lane's control points into one wave.
      this.flowOptions.seed = 83 + particle.lane * 2.71;
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
    this.collectLanes();
    for (let lane = 0; lane < AURORA_LANE_COUNT; lane += 1) {
      this.drawLaneRibbon(ctx, lane, params, palette);
    }
    ctx.restore();
  }

  /** Bucket active particles per lane, ordered along the lane's travel axis. */
  private collectLanes(): void {
    this.laneCounts.fill(0);
    const centerX = this.canvasWidth / 2;
    const centerY = this.canvasHeight / 2;
    for (const particle of this.emitter.particles) {
      if (!particle.active) continue;
      const lane = particle.lane;
      const key = this.layout === 'radial'
        ? Math.atan2(particle.y - centerY, particle.x - centerX)
        : this.layout === 'centered'
          ? particle.y
          : particle.x;
      this.insertLaneMember(lane, particle.index, key);
    }
  }

  private insertLaneMember(lane: number, particleIndex: number, key: number): void {
    const stride = lane * AURORA_MAX_PARTICLES;
    const count = this.laneCounts[lane] ?? 0;
    let position = count;
    // Insertion sort on the small per-lane slice keeps ordering allocation-free.
    while (position > 0) {
      const existing = this.laneMembers[stride + position - 1] ?? 0;
      const existingKey = this.sortKeyOf(existing);
      if (existingKey <= key) break;
      this.laneMembers[stride + position] = existing;
      position -= 1;
    }
    this.laneMembers[stride + position] = particleIndex;
    this.laneCounts[lane] = count + 1;
  }

  private sortKeyOf(particleIndex: number): number {
    const particle = this.emitter.particles[particleIndex];
    if (!particle) return 0;
    if (this.layout === 'radial') {
      return Math.atan2(
        particle.y - this.canvasHeight / 2,
        particle.x - this.canvasWidth / 2,
      );
    }
    return this.layout === 'centered' ? particle.y : particle.x;
  }

  private drawLaneRibbon(
    ctx: CanvasRenderingContext2D,
    lane: number,
    params: VisualizerParams,
    palette: readonly string[],
  ): void {
    const count = this.laneCounts[lane] ?? 0;
    if (count < 3) return;
    const stride = lane * AURORA_MAX_PARTICLES;
    let laneEnergy = 0;
    let laneLife = 0;
    for (let index = 0; index < count; index += 1) {
      const particle = this.emitter.particles[this.laneMembers[stride + index] ?? 0];
      if (!particle) return;
      const life = clamp01(particle.age / particle.lifetime);
      const envelope = Math.sin(life * Math.PI) ** 0.72;
      this.pathX[index] = particle.x;
      this.pathY[index] = particle.y;
      this.pathWidth[index] = particle.width * (0.35 + envelope * 0.9);
      this.pathFold[index] = Math.sin(particle.phase + life * 13)
        * particle.width * 0.42 * envelope;
      laneEnergy += particle.sourceDrive * envelope;
      laneLife += envelope;
    }
    laneEnergy /= count;
    laneLife /= count;
    // CHANGED: the whole ribbon's opacity rides its members' mean life envelope (Pass C).
    // WHY: lanes popped in/out at full alpha when their member count crossed the draw
    //      threshold; ramping alpha with lane life makes ribbons "come alive" and "die".
    const laneFade = Math.min(1, laneLife * 1.7);
    const closedLoop = this.layout === 'radial';

    const highContrast = params.highContrast === true;
    const intensity = 0.34 + clamp01(params.intensity) * 0.66;
    const bodyColor = paletteColorAt(
      palette,
      clamp01(lane / Math.max(1, AURORA_LANE_COUNT - 1) * 0.85 + laneEnergy * 0.15),
    );
    const foldColor = paletteColorAt(
      palette,
      clamp01(lane / Math.max(1, AURORA_LANE_COUNT - 1) + 0.18 + laneEnergy * 0.22),
    );

    this.traceRibbonBand(ctx, count, closedLoop);
    ctx.fillStyle = colorWithAlpha(
      bodyColor,
      intensity * (highContrast ? 0.6 : 0.14 + laneEnergy * 0.2) * laneFade,
    );
    ctx.shadowColor = bodyColor;
    ctx.shadowBlur = highContrast ? 0 : 7 + laneEnergy * 8;
    ctx.fill();

    this.traceRibbonSpine(ctx, count, closedLoop);
    ctx.strokeStyle = colorWithAlpha(
      highContrast ? '#ffffff' : foldColor,
      (highContrast ? 0.9 : 0.3 + laneEnergy * 0.45) * laneFade,
    );
    ctx.lineWidth = Math.max(0.7, (this.pathWidth[Math.floor(count / 2)] ?? 1) * 0.14);
    ctx.shadowBlur = highContrast ? 0 : 3 + this.trebleDrive * 6;
    ctx.shadowColor = foldColor;
    ctx.stroke();
  }

  /** Closed variable-width band through the ordered lane points (Catmull-Rom smoothed). */
  private traceRibbonBand(
    ctx: CanvasRenderingContext2D,
    count: number,
    closedLoop = false,
  ): void {
    for (let index = 0; index < count; index += 1) {
      const previous = closedLoop ? (index - 1 + count) % count : Math.max(0, index - 1);
      const next = closedLoop ? (index + 1) % count : Math.min(count - 1, index + 1);
      const dx = (this.pathX[next] ?? 0) - (this.pathX[previous] ?? 0);
      const dy = (this.pathY[next] ?? 0) - (this.pathY[previous] ?? 0);
      const length = Math.max(1e-4, Math.hypot(dx, dy));
      this.normalX[index] = -dy / length;
      this.normalY[index] = dx / length;
    }
    const topX = (index: number): number =>
      (this.pathX[index] ?? 0) + (this.normalX[index] ?? 0) * (this.pathWidth[index] ?? 0);
    const topY = (index: number): number =>
      (this.pathY[index] ?? 0) + (this.normalY[index] ?? 0) * (this.pathWidth[index] ?? 0);
    const bottomX = (index: number): number =>
      (this.pathX[index] ?? 0) - (this.normalX[index] ?? 0) * (this.pathWidth[index] ?? 0);
    const bottomY = (index: number): number =>
      (this.pathY[index] ?? 0) - (this.normalY[index] ?? 0) * (this.pathWidth[index] ?? 0);

    ctx.beginPath();
    if (closedLoop) {
      // BUG FIX: radial "gap on the left side" (QA §3f Pass C)
      // Fix: radial lanes were open bands over atan2-sorted members, so every ribbon
      //      seamed exactly at the ±PI wrap (the left side). Two opposite-wound
      //      wrapped loops now fill the ring as an annulus with no seam.
      ctx.moveTo(topX(0), topY(0));
      this.catmullTo(ctx, topX, topY, count, false, true);
      ctx.closePath();
      ctx.moveTo(bottomX(0), bottomY(0));
      this.catmullTo(ctx, bottomX, bottomY, count, true, true);
      ctx.closePath();
      return;
    }
    ctx.moveTo(topX(0), topY(0));
    this.catmullTo(ctx, topX, topY, count, false);
    ctx.lineTo(bottomX(count - 1), bottomY(count - 1));
    this.catmullTo(ctx, bottomX, bottomY, count, true);
    ctx.closePath();
  }

  /** Luminous fold line traced along the lane spine with per-point fold displacement. */
  private traceRibbonSpine(
    ctx: CanvasRenderingContext2D,
    count: number,
    closedLoop = false,
  ): void {
    const spineX = (index: number): number => (this.pathX[index] ?? 0);
    const spineY = (index: number): number => (this.pathY[index] ?? 0) + (this.pathFold[index] ?? 0);
    ctx.beginPath();
    ctx.moveTo(spineX(0), spineY(0));
    this.catmullTo(ctx, spineX, spineY, count, false, closedLoop);
  }

  private catmullTo(
    ctx: CanvasRenderingContext2D,
    xAt: (index: number) => number,
    yAt: (index: number) => number,
    count: number,
    reverse: boolean,
    closedLoop = false,
  ): void {
    const at = (index: number): number => {
      if (closedLoop) {
        const wrapped = ((index % count) + count) % count;
        return reverse ? (count - wrapped) % count : wrapped;
      }
      const clamped = Math.min(count - 1, Math.max(0, index));
      return reverse ? count - 1 - clamped : clamped;
    };
    const steps = closedLoop ? count : count - 1;
    for (let step = 0; step < steps; step += 1) {
      const i0 = at(step - 1);
      const i1 = at(step);
      const i2 = at(step + 1);
      const i3 = at(step + 2);
      ctx.bezierCurveTo(
        xAt(i1) + (xAt(i2) - xAt(i0)) / 6, yAt(i1) + (yAt(i2) - yAt(i0)) / 6,
        xAt(i2) - (xAt(i3) - xAt(i1)) / 6, yAt(i2) - (yAt(i3) - yAt(i1)) / 6,
        xAt(i2), yAt(i2),
      );
    }
  }

  private drawSourceGlow(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    palette: readonly string[],
    highContrast: boolean,
  ): void {
    const color = paletteColorAt(palette, 0.55 + this.trebleDrive * 0.35);
    const peakAlpha = highContrast ? 0.86 : 0.16 + this.drive * 0.2;
    ctx.shadowBlur = highContrast ? 0 : 8 + this.drive * 10;
    ctx.shadowColor = color;
    ctx.lineWidth = highContrast ? 1.8 : 2.4 + this.drive * 3.2;
    ctx.beginPath();
    if (this.layout === 'radial') {
      const radius = Math.min(canvas.width, canvas.height) * (0.17 + this.bassDrive * 0.095);
      ctx.arc(canvas.width / 2, canvas.height / 2, radius, 0, Math.PI * 2);
      ctx.strokeStyle = colorWithAlpha(color, peakAlpha);
    } else if (this.layout === 'centered') {
      // BUG FIX: centered source lines read as static "plain bars" (QA §3f Pass C)
      // Fix: the two verticals were fixed moveTo/lineTo segments while linear's front
      //      animated with audio. Both side lines now trace the paired-band emission
      //      envelope — deflected inward and lifted exactly like the spawn point —
      //      so ribbon roots grow out of a live line in every mode.
      const slots = AURORA_BAND_COUNT / 2;
      const minDimension = Math.max(24, Math.min(canvas.width, canvas.height));
      const slotDrive = (index: number): number => {
        const clamped = Math.min(slots - 1, Math.max(0, index));
        const pair = clamped * 2;
        return ((this.bandDrives[pair] ?? 0) + (this.bandDrives[pair + 1] ?? 0)) / 2;
      };
      for (const side of [-1, 1] as const) {
        const edgeX = side < 0 ? canvas.width * 0.08 : canvas.width * 0.92;
        const xAt = (index: number): number =>
          edgeX - side * slotDrive(index) * canvas.width * 0.07;
        const yAt = (index: number): number => {
          const clamped = Math.min(slots - 1, Math.max(0, index));
          return canvas.height * (0.2 + (clamped + 0.5) / slots * 0.65)
            - slotDrive(index) * minDimension * 0.09;
        };
        ctx.moveTo(xAt(0), yAt(0));
        for (let index = 0; index < slots - 1; index += 1) {
          ctx.bezierCurveTo(
            xAt(index) + (xAt(index + 1) - xAt(index - 1)) / 6,
            yAt(index) + (yAt(index + 1) - yAt(index - 1)) / 6,
            xAt(index + 1) - (xAt(index + 2) - xAt(index)) / 6,
            yAt(index + 1) - (yAt(index + 2) - yAt(index)) / 6,
            xAt(index + 1),
            yAt(index + 1),
          );
        }
      }
      ctx.strokeStyle = highContrast
        ? colorWithAlpha(color, peakAlpha)
        : this.taperGradient(ctx, 0, canvas.height * 0.2, 0, canvas.height * 0.85, color, peakAlpha);
    } else {
      // BUG FIX: Aurora "thin bow line" hovering near the bottom (QA §3f)
      // Fix: the decorative three-point bezier ran independently of where ribbons spawn.
      //      The front now traces the actual per-band emission envelope (the same
      //      0.89 - drive * 0.31 curve initializeParticle uses), widened into a soft
      //      end-tapered glow, so ribbon roots visibly grow out of it.
      const xAt = (index: number): number => {
        const unit = (Math.min(AURORA_FRONT_SAMPLES - 1, Math.max(0, index)) + 0.5)
          / AURORA_FRONT_SAMPLES;
        return canvas.width * (0.055 + unit * 0.89);
      };
      const yAt = (index: number): number => {
        const clamped = Math.min(AURORA_FRONT_SAMPLES - 1, Math.max(0, index));
        const band = Math.min(
          AURORA_BAND_COUNT - 1,
          Math.round((clamped + 0.5) / AURORA_FRONT_SAMPLES * (AURORA_BAND_COUNT - 1)),
        );
        return canvas.height * 0.89 - (this.bandDrives[band] ?? 0) * canvas.height * 0.31;
      };
      ctx.moveTo(xAt(0), yAt(0));
      for (let index = 0; index < AURORA_FRONT_SAMPLES - 1; index += 1) {
        ctx.bezierCurveTo(
          xAt(index) + (xAt(index + 1) - xAt(index - 1)) / 6,
          yAt(index) + (yAt(index + 1) - yAt(index - 1)) / 6,
          xAt(index + 1) - (xAt(index + 2) - xAt(index)) / 6,
          yAt(index + 1) - (yAt(index + 2) - yAt(index)) / 6,
          xAt(index + 1),
          yAt(index + 1),
        );
      }
      ctx.strokeStyle = highContrast
        ? colorWithAlpha(color, peakAlpha)
        : this.taperGradient(ctx, canvas.width * 0.055, 0, canvas.width * 0.945, 0, color, peakAlpha);
    }
    ctx.stroke();
  }

  private taperGradient(
    ctx: CanvasRenderingContext2D,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color: string,
    peakAlpha: number,
  ): CanvasGradient {
    const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
    gradient.addColorStop(0, colorWithAlpha(color, 0));
    gradient.addColorStop(0.14, colorWithAlpha(color, peakAlpha));
    gradient.addColorStop(0.86, colorWithAlpha(color, peakAlpha));
    gradient.addColorStop(1, colorWithAlpha(color, 0));
    return gradient;
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
    const minDimension = Math.max(24, Math.min(canvas.width, canvas.height));
    const pointCount = 9;
    for (let lane = 0; lane < AURORA_LANE_COUNT; lane += 1) {
      let laneEnergy = 0;
      for (let index = 0; index < pointCount; index += 1) {
        const unit = (index + 0.5) / pointCount;
        const band = Math.min(
          AURORA_BAND_COUNT - 1,
          Math.round(unit * (AURORA_BAND_COUNT - 1)),
        );
        const sourceDrive = this.bandDrives[band] ?? 0;
        const texture = seededUnit(lane * pointCount + index, 41);
        laneEnergy += sourceDrive;
        if (this.layout === 'radial') {
          const angle = unit * Math.PI * 1.72 + lane * 0.24;
          const radius = minDimension
            * (0.19 + lane * 0.028 + sourceDrive * 0.08 + (texture - 0.5) * 0.02);
          this.pathX[index] = canvas.width / 2 + Math.cos(angle) * radius;
          this.pathY[index] = canvas.height / 2 + Math.sin(angle) * radius;
        } else if (this.layout === 'centered') {
          const side = lane % 2 === 0 ? -1 : 1;
          const edgeX = side < 0 ? canvas.width * 0.08 : canvas.width * 0.92;
          this.pathX[index] = edgeX - side * canvas.width
            * (0.03 + Math.floor(lane / 2) * 0.05 + sourceDrive * 0.1);
          this.pathY[index] = canvas.height * (0.2 + unit * 0.65)
            - sourceDrive * minDimension * 0.06;
        } else {
          this.pathX[index] = canvas.width * (0.055 + unit * 0.89);
          this.pathY[index] = canvas.height * 0.89
            - sourceDrive * canvas.height * 0.31
            - minDimension * (0.05 + lane * 0.042 + (texture - 0.5) * 0.02);
        }
        this.pathWidth[index] = minDimension * (0.008 + texture * 0.01)
          * (0.7 + sourceDrive * 0.7);
        this.pathFold[index] = (texture - 0.5) * minDimension * 0.012;
      }
      laneEnergy /= pointCount;

      const highContrast = params.highContrast === true;
      const bodyColor = paletteColorAt(
        palette,
        clamp01(lane / Math.max(1, AURORA_LANE_COUNT - 1) * 0.85 + laneEnergy * 0.15),
      );
      this.traceRibbonBand(ctx, pointCount);
      ctx.fillStyle = colorWithAlpha(
        bodyColor,
        (0.34 + clamp01(params.intensity) * 0.66) * (highContrast ? 0.6 : 0.14 + laneEnergy * 0.2),
      );
      ctx.shadowColor = bodyColor;
      ctx.shadowBlur = highContrast ? 0 : 6;
      ctx.fill();
      this.traceRibbonSpine(ctx, pointCount);
      ctx.strokeStyle = colorWithAlpha(
        highContrast ? '#ffffff' : bodyColor,
        highContrast ? 0.9 : 0.3 + laneEnergy * 0.4,
      );
      ctx.lineWidth = Math.max(0.7, (this.pathWidth[4] ?? 1) * 0.14);
      ctx.shadowBlur = highContrast ? 0 : 3;
      ctx.shadowColor = bodyColor;
      ctx.stroke();
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
