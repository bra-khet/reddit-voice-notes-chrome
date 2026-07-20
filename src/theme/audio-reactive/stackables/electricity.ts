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

export const ELECTRIC_ARC_ID = 'electric-arc' as const;
export const ELECTRIC_ARC_LABEL = 'Electric Arc' as const;
export const ELECTRIC_ARC_MIN_STREAMERS = 6;
export const ELECTRIC_ARC_MAX_STREAMERS = 18;
export const ELECTRIC_ARC_MAX_CONTACTS = 6;
const ELECTRIC_ARC_MAX_POINTS = 7;
const ELECTRIC_ARC_MAX_FORKS = 8;
const ELECTRIC_ARC_FORK_POINTS = 4;
/** Main-segment glow/core, terminal nodes, contacts, and bounded forks. */
export const ELECTRIC_ARC_MAX_ELEMENTS =
  ELECTRIC_ARC_MAX_STREAMERS * ((ELECTRIC_ARC_MAX_POINTS - 1) * 2 + 1)
  + ELECTRIC_ARC_MAX_CONTACTS * 3
  + ELECTRIC_ARC_MAX_FORKS * (ELECTRIC_ARC_FORK_POINTS - 1) * 2;

export const LIGHTNING_ID = 'lightning' as const;
export const LIGHTNING_LABEL = 'Lightning' as const;
export const LIGHTNING_MIN_POINTS = 14;
export const LIGHTNING_MAX_POINTS = 30;
export const LIGHTNING_MIN_BRANCHES = 1;
export const LIGHTNING_MAX_BRANCHES = 5;
const LIGHTNING_BRANCH_POINTS = 7;
/** Three main-channel passes, two per branch segment, branch tips, and contacts. */
export const LIGHTNING_MAX_ELEMENTS =
  (LIGHTNING_MAX_POINTS - 1) * 3
  + LIGHTNING_MAX_BRANCHES * ((LIGHTNING_BRANCH_POINTS - 1) * 2 + 1)
  + 2 * 3;

interface ContactGeometry {
  x: number;
  y: number;
  normalX: number;
  normalY: number;
}

interface CoronaPath {
  pointCount: number;
  forkPointCount: number;
  x: Float32Array;
  y: Float32Array;
  forkX: Float32Array;
  forkY: Float32Array;
}

