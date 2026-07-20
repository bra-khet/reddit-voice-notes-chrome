import type {
  AudioVisualRenderEnvironment,
  AudioVizFrame,
  BoundedPlumeNode,
  BoundedPlumeNodeInitializer,
  LayoutMode,
  StackableEffect,
  StackableEffectDefinition,
  VisualizerParams,
} from '@/src/theme/audio-reactive';
import { BoundedPlumeField } from '@/src/theme/audio-reactive';
import {
  colorWithAlpha,
  mixVisualColors,
  resolveVisualPalette,
} from '../palette';

export const LAYERED_SMOKE_ID = 'smoke' as const;
export const LAYERED_SMOKE_LABEL = 'Layered Smoke' as const;
export const LAYERED_SMOKE_MIN_PLUMES = 4;
export const LAYERED_SMOKE_MAX_PLUMES = 10;
export const LAYERED_SMOKE_NODES_PER_PLUME = 9;
export const LAYERED_SMOKE_MAX_NODES = (
  LAYERED_SMOKE_MAX_PLUMES * LAYERED_SMOKE_NODES_PER_PLUME
);
/** Three translucent lobes per node plus one connective spine per plume. */
export const LAYERED_SMOKE_MAX_ELEMENTS = (
  LAYERED_SMOKE_MAX_NODES * 3 + LAYERED_SMOKE_MAX_PLUMES
);