interface LightningBranch {
  active: boolean;
  x: Float32Array;
  y: Float32Array;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function seededUnit(index: number, salt: number): number {
  const value = Math.sin(index * 97.133 + salt * 19.719) * 43758.5453;
  return value - Math.floor(value);
}

function seededSigned(index: number, salt: number): number {
  return seededUnit(index, salt) * 2 - 1;
}

function resolveLayout(params: VisualizerParams): LayoutMode {
  return params.layoutMode === 'centered' || params.layoutMode === 'radial'
    ? params.layoutMode
    : 'linear';
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

function strokePolyline(
  ctx: CanvasRenderingContext2D,
  x: Float32Array,
  y: Float32Array,
  pointCount: number,
): void {
  if (pointCount < 2) return;
  ctx.beginPath();
  ctx.moveTo(x[0] ?? 0, y[0] ?? 0);
  for (let index = 1; index < pointCount; index += 1) {
    ctx.lineTo(x[index] ?? 0, y[index] ?? 0);
  }
  ctx.stroke();
}

export function resolveElectricArcStreamerLimit(density: number): number {
  return Math.round(
    ELECTRIC_ARC_MIN_STREAMERS
      + clamp01(density) * (ELECTRIC_ARC_MAX_STREAMERS - ELECTRIC_ARC_MIN_STREAMERS),
  );
}

export function resolveElectricArcContactCount(density: number): number {
  return Math.round(3 + clamp01(density) * (ELECTRIC_ARC_MAX_CONTACTS - 3));
}

export function resolveLightningPointCount(density: number): number {
  return Math.round(
    LIGHTNING_MIN_POINTS
      + clamp01(density) * (LIGHTNING_MAX_POINTS - LIGHTNING_MIN_POINTS),
  );
}

export function resolveLightningBranchLimit(density: number): number {
  return Math.round(
    LIGHTNING_MIN_BRANCHES
      + clamp01(density) * (LIGHTNING_MAX_BRANCHES - LIGHTNING_MIN_BRANCHES),
  );
}

/**
 * CHANGED: Electric Arc models corona discharge as bounded streamers rooted on visible conductors.
 * WHY: ionization should grow outward from charged objects instead of reading as a disconnected bolt.
 */
class ElectricArcEffect implements StackableEffect {
  readonly id = ELECTRIC_ARC_ID;

  private readonly paths: CoronaPath[] = Array.from(
    { length: ELECTRIC_ARC_MAX_STREAMERS },
    () => ({
      pointCount: 0,
      forkPointCount: 0,
      x: new Float32Array(ELECTRIC_ARC_MAX_POINTS),
      y: new Float32Array(ELECTRIC_ARC_MAX_POINTS),
      forkX: new Float32Array(ELECTRIC_ARC_FORK_POINTS),
      forkY: new Float32Array(ELECTRIC_ARC_FORK_POINTS),
    }),
  );

  private readonly contact: ContactGeometry = { x: 0, y: 0, normalX: 0, normalY: -1 };
  private streamerLimit = ELECTRIC_ARC_MIN_STREAMERS;
  private contactCount = 3;
  private canvasWidth = 1;
  private canvasHeight = 1;
  private layout: LayoutMode = 'linear';
  private drive = 0;
  private midDrive = 0;
  private trebleDrive = 0;
  /** Sporadic contact relocation state (frame-time epochs; disabled under reduced motion). */
  private roamTime = 0;
  private roaming = true;

  render(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    frame: AudioVizFrame,
    params: VisualizerParams,
    environment?: AudioVisualRenderEnvironment,
  ): void {
    this.canvasWidth = Math.max(1, canvas.width);
    this.canvasHeight = Math.max(1, canvas.height);
    this.layout = resolveLayout(params);
    this.streamerLimit = resolveElectricArcStreamerLimit(params.density);
    this.contactCount = resolveElectricArcContactCount(params.density);

    const bass = weightedBandAverage(frame, 0, 10, params.bassWeight);
    this.midDrive = weightedBandAverage(frame, 10, 22, params.midWeight);
    this.trebleDrive = weightedBandAverage(frame, 22, 32, params.trebleWeight);
    const reduceMotion = environment?.reduceMotion === true;
    const previewLift = environment?.amplitudeMode === 'preview'
      ? reduceMotion ? 0.12 : 0.13 + Math.sin(frame.timeMs / 1000 * 0.61) * 0.025
      : 0;
    this.drive = clamp01(
      (clamp01(frame.energy) * 0.18
        + bass * 0.08
        + this.midDrive * 0.27
        + this.trebleDrive * 0.39
        + previewLift)
      * (0.55 + clamp01(params.sensitivity) * 1.45),
    );
    this.roamTime = frame.timeMs / 1000;
    this.roaming = !reduceMotion;
    if (this.drive <= 0.01) return;

    const cadenceMs = 52 + clamp01(params.smoothing) * 92;
    const epoch = reduceMotion ? 0 : Math.floor(frame.timeMs / cadenceMs);
    const baseCount = Math.round(this.streamerLimit * (0.38 + this.drive * 0.52));
    const activeCount = Math.min(
      this.streamerLimit,
      baseCount + (frame.transient && !reduceMotion ? 3 : 0),
    );
    for (let index = 0; index < activeCount; index += 1) {
      this.buildStreamer(this.paths[index]!, epoch * 31 + index * 17, frame.transient === true);
    }

    const palette = resolveVisualPalette(params.color);
    this.drawContacts(ctx, params, palette);
    this.drawPaths(ctx, params, palette, activeCount);
  }

  getPerformanceCost(): number {
    return this.streamerLimit * ((ELECTRIC_ARC_MAX_POINTS - 1) * 2 + 1)
      + this.contactCount * 3
      + Math.min(ELECTRIC_ARC_MAX_FORKS, this.streamerLimit)
        * (ELECTRIC_ARC_FORK_POINTS - 1) * 2;
  }

  private buildStreamer(path: CoronaPath, serial: number, surge: boolean): void {
    const contactIndex = Math.floor(seededUnit(serial, 3) * this.contactCount) % this.contactCount;
    this.resolveContact(contactIndex, this.contactCount, this.contact);
    const pointCount = 5 + Math.round(seededUnit(serial, 5) * 2);
    const fan = seededSigned(serial, 7) * (0.3 + this.midDrive * 0.46);
    const cos = Math.cos(fan);
    const sin = Math.sin(fan);
    const directionX = this.contact.normalX * cos - this.contact.normalY * sin;
    const directionY = this.contact.normalX * sin + this.contact.normalY * cos;
    const normalX = -directionY;
    const normalY = directionX;
    const minDimension = Math.max(24, Math.min(this.canvasWidth, this.canvasHeight));
    const length = minDimension
      * (0.055 + this.drive * 0.16 + this.trebleDrive * 0.08)
      * (0.7 + seededUnit(serial, 11) * 0.5)
      * (surge ? 1.24 : 1);
    let noise = seededSigned(serial, 13);
    for (let index = 0; index < pointCount; index += 1) {
      const t = index / (pointCount - 1);
      noise = noise * 0.24 + seededSigned(serial * 17 + index, 17) * 0.76;
      const jitter = Math.sin(Math.PI * t)
        * minDimension * (0.006 + this.midDrive * 0.014) * noise;
      const fanOut = seededSigned(serial, 19) * t * t * length * 0.12;
      path.x[index] = this.contact.x + directionX * length * t + normalX * (jitter + fanOut);
      path.y[index] = this.contact.y + directionY * length * t + normalY * (jitter + fanOut);
    }
    path.pointCount = pointCount;

    const fork = serial % ELECTRIC_ARC_MAX_STREAMERS < ELECTRIC_ARC_MAX_FORKS
      && (surge || seededUnit(serial, 23) < 0.16 + this.trebleDrive * 0.52);
    path.forkPointCount = fork ? ELECTRIC_ARC_FORK_POINTS : 0;
    if (!fork) return;
    const origin = Math.min(pointCount - 2, 2 + Math.floor(seededUnit(serial, 29) * 2));
    const side = seededSigned(serial, 31) < 0 ? -1 : 1;
    const forkLength = length * (0.24 + seededUnit(serial, 37) * 0.28);
    for (let index = 0; index < ELECTRIC_ARC_FORK_POINTS; index += 1) {
      const t = index / (ELECTRIC_ARC_FORK_POINTS - 1);
      const chatter = seededSigned(serial * 13 + index, 41) * minDimension * 0.004 * t;
      path.forkX[index] = (path.x[origin] ?? this.contact.x)
        + directionX * forkLength * t * 0.4
        + normalX * side * forkLength * t
        + normalX * chatter;
      path.forkY[index] = (path.y[origin] ?? this.contact.y)
        + directionY * forkLength * t * 0.4
        + normalY * side * forkLength * t
        + normalY * chatter;
    }
  }

  private resolveContact(index: number, count: number, target: ContactGeometry): void {
    // CHANGED: each contact sporadically relocates on its own seeded epoch clock.
    // WHY: corona rooted at fixed evenly-spaced points read as static; discharge should
    //      occur in random spots around/along the conductor rail (QA §4a electric-arc).
    let roamAngle = 0;
    let roamAlong = 0;
    if (this.roaming) {
      // CHANGED: jumps grew ~2.5× while epochs slowed 0.6–1.5 s → 0.9–2.2 s (Pass C).
      // WHY: QA read the roam as "just shifts slightly"; discharge points should leap
      //      to genuinely new spots, then dwell long enough for arcs to build there.
      const interval = 0.9 + seededUnit(index, 211) * 1.3;
      const epoch = Math.floor(this.roamTime / interval + seededUnit(index, 223) * 7);
      roamAngle = seededSigned(index * 13 + epoch, 227);
      roamAlong = seededSigned(index * 17 + epoch, 229);
    }
    if (this.layout === 'radial') {
      const angle = -Math.PI / 2 + index / count * Math.PI * 2 + roamAngle * 0.9;
      const radius = Math.min(this.canvasWidth, this.canvasHeight)
        * 0.235 * (1 + roamAlong * 0.18);
      target.x = this.canvasWidth / 2 + Math.cos(angle) * radius;
      target.y = this.canvasHeight / 2 + Math.sin(angle) * radius;
      target.normalX = Math.cos(angle);
      target.normalY = Math.sin(angle);
      return;
    }
    if (this.layout === 'centered') {
      const left = index % 2 === 0;
      const row = Math.floor(index / 2);
      const rows = Math.max(1, Math.ceil(count / 2));
      target.x = this.canvasWidth * (left ? 0.12 : 0.88);
      target.y = this.canvasHeight * Math.min(0.82, Math.max(
        0.2,
        0.31 + (rows === 1 ? 0.19 : row / (rows - 1) * 0.38) + roamAlong * 0.2,
      ));
      target.normalX = left ? 1 : -1;
      target.normalY = (0.5 - target.y / this.canvasHeight) * 0.24;
      return;
    }
    target.x = this.canvasWidth * Math.min(0.94, Math.max(
      0.06,
      0.14 + index / Math.max(1, count - 1) * 0.72 + roamAlong * 0.18,
    ));
    target.y = this.canvasHeight * 0.9;
    target.normalX = (target.x / this.canvasWidth - 0.5) * 0.24;
    target.normalY = -1;
  }

  private drawContacts(
    ctx: CanvasRenderingContext2D,
    params: VisualizerParams,
    palette: readonly string[],
  ): void {
    const highContrast = params.highContrast === true;
    const radius = Math.max(2.2, Math.min(this.canvasWidth, this.canvasHeight) * 0.008);
    const rim = highContrast ? '#ffffff' : mixVisualColors(paletteColorAt(palette, 0.62), '#78e6ff', 0.58);
    const conductor = mixVisualColors(paletteColorAt(palette, 0.18), '#0d1729', 0.62);
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowColor = highContrast ? 'transparent' : rim;
    ctx.shadowBlur = highContrast ? 0 : radius * 2.6;
    for (let index = 0; index < this.contactCount; index += 1) {
      this.resolveContact(index, this.contactCount, this.contact);
      ctx.beginPath();
      ctx.arc(this.contact.x, this.contact.y, radius * 1.65, 0, Math.PI * 2);
      ctx.fillStyle = colorWithAlpha(conductor, 0.88);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(this.contact.x, this.contact.y, radius * 1.2, 0, Math.PI * 2);
      ctx.strokeStyle = colorWithAlpha(rim, highContrast ? 1 : 0.84);
      ctx.lineWidth = highContrast ? 1.7 : 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(this.contact.x, this.contact.y, radius * 0.34, 0, Math.PI * 2);
      ctx.fillStyle = colorWithAlpha('#ffffff', 0.92);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawPaths(
    ctx: CanvasRenderingContext2D,
    params: VisualizerParams,
    palette: readonly string[],
    activeCount: number,
  ): void {
    const highContrast = params.highContrast === true;
    const minDimension = Math.min(this.canvasWidth, this.canvasHeight);
    const outer = mixVisualColors(paletteColorAt(palette, 0.42), '#705cff', 0.42);
    const core = highContrast ? '#ffffff' : mixVisualColors(paletteColorAt(palette, 0.86), '#bdf7ff', 0.66);
    const alpha = clamp01((0.58 + clamp01(params.intensity) * 0.42) * (0.68 + this.drive * 0.32));
    ctx.save();
    ctx.globalCompositeOperation = highContrast ? 'source-over' : 'lighter';
    for (let index = 0; index < activeCount; index += 1) {
      const path = this.paths[index]!;
      if (!highContrast) {
        ctx.strokeStyle = colorWithAlpha(outer, alpha * 0.38);
        ctx.lineWidth = Math.max(2.2, minDimension * 0.011);
        ctx.shadowColor = outer;
        ctx.shadowBlur = minDimension * 0.026;
        strokePolyline(ctx, path.x, path.y, path.pointCount);
      }
      ctx.strokeStyle = colorWithAlpha(core, alpha * (highContrast ? 1 : 0.94));
      ctx.lineWidth = highContrast ? Math.max(1.35, minDimension * 0.0038) : Math.max(0.75, minDimension * 0.0024);
      ctx.shadowColor = highContrast ? 'transparent' : core;
      ctx.shadowBlur = highContrast ? 0 : minDimension * 0.008;
      strokePolyline(ctx, path.x, path.y, path.pointCount);
      if (path.forkPointCount > 1) {
        if (!highContrast) {
          ctx.strokeStyle = colorWithAlpha(outer, alpha * 0.28);
          ctx.lineWidth = Math.max(1.7, minDimension * 0.007);
          ctx.shadowBlur = minDimension * 0.015;
          strokePolyline(ctx, path.forkX, path.forkY, path.forkPointCount);
        }
        ctx.strokeStyle = colorWithAlpha(core, alpha * 0.72);
        ctx.lineWidth = highContrast ? 1.2 : 0.65;
        ctx.shadowBlur = highContrast ? 0 : minDimension * 0.005;
        strokePolyline(ctx, path.forkX, path.forkY, path.forkPointCount);
      }
      ctx.beginPath();
      ctx.arc(path.x[path.pointCount - 1] ?? 0, path.y[path.pointCount - 1] ?? 0, Math.max(0.7, minDimension * 0.0027), 0, Math.PI * 2);
      ctx.fillStyle = colorWithAlpha('#ffffff', alpha * 0.82);
      ctx.fill();
    }
    ctx.restore();
  }
}

/**
 * CHANGED: Lightning keeps one continuously connected, slowly rerouted plasma channel between two contacts.
 * WHY: a sustained strike should read as conduction through ionized air, distinct from Electric Arc's corona.
 */
class LightningEffect implements StackableEffect {
  readonly id = LIGHTNING_ID;

  private readonly currentX = new Float32Array(LIGHTNING_MAX_POINTS);
  private readonly currentY = new Float32Array(LIGHTNING_MAX_POINTS);
  private readonly targetX = new Float32Array(LIGHTNING_MAX_POINTS);
  private readonly targetY = new Float32Array(LIGHTNING_MAX_POINTS);
  private readonly branches: LightningBranch[] = Array.from(
    { length: LIGHTNING_MAX_BRANCHES },
    () => ({
      active: false,
      x: new Float32Array(LIGHTNING_BRANCH_POINTS),
      y: new Float32Array(LIGHTNING_BRANCH_POINTS),
    }),
  );

  private pendingDt = 0;
  private routeAge = 0;
  private routeSerial = 0;
  private surge = 0;
  private channelReady = false;
  /** Walking behavior: endpoints alternate seeded relocations on a paced beat. */
  private walkTimer = 0;
  private walkSerial = 1;
  private startWalkSerial = 0;
  private endWalkSerial = 1;
  /**
   * CHANGED: each walk captures the dominant band's screen unit at the beat (Pass C).
   * WHY: Particle Burst's audio-anchored random placement was the operator's favorite;
   *      lightning endpoints now hunt toward where the voice's energy actually is.
   */
  private startAnchorUnit = 0.32;
  private endAnchorUnit = 0.68;
  private pointCount = LIGHTNING_MIN_POINTS;
  private branchLimit = LIGHTNING_MIN_BRANCHES;
  private activeBranches = 0;
  private canvasWidth = 1;
  private canvasHeight = 1;
  private layout: LayoutMode = 'linear';
  private startX = 0;
  private startY = 0;
  private endX = 0;
  private endY = 0;
  private drive = 0;
  private bassDrive = 0;
  private midDrive = 0;
  private trebleDrive = 0;
  private wasReducedMotion = false;

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
    const nextPointCount = resolveLightningPointCount(params.density);
    const geometryChanged = canvas.width !== this.canvasWidth
      || canvas.height !== this.canvasHeight
      || layout !== this.layout
      || nextPointCount !== this.pointCount;
    if (geometryChanged) {
      this.canvasWidth = Math.max(1, canvas.width);
      this.canvasHeight = Math.max(1, canvas.height);
      this.layout = layout;
      this.pointCount = nextPointCount;
      this.channelReady = false;
      this.routeAge = 0;
    }
    this.branchLimit = resolveLightningBranchLimit(params.density);

    const reduceMotion = environment?.reduceMotion === true;
    if (reduceMotion !== this.wasReducedMotion) {
      this.channelReady = false;
      this.routeAge = 0;
      this.wasReducedMotion = reduceMotion;
    }
    this.resolveAudioDrive(frame, params, environment, reduceMotion);
    if (this.drive <= 0.012) {
      this.channelReady = false;
      this.activeBranches = 0;
      this.pendingDt = 0;
      return;
    }

    // CHANGED: the strike "walks" — on a seeded beat one endpoint breaks loose and
    //          relocates while the other stays planted, alternating ends each beat.
    // WHY: a bolt permanently pinned between two fixed points read as boring (QA §4a);
    //      real sustained discharge hunts for new attachment points.
    if (!reduceMotion) {
      this.walkTimer += this.pendingDt;
      const walkInterval = Math.max(
        0.5,
        0.8 + seededUnit(this.walkSerial, 149) * 0.9 - this.trebleDrive * 0.3,
      );
      if (this.walkTimer >= walkInterval) {
        this.walkSerial += 1;
        let dominantBand = 0;
        let dominantLevel = -1;
        for (let index = 0; index < frame.bands.length; index += 1) {
          const level = clamp01(frame.bands[index] ?? 0);
          if (level > dominantLevel) {
            dominantLevel = level;
            dominantBand = index;
          }
        }
        const anchorUnit = (dominantBand + 0.5) / Math.max(1, frame.bands.length);
        if (this.walkSerial % 2 === 0) {
          this.startWalkSerial = this.walkSerial;
          this.startAnchorUnit = anchorUnit;
        } else {
          this.endWalkSerial = this.walkSerial;
          this.endAnchorUnit = anchorUnit;
        }
        this.walkTimer = 0;
        this.channelReady = false;
        this.surge = Math.max(this.surge, 0.66);
      }
    }
    this.resolveContacts(!reduceMotion);
    const palette = resolveVisualPalette(params.color);
    if (reduceMotion) {
      this.surge = 0;
      this.buildRoute(313, false, true);
      this.drawLightning(ctx, params, palette);
      this.pendingDt = 0;
      return;
    }

    this.routeAge += this.pendingDt;
    const rerouteInterval = 0.065 + clamp01(params.smoothing) * 0.15;
    if (!this.channelReady || frame.transient || this.routeAge >= rerouteInterval) {
      this.buildRoute(this.routeSerial, frame.transient === true, false);
      this.routeSerial += 1;
      this.routeAge = 0;
      this.surge = frame.transient ? 1 : Math.max(this.surge, 0.24 + this.trebleDrive * 0.32);
    } else {
      const response = 1 - Math.exp(-this.pendingDt * (12 + (1 - clamp01(params.smoothing)) * 18));
      for (let index = 1; index < this.pointCount - 1; index += 1) {
        this.currentX[index] += ((this.targetX[index] ?? 0) - (this.currentX[index] ?? 0)) * response;
        this.currentY[index] += ((this.targetY[index] ?? 0) - (this.currentY[index] ?? 0)) * response;
      }
    }
    this.surge = Math.max(0, this.surge - this.pendingDt * 2.7);
    this.drawLightning(ctx, params, palette);
    this.pendingDt = 0;
  }

  getPerformanceCost(): number {
    return (this.pointCount - 1) * 3
      + this.branchLimit * ((LIGHTNING_BRANCH_POINTS - 1) * 2 + 1)
      + 2 * 3;
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
      ? reduceMotion ? 0.14 : 0.145 + Math.sin(frame.timeMs / 1000 * 0.47) * 0.02
      : 0;
    this.drive = clamp01(
      (clamp01(frame.energy) * 0.38
        + this.bassDrive * 0.16
        + this.midDrive * 0.25
        + this.trebleDrive * 0.21
        + previewLift)
      * (0.58 + clamp01(params.sensitivity) * 1.42),
    );
  }

  private resolveContacts(walk: boolean): void {
    // Walk targets blend the beat's dominant-band anchor with seeded jitter, so
    // endpoints land where the voice's energy sits yet never repeat exactly.
    if (this.layout === 'centered') {
      this.startX = this.canvasWidth * 0.1;
      this.startY = this.canvasHeight * (walk
        ? 0.2 + Math.min(1, this.startAnchorUnit * 0.7
          + seededUnit(this.startWalkSerial, 151) * 0.3) * 0.6
        : 0.5);
      this.endX = this.canvasWidth * 0.9;
      this.endY = this.canvasHeight * (walk
        ? 0.2 + Math.min(1, this.endAnchorUnit * 0.7
          + seededUnit(this.endWalkSerial, 153) * 0.3) * 0.6
        : 0.5);
      return;
    }
    if (this.layout === 'radial') {
      this.startX = this.canvasWidth * 0.5;
      this.startY = this.canvasHeight * 0.5;
      if (walk) {
        // The hub stays planted; every walk beat hunts a new rim attachment near the
        // dominant band's angle.
        const angle = this.endAnchorUnit * Math.PI * 2 - Math.PI / 2
          + seededSigned(this.walkSerial, 151) * 0.6;
        const radius = Math.min(this.canvasWidth, this.canvasHeight) * 0.4;
        this.endX = this.canvasWidth / 2 + Math.cos(angle) * radius;
        this.endY = this.canvasHeight / 2 + Math.sin(angle) * radius;
      } else {
        this.endX = this.canvasWidth * 0.83;
        this.endY = this.canvasHeight * 0.17;
      }
      return;
    }
    if (walk) {
      this.startX = this.canvasWidth * Math.min(0.92, Math.max(
        0.06,
        0.08 + this.startAnchorUnit * 0.62 + seededSigned(this.startWalkSerial, 151) * 0.14,
      ));
      this.startY = this.canvasHeight * (0.58 + seededUnit(this.startWalkSerial, 155) * 0.34);
      this.endX = this.canvasWidth * Math.min(0.94, Math.max(
        0.06,
        0.1 + this.endAnchorUnit * 0.66 + seededSigned(this.endWalkSerial, 153) * 0.16,
      ));
      this.endY = this.canvasHeight * (0.06 + seededUnit(this.endWalkSerial, 157) * 0.36);
      return;
    }
    this.startX = this.canvasWidth * 0.15;
    this.startY = this.canvasHeight * 0.82;
    this.endX = this.canvasWidth * 0.85;
    this.endY = this.canvasHeight * 0.18;
  }

  private buildRoute(serial: number, transient: boolean, fixed: boolean): void {
    const dx = this.endX - this.startX;
    const dy = this.endY - this.startY;
    const length = Math.max(1, Math.hypot(dx, dy));
    const normalX = -dy / length;
    const normalY = dx / length;
    const minDimension = Math.max(24, Math.min(this.canvasWidth, this.canvasHeight));
    // CHANGED: displacement grew ~40% and a per-route low-frequency bow rides under
    //          the point jitter (Pass C §4a).
    // WHY: the channel read as a jittered straight line; real bolts carry one or two
    //      broad arcs that reroute along with the fine chatter.
    const displacement = minDimension
      * (0.016 + this.midDrive * 0.045 + this.drive * 0.016)
      * (transient ? 1.18 : 1);
    const bowFrequency = 1 + seededUnit(serial, 109) * 1.6;
    const bowPhase = seededUnit(serial, 111) * Math.PI * 2;
    let noise = seededSigned(serial, 101);
    for (let index = 0; index < this.pointCount; index += 1) {
      const t = index / (this.pointCount - 1);
      noise = noise * 0.18 + seededSigned(serial * 37 + index, 103) * 0.82;
      const microFork = seededSigned(serial * 17 + index, 107) * 0.22;
      const bow = Math.sin(t * Math.PI * bowFrequency + bowPhase) * 0.85;
      const offset = Math.sin(Math.PI * t) * displacement * (noise + microFork + bow);
      this.targetX[index] = this.startX + dx * t + normalX * offset;
      this.targetY[index] = this.startY + dy * t + normalY * offset;
    }
    this.targetX[0] = this.startX;
    this.targetY[0] = this.startY;
    this.targetX[this.pointCount - 1] = this.endX;
    this.targetY[this.pointCount - 1] = this.endY;

    if (!this.channelReady || transient || fixed) {
      this.currentX.set(this.targetX);
      this.currentY.set(this.targetY);
      this.channelReady = true;
    }
    this.buildBranches(serial, normalX, normalY, transient, fixed);
  }

  private buildBranches(
    serial: number,
    normalX: number,
    normalY: number,
    transient: boolean,
    fixed: boolean,
  ): void {
    const desired = fixed
      ? Math.min(2, this.branchLimit)
      : Math.min(
          this.branchLimit,
          Math.max(0, Math.floor(this.trebleDrive * this.branchLimit * 1.15 + (transient ? 2 : 0))),
        );
    const pathDx = this.endX - this.startX;
    const pathDy = this.endY - this.startY;
    const pathLength = Math.max(1, Math.hypot(pathDx, pathDy));
    const alongX = pathDx / pathLength;
    const alongY = pathDy / pathLength;
    const minDimension = Math.max(24, Math.min(this.canvasWidth, this.canvasHeight));
    this.activeBranches = desired;
    for (let branchIndex = 0; branchIndex < this.branches.length; branchIndex += 1) {
      const branch = this.branches[branchIndex];
      if (!branch) continue;
      branch.active = branchIndex < desired;
      if (!branch.active) continue;
      const originIndex = Math.min(
        this.pointCount - 3,
        3 + Math.floor(seededUnit(serial * 13 + branchIndex, 109) * (this.pointCount - 6)),
      );
      const side = seededSigned(serial * 19 + branchIndex, 113) < 0 ? -1 : 1;
      const branchLength = minDimension
        * (0.06 + seededUnit(serial * 23 + branchIndex, 127) * 0.095)
        * (transient ? 1.18 : 1);
      for (let index = 0; index < LIGHTNING_BRANCH_POINTS; index += 1) {
        const t = index / (LIGHTNING_BRANCH_POINTS - 1);
        const jitter = seededSigned(serial * 31 + branchIndex * 7 + index, 131)
          * minDimension * 0.006 * Math.sin(Math.PI * t);
        branch.x[index] = (this.targetX[originIndex] ?? this.startX)
          + normalX * side * branchLength * t
          + alongX * branchLength * t * 0.3
          + normalX * jitter;
        branch.y[index] = (this.targetY[originIndex] ?? this.startY)
          + normalY * side * branchLength * t
          + alongY * branchLength * t * 0.3
          + normalY * jitter;
      }
    }
  }

  private drawLightning(
    ctx: CanvasRenderingContext2D,
    params: VisualizerParams,
    palette: readonly string[],
  ): void {
    const highContrast = params.highContrast === true;
    const minDimension = Math.min(this.canvasWidth, this.canvasHeight);
    const intensity = 0.64 + clamp01(params.intensity) * 0.78;
    const outer = mixVisualColors(paletteColorAt(palette, 0.35), '#5b4dff', 0.48);
    const body = mixVisualColors(paletteColorAt(palette, 0.72), '#72dfff', 0.64);
    const core = highContrast ? '#ffffff' : mixVisualColors(body, '#ffffff', 0.82);
    const surge = 1 + this.surge * 0.54;
    ctx.save();
    ctx.globalCompositeOperation = highContrast ? 'source-over' : 'lighter';
    ctx.shadowColor = highContrast ? 'transparent' : outer;
    ctx.shadowBlur = highContrast ? 0 : minDimension * (0.018 + this.drive * 0.018);
    this.drawContact(ctx, this.startX, this.startY, outer, core, highContrast, minDimension);
    this.drawContact(ctx, this.endX, this.endY, outer, core, highContrast, minDimension);

    for (let index = 0; index < this.activeBranches; index += 1) {
      const branch = this.branches[index];
      if (!branch?.active) continue;
      if (!highContrast) {
        ctx.strokeStyle = colorWithAlpha(outer, 0.26 * intensity * surge);
        ctx.lineWidth = Math.max(2, minDimension * 0.009 * surge);
        ctx.shadowBlur = minDimension * 0.014;
        strokePolyline(ctx, branch.x, branch.y, LIGHTNING_BRANCH_POINTS);
      }
      ctx.strokeStyle = colorWithAlpha(body, (highContrast ? 0.92 : 0.66) * intensity);
      ctx.lineWidth = highContrast ? Math.max(1.15, minDimension * 0.0038) : Math.max(0.7, minDimension * 0.0023);
      ctx.shadowColor = highContrast ? 'transparent' : body;
      ctx.shadowBlur = highContrast ? 0 : minDimension * 0.006;
      strokePolyline(ctx, branch.x, branch.y, LIGHTNING_BRANCH_POINTS);
      ctx.beginPath();
      ctx.arc(branch.x[LIGHTNING_BRANCH_POINTS - 1] ?? 0, branch.y[LIGHTNING_BRANCH_POINTS - 1] ?? 0, Math.max(0.65, minDimension * 0.0024), 0, Math.PI * 2);
      ctx.fillStyle = colorWithAlpha(core, 0.68 * intensity);
      ctx.fill();
    }

    if (!highContrast) {
      ctx.strokeStyle = colorWithAlpha(outer, 0.3 * intensity * surge);
      ctx.lineWidth = Math.max(4, minDimension * (0.024 + this.bassDrive * 0.012) * surge);
      ctx.shadowColor = outer;
      ctx.shadowBlur = minDimension * 0.038;
      strokePolyline(ctx, this.currentX, this.currentY, this.pointCount);
    }
    ctx.strokeStyle = colorWithAlpha(body, (highContrast ? 0.98 : 0.84) * intensity);
    ctx.lineWidth = highContrast
      ? Math.max(2, minDimension * 0.0062)
      : Math.max(1.35, minDimension * (0.0052 + this.drive * 0.0028) * surge);
    ctx.shadowColor = highContrast ? 'transparent' : body;
    ctx.shadowBlur = highContrast ? 0 : minDimension * 0.014;
    strokePolyline(ctx, this.currentX, this.currentY, this.pointCount);
    ctx.strokeStyle = colorWithAlpha(core, Math.min(1, 0.92 * intensity * surge));
    ctx.lineWidth = highContrast
      ? Math.max(0.95, minDimension * 0.0028)
      : Math.max(0.65, minDimension * 0.0019 * surge);
    ctx.shadowColor = highContrast ? 'transparent' : core;
    ctx.shadowBlur = highContrast ? 0 : minDimension * 0.005;
    strokePolyline(ctx, this.currentX, this.currentY, this.pointCount);
    ctx.restore();
  }

  private drawContact(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    outer: string,
    core: string,
    highContrast: boolean,
    minDimension: number,
  ): void {
    const radius = Math.max(3, minDimension * 0.012);
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.7, 0, Math.PI * 2);
    ctx.fillStyle = colorWithAlpha(outer, highContrast ? 0.52 : 0.28);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = colorWithAlpha(core, 0.94);
    ctx.lineWidth = highContrast ? 2 : 1.25;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.38, 0, Math.PI * 2);
    ctx.fillStyle = colorWithAlpha('#ffffff', 0.96);
    ctx.fill();
  }
}

export const ELECTRIC_ARC_EFFECT_DEFINITION: StackableEffectDefinition = Object.freeze({
  id: ELECTRIC_ARC_ID,
  label: ELECTRIC_ARC_LABEL,
  maxElements: ELECTRIC_ARC_MAX_ELEMENTS,
  defaultParams: Object.freeze({
    color: Object.freeze(['#6a5cff', '#5bdcff', '#efffff']),
    density: 0.55,
    sensitivity: 0.62,
    intensity: 0.58,
    smoothing: 0.34,
  }),
  create: () => new ElectricArcEffect(),
});

export const LIGHTNING_EFFECT_DEFINITION: StackableEffectDefinition = Object.freeze({
  id: LIGHTNING_ID,
  label: LIGHTNING_LABEL,
  maxElements: LIGHTNING_MAX_ELEMENTS,
  defaultParams: Object.freeze({
    color: Object.freeze(['#4338ca', '#36c9ff', '#f7ffff']),
    density: 0.58,
    sensitivity: 0.58,
    intensity: 0.7,
    smoothing: 0.48,
  }),
  create: () => new LightningEffect(),
});