interface SmokeNode extends BoundedPlumeNode {
  index: number;
  plumeIndex: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  phase: number;
  depth: number;
  curl: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function seededUnit(index: number, salt: number): number {
  const value = Math.sin(index * 83.219 + salt * 19.731) * 43758.5453;
  return value - Math.floor(value);
}

function resolveLayout(params: VisualizerParams): LayoutMode {
  return params.layoutMode === 'centered' || params.layoutMode === 'radial'
    ? params.layoutMode
    : 'linear';
}

export function resolveLayeredSmokePlumeLimit(density: number): number {
  return Math.round(
    LAYERED_SMOKE_MIN_PLUMES
      + clamp01(density) * (LAYERED_SMOKE_MAX_PLUMES - LAYERED_SMOKE_MIN_PLUMES),
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
 * CHANGED: Layered Smoke renders coherent, audio-shaped plume trails from a fixed history field.
 * WHY: smoke should read as rolling volume and wispy shear, not as recolored circular particles.
 */
class LayeredSmokeEffect implements StackableEffect {
  readonly id = LAYERED_SMOKE_ID;

  private readonly field = new BoundedPlumeField<SmokeNode>(
    LAYERED_SMOKE_MAX_PLUMES,
    LAYERED_SMOKE_NODES_PER_PLUME,
    (index) => ({
      index,
      plumeIndex: Math.floor(index / LAYERED_SMOKE_NODES_PER_PLUME),
      active: false,
      age: 0,
      lifetime: 1,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      radius: 1,
      phase: 0,
      depth: 0,
      curl: 0,
    }),
  );

  private readonly emissionCarry = new Float32Array(LAYERED_SMOKE_MAX_PLUMES);
  private pendingDt = 0;
  private spawnSerial = 0;
  /** Frame clock sampled by the smoothly wandering vent origins. */
  private ventTime = 0;
  private canvasWidth = 0;
  private canvasHeight = 0;
  private layout: LayoutMode = 'linear';
  private drive = 0;
  private bassDrive = 0;
  private midDrive = 0;
  private trebleDrive = 0;
  private currentPlumeIndex = 0;
  private primeProgress = 0;
  private wasReducedMotion = false;

  private readonly initializeNode: BoundedPlumeNodeInitializer<SmokeNode> = (node) => {
    const serial = this.spawnSerial;
    this.spawnSerial += 1;
    const plumeIndex = this.currentPlumeIndex;
    const plumeUnit = (plumeIndex + 0.5) / Math.max(1, this.field.plumeLimit);
    const texture = seededUnit(serial, 7);
    const direction = seededUnit(plumeIndex, 13) * 2 - 1;
    const minDimension = Math.max(24, Math.min(this.canvasWidth, this.canvasHeight));

    node.plumeIndex = plumeIndex;
    node.phase = seededUnit(serial, 17) * Math.PI * 2;
    node.depth = seededUnit(plumeIndex, 23) * 0.72 + texture * 0.28;
    node.curl = direction * (0.65 + seededUnit(serial, 29) * 0.7);
    node.radius = minDimension * (0.018 + texture * 0.018) * (0.8 + this.drive * 0.46);
    node.lifetime = 3.1 + texture * 2.2 + (1 - this.trebleDrive) * 0.45;

    // CHANGED: vents wander smoothly via two slow incommensurate sines sampled at spawn
    //          time, and the source row spreads wider across the frame.
    // WHY: fixed evenly-spaced vents read as static chimneys (QA §4a smoke); smoke should
    //      drift its origin with smooth noise — unlike electricity's sporadic jumps — and
    //      wider coverage buys more mileage from the same bounded node pool.
    const wander = Math.sin(
      this.ventTime * (0.09 + seededUnit(plumeIndex, 43) * 0.07)
        + seededUnit(plumeIndex, 51) * Math.PI * 2,
    ) * 0.6
      + Math.sin(
        this.ventTime * (0.041 + seededUnit(plumeIndex, 53) * 0.03)
          + seededUnit(plumeIndex, 59) * Math.PI * 2,
      ) * 0.4;
    // CHANGED: each plume alternates agitation and calm on its own epoch cycle (Pass C).
    // WHY: the smooth walk still read as "a slow walk". During the agitated window every
    //      spawned puff jumps a fair seeded distance (high frequency, high amplitude,
    //      fading as the window closes), then the vent settles back to the low-amplitude
    //      wander — so the whole bottom reads as random smoke plumes that jitter, calm
    //      down, and jitter again.
    const cycle = 2.2 + seededUnit(plumeIndex, 61) * 1.8;
    const cyclePhase = ((this.ventTime / cycle + seededUnit(plumeIndex, 67)) % 1 + 1) % 1;
    const agitation = cyclePhase < 0.32 ? 1 - cyclePhase / 0.32 : 0;
    const jump = (seededUnit(serial, 73) - 0.5) * 2 * agitation;

    if (this.layout === 'radial') {
      const angle = -Math.PI / 2 + plumeUnit * Math.PI * 2 + wander * 0.35 + jump * 0.85;
      const sourceRadius = minDimension * (0.05 + seededUnit(plumeIndex, 31) * 0.07);
      const speed = 15 + this.drive * 23 + this.bassDrive * 9;
      node.x = this.canvasWidth / 2 + Math.cos(angle) * sourceRadius;
      node.y = this.canvasHeight / 2 + Math.sin(angle) * sourceRadius;
      node.vx = Math.cos(angle) * speed - Math.sin(angle) * direction * 5;
      node.vy = Math.sin(angle) * speed + Math.cos(angle) * direction * 5;
    } else {
      const spread = this.layout === 'centered' ? 0.3 : 0.98;
      const sourceTexture = seededUnit(plumeIndex, 37) - 0.5;
      node.x = this.canvasWidth * Math.min(0.97, Math.max(
        0.03,
        0.5 + (plumeUnit - 0.5) * spread
          + wander * 0.07
          + jump * (this.layout === 'centered' ? 0.1 : 0.15)
          + sourceTexture * minDimension / Math.max(1, this.canvasWidth) * 0.045,
      ));
      node.y = this.canvasHeight * (this.layout === 'centered' ? 0.88 : 0.97)
        + texture * minDimension * 0.018;
      node.vx = direction * (3 + this.midDrive * 8);
      node.vy = -(13 + this.drive * 22 + this.bassDrive * 10);
    }

    if (this.primeProgress > 0) {
      node.age = node.lifetime * this.primeProgress;
      const travel = node.age;
      const curlOffset = Math.sin(node.phase + travel * (1.1 + this.midDrive))
        * minDimension * 0.045 * this.primeProgress;
      if (this.layout === 'radial') {
        const dx = node.vx * travel * 0.72;
        const dy = node.vy * travel * 0.72;
        const length = Math.max(1, Math.hypot(dx, dy));
        node.x += dx - dy / length * curlOffset;
        node.y += dy + dx / length * curlOffset;
      } else {
        node.x += node.vx * travel * 0.72 + curlOffset;
        node.y += node.vy * travel * 0.76;
      }
      node.radius += minDimension * (0.007 + node.depth * 0.006) * travel;
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
      this.clearSmoke();
    }

    const plumeLimit = this.field.configurePlumeLimit(
      resolveLayeredSmokePlumeLimit(params.density),
    );
    const reduceMotion = environment?.reduceMotion === true;
    if (reduceMotion !== this.wasReducedMotion) {
      this.clearSmoke();
      this.wasReducedMotion = reduceMotion;
    }

    this.resolveAudioDrive(frame, params, environment, reduceMotion);
    this.ventTime = frame.timeMs / 1000;
    const palette = resolveVisualPalette(params.color);
    if (reduceMotion) {
      this.drawReducedMotion(ctx, canvas, frame, params, palette, plumeLimit);
      this.pendingDt = 0;
      return;
    }

    if (this.field.activeCount === 0 && this.drive > 0.01) {
      this.primePlumes(params, plumeLimit);
    }

    this.field.advance(this.pendingDt);
    this.advanceNodes(frame, params, this.pendingDt);
    this.emitNodes(frame, params, plumeLimit, environment);
    this.pendingDt = 0;
    this.drawSmoke(ctx, params, palette, plumeLimit);
  }

  getPerformanceCost(): number {
    return this.field.plumeLimit * (LAYERED_SMOKE_NODES_PER_PLUME * 3 + 1);
  }

  private clearSmoke(): void {
    this.field.clear();
    this.emissionCarry.fill(0);
    this.spawnSerial = 0;
    this.primeProgress = 0;
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
        ? 0.12
        : 0.11 + Math.sin(frame.timeMs / 1000 * 0.43) * 0.022
      : 0;
    const sensitivity = 0.55 + clamp01(params.sensitivity) * 1.45;
    this.drive = clamp01(
      (clamp01(frame.energy) * 0.3
        + this.bassDrive * 0.24
        + this.midDrive * 0.31
        + this.trebleDrive * 0.15
        + previewLift)
      * sensitivity,
    );
  }

  private primePlumes(params: VisualizerParams, plumeLimit: number): void {
    const count = Math.min(
      LAYERED_SMOKE_NODES_PER_PLUME - 1,
      Math.round(3 + this.drive * 3 + clamp01(params.density) * 2),
    );
    for (let plumeIndex = 0; plumeIndex < plumeLimit; plumeIndex += 1) {
      for (let nodeIndex = 0; nodeIndex < count; nodeIndex += 1) {
        this.primeProgress = (nodeIndex + seededUnit(plumeIndex, nodeIndex + 41) * 0.35)
          / Math.max(1, count) * 0.78;
        this.appendNode(plumeIndex);
      }
    }
    this.primeProgress = 0;
  }

  private emitNodes(
    frame: AudioVizFrame,
    params: VisualizerParams,
    plumeLimit: number,
    environment: AudioVisualRenderEnvironment | undefined,
  ): void {
    const baseRate = environment?.amplitudeMode === 'preview' ? 1.4 : 0.35;
    const rate = this.drive <= 0.008
      ? baseRate
      : 0.75 + this.drive * (1.3 + clamp01(params.density) * 2.2) + this.midDrive * 0.8;

    for (let plumeIndex = 0; plumeIndex < plumeLimit; plumeIndex += 1) {
      this.emissionCarry[plumeIndex] += rate * this.pendingDt
        * (0.82 + seededUnit(plumeIndex, 47) * 0.36);
      if (frame.transient && (plumeIndex + this.spawnSerial) % 2 === 0) {
        // CHANGED: transients shed fresh wisps into alternating bounded plume rings.
        // WHY: vocal attacks should visibly disturb the smoke without creating an unbounded burst system.
        this.emissionCarry[plumeIndex] += 1;
      }

      let emitted = 0;
      while (this.emissionCarry[plumeIndex] >= 1 && emitted < 2) {
        this.appendNode(plumeIndex);
        this.emissionCarry[plumeIndex] -= 1;
        emitted += 1;
      }
      this.emissionCarry[plumeIndex] = Math.min(this.emissionCarry[plumeIndex], 2);
    }
  }

  private appendNode(plumeIndex: number): void {
    this.currentPlumeIndex = plumeIndex;
    this.field.append(plumeIndex, this.initializeNode);
  }

  private advanceNodes(frame: AudioVizFrame, params: VisualizerParams, dt: number): void {
    if (dt <= 0) return;
    const minDimension = Math.max(24, Math.min(this.canvasWidth, this.canvasHeight));
    const time = frame.timeMs / 1000;
    const drag = Math.exp(-dt * (0.34 + clamp01(params.smoothing) * 0.52));

    for (const node of this.field.nodes) {
      if (!node.active || node.plumeIndex >= this.field.plumeLimit) continue;
      const life = clamp01(node.age / node.lifetime);
      const curl = Math.sin(node.phase + time * (0.72 + this.midDrive * 0.9) + life * 4.8)
        * node.curl;
      if (this.layout === 'radial') {
        const dx = node.x - this.canvasWidth / 2;
        const dy = node.y - this.canvasHeight / 2;
        const length = Math.max(1, Math.hypot(dx, dy));
        const radial = 2 + this.bassDrive * 5;
        const shear = curl * (4 + this.midDrive * 14) * (0.45 + life);
        node.vx += (dx / length * radial - dy / length * shear) * dt;
        node.vy += (dy / length * radial + dx / length * shear) * dt;
      } else {
        node.vx += curl * (4 + this.midDrive * 16) * dt;
        node.vy -= (1.8 + this.bassDrive * 5.5) * dt;
      }
      node.vx *= drag;
      node.vy *= 0.997;
      node.x += node.vx * dt;
      node.y += node.vy * dt;
      node.radius += minDimension * (0.005 + node.depth * 0.006 + this.midDrive * 0.003) * dt;
    }
  }

  private drawSmoke(
    ctx: CanvasRenderingContext2D,
    params: VisualizerParams,
    palette: readonly string[],
    plumeLimit: number,
  ): void {
    const highContrast = params.highContrast === true;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';

    for (let layer = 0; layer < 3; layer += 1) {
      for (const node of this.field.nodes) {
        if (!node.active || node.plumeIndex >= plumeLimit) continue;
        this.drawLobe(
          ctx,
          node.x,
          node.y,
          node.radius,
          clamp01(node.age / node.lifetime),
          node.depth,
          node.phase,
          palette,
          params,
          layer,
        );
      }
    }

    for (let plumeIndex = 0; plumeIndex < plumeLimit; plumeIndex += 1) {
      this.drawSpine(ctx, plumeIndex, palette, highContrast);
    }
    ctx.restore();
  }

  private drawLobe(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    life: number,
    depth: number,
    phase: number,
    palette: readonly string[],
    params: VisualizerParams,
    layer: number,
  ): void {
    const highContrast = params.highContrast === true;
    const birth = Math.min(1, life / 0.09);
    const death = Math.pow(1 - life, 0.72);
    const envelope = birth * death * (0.65 + clamp01(params.intensity) * 0.55);
    const layerScale = layer === 0 ? 1.34 : layer === 1 ? 0.9 : 0.46;
    const layerAlpha = layer === 0 ? 0.055 : layer === 1 ? 0.13 : 0.105;
    const colorPosition = clamp01(0.16 + life * 0.52 + depth * 0.25 + layer * 0.08);
    const color = paletteColorAt(palette, colorPosition);
    const offset = layer === 2 ? radius * 0.16 : layer === 0 ? radius * -0.08 : 0;
    const drawX = x + Math.cos(phase + life * 5.2) * offset;
    const drawY = y + Math.sin(phase * 0.7 + life * 3.8) * offset - (layer === 2 ? radius * 0.16 : 0);

    ctx.beginPath();
    ctx.arc(drawX, drawY, Math.max(0.8, radius * layerScale), 0, Math.PI * 2);
    ctx.fillStyle = colorWithAlpha(
      highContrast && layer === 1 ? mixVisualColors(color, '#ffffff', 0.28) : color,
      clamp01(envelope * (highContrast ? layerAlpha * 2.6 : layerAlpha)),
    );
    ctx.shadowColor = highContrast ? 'transparent' : colorWithAlpha(color, 0.42);
    ctx.shadowBlur = highContrast ? 0 : radius * (layer === 0 ? 1.25 : 0.58);
    ctx.fill();
  }

  private drawSpine(
    ctx: CanvasRenderingContext2D,
    plumeIndex: number,
    palette: readonly string[],
    highContrast: boolean,
  ): void {
    let points = 0;
    // Agitated vents jump per puff; break the spine over long gaps so those jumps
    // scatter into separate wisps instead of drawing a chord across the bottom.
    const gapLimit = Math.max(24, Math.min(this.canvasWidth, this.canvasHeight)) * 0.22;
    let previousX = 0;
    let previousY = 0;
    let ventX = 0;
    let ventY = 0;
    ctx.beginPath();
    for (let offset = 0; offset < LAYERED_SMOKE_NODES_PER_PLUME; offset += 1) {
      const node = this.field.nodeAt(plumeIndex, offset);
      if (!node?.active) continue;
      if (points === 0 || Math.hypot(node.x - previousX, node.y - previousY) > gapLimit) {
        ctx.moveTo(node.x, node.y);
      } else {
        ctx.lineTo(node.x, node.y);
      }
      if (points === 0) {
        ventX = node.x;
        ventY = node.y;
      }
      previousX = node.x;
      previousY = node.y;
      points += 1;
    }
    if (points < 2) return;
    const color = paletteColorAt(palette, 0.68);
    // CHANGED: the spine fades along its length — full alpha at the vent end
    //          (offset 0 = newest node), zero where the plume dissipates —
    //          in BOTH contrast modes (QA Pass D §3 line-taper note).
    // WHY: the flat-alpha polyline read as a bare drawn line over the puffs,
    //      hardest on High Contrast where there is no shadow to soften it; a
    //      single canvas-space gradient is the performant smoothing treatment.
    const spineAlpha = highContrast ? 0.34 : 0.075;
    const taper = ctx.createLinearGradient(ventX, ventY, previousX, previousY);
    taper.addColorStop(0, colorWithAlpha(color, spineAlpha));
    taper.addColorStop(0.55, colorWithAlpha(color, spineAlpha * 0.55));
    taper.addColorStop(1, colorWithAlpha(color, 0));
    ctx.strokeStyle = taper;
    ctx.lineWidth = highContrast ? 1.4 : 2.2;
    ctx.shadowColor = highContrast ? 'transparent' : colorWithAlpha(color, 0.28);
    ctx.shadowBlur = highContrast ? 0 : 7;
    ctx.stroke();
  }

  private drawReducedMotion(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    frame: AudioVizFrame,
    params: VisualizerParams,
    palette: readonly string[],
    plumeLimit: number,
  ): void {
    if (this.drive <= 0.01) return;
    const nodesPerPlume = Math.min(
      LAYERED_SMOKE_NODES_PER_PLUME,
      Math.round(3 + this.drive * 4 + clamp01(params.density) * 2),
    );
    const minDimension = Math.max(24, Math.min(canvas.width, canvas.height));
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    for (let plumeIndex = 0; plumeIndex < plumeLimit; plumeIndex += 1) {
      const plumeUnit = (plumeIndex + 0.5) / plumeLimit;
      for (let nodeIndex = 0; nodeIndex < nodesPerPlume; nodeIndex += 1) {
        const life = (nodeIndex + 0.55) / (nodesPerPlume + 0.7) * 0.82;
        const texture = seededUnit(plumeIndex * LAYERED_SMOKE_NODES_PER_PLUME + nodeIndex, 71);
        const band = clamp01(frame.bands[(plumeIndex * 3 + nodeIndex * 5) % frame.bands.length] ?? 0);
        const radius = minDimension * (0.022 + texture * 0.025) * (0.8 + band * 0.35);
        let x: number;
        let y: number;
        if (this.layout === 'radial') {
          const angle = -Math.PI / 2 + plumeUnit * Math.PI * 2;
          const orbit = minDimension * (0.08 + life * 0.44);
          x = canvas.width / 2 + Math.cos(angle) * orbit;
          y = canvas.height / 2 + Math.sin(angle) * orbit;
        } else {
          const spread = this.layout === 'centered' ? 0.22 : 0.9;
          x = canvas.width * (0.5 + (plumeUnit - 0.5) * spread)
            + Math.sin(nodeIndex * 1.7 + plumeIndex) * minDimension * 0.025;
          y = canvas.height * (this.layout === 'centered' ? 0.86 : 0.95)
            - life * canvas.height * (this.layout === 'centered' ? 0.68 : 0.78);
        }
        for (let layer = 0; layer < 3; layer += 1) {
          this.drawLobe(
            ctx,
            x,
            y,
            radius,
            life,
            texture,
            texture * Math.PI * 2,
            palette,
            params,
            layer,
          );
        }
      }
    }
    ctx.restore();
  }
}

export const LAYERED_SMOKE_EFFECT_DEFINITION: StackableEffectDefinition = Object.freeze({
  id: LAYERED_SMOKE_ID,
  label: LAYERED_SMOKE_LABEL,
  maxElements: LAYERED_SMOKE_MAX_ELEMENTS,
  defaultParams: Object.freeze({
    sensitivity: 0.66,
    intensity: 0.68,
    smoothing: 0.62,
    density: 0.58,
    color: Object.freeze(['#111827', '#334155', '#64748b', '#a8b5c6', '#e2e8f0']),
    layoutMode: 'linear',
    highContrast: false,
  }),
  create: () => new LayeredSmokeEffect(),
});
