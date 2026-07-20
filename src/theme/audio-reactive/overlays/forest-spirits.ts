import type {
  AudioVisual,
  AudioVisualDefinition,
  AudioVisualRenderEnvironment,
  AudioVizFrame,
  ReactiveAgent,
  VisualizerParams,
} from '@/src/theme/audio-reactive';
import {
  AudioReactiveSimulation,
  DEFAULT_SPATIAL_PARTITION_CELL_SIZE,
  sampleLayeredVectorFlowField,
  type FlowFieldVector,
} from '@/src/theme/audio-reactive';
import { colorWithAlpha, mixVisualColors, resolveVisualPalette } from '../palette';

export const FOREST_SPIRITS_ID = 'forest-spirits' as const;
export const FOREST_SPIRITS_CHAIN_COUNT = 3;
export const FOREST_SPIRITS_MIN_AGENTS = 18;
export const FOREST_SPIRITS_MAX_AGENTS = 48;
/** Two bounded filament passes + agent lights + three leader crowns stay below this ceiling. */
export const FOREST_SPIRITS_MAX_ELEMENTS = 192;

interface ForestSpiritAgent extends ReactiveAgent {
  readonly index: number;
  readonly chain: number;
  readonly order: number;
  readonly phase: number;
  readonly depth: number;
}

const CHAIN_BASE_X = [0.2, 0.51, 0.79] as const;
const CHAIN_BASE_Y = [0.34, 0.68, 0.28] as const;
const CHAIN_HEADING = [0.18, 2.72, -2.54] as const;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function wrapAngle(value: number): number {
  return ((value + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
}

function seededUnit(index: number, salt: number): number {
  const value = Math.sin(index * 91.733 + salt * 37.719) * 43758.5453;
  return value - Math.floor(value);
}

/** Density changes whole three-spirit chain rows, keeping every chain balanced. */
export function resolveForestSpiritsAgentCount(density: number): number {
  const minPerChain = FOREST_SPIRITS_MIN_AGENTS / FOREST_SPIRITS_CHAIN_COUNT;
  const maxPerChain = FOREST_SPIRITS_MAX_AGENTS / FOREST_SPIRITS_CHAIN_COUNT;
  const perChain = Math.round(minPerChain + clamp01(density) * (maxPerChain - minPerChain));
  return perChain * FOREST_SPIRITS_CHAIN_COUNT;
}

function createForestSpiritAgent(index: number): ForestSpiritAgent {
  return {
    active: false,
    index,
    chain: index % FOREST_SPIRITS_CHAIN_COUNT,
    order: Math.floor(index / FOREST_SPIRITS_CHAIN_COUNT),
    phase: seededUnit(index, 1) * Math.PI * 2,
    depth: 0.58 + seededUnit(index, 2) * 0.42,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
  };
}

function bandWeight(chain: number, params: VisualizerParams): number {
  if (chain === 0) return params.bassWeight ?? 1;
  if (chain === 1) return params.midWeight ?? 1;
  return params.trebleWeight ?? 1;
}

function chainBandDrive(
  frame: AudioVizFrame,
  chain: number,
  params: VisualizerParams,
  environment: AudioVisualRenderEnvironment | undefined,
): number {
  const start = chain === 0 ? 0 : chain === 1 ? 11 : 22;
  const end = chain === 0 ? 11 : chain === 1 ? 22 : 32;
  let sum = 0;
  for (let index = start; index < end; index += 1) sum += clamp01(frame.bands[index] ?? 0);
  const spectral = sum / Math.max(1, end - start);
  const captureEnvelope = environment?.amplitudeMode === 'capture'
    ? 0.2 + Math.pow(clamp01(frame.energy * 4), 0.62) * 0.8
    : 1;
  // CHANGED: Studio preview gets a gentle deterministic tide while capture stays voice-driven.
  // WHY: Forest Spirits should demonstrate motion without implying that the preview is listening.
  const previewTide = environment?.amplitudeMode === 'preview' && !environment.reduceMotion
    ? 0.055 + Math.sin(frame.timeMs / 1000 * 0.7 + chain * 2.1) * 0.035
    : 0;
  const sensitivity = 0.52 + clamp01(params.sensitivity) * 1.18;
  return clamp01(
    (frame.energy * 0.5 + spectral * captureEnvelope * 0.76 + previewTide)
      * sensitivity
      * bandWeight(chain, params),
  );
}

class ForestSpiritsVisual implements AudioVisual {
  readonly id = FOREST_SPIRITS_ID;
  readonly kind = 'overlay' as const;
  readonly supportedLayouts = Object.freeze(['linear', 'radial', 'centered'] as const);

  private readonly simulation = new AudioReactiveSimulation<ForestSpiritAgent>({
    capacity: FOREST_SPIRITS_MAX_AGENTS,
    cellSize: DEFAULT_SPATIAL_PARTITION_CELL_SIZE,
    createAgent: createForestSpiritAgent,
  });
  private readonly neighborScratch: ForestSpiritAgent[] = [];
  private readonly flowVectors: FlowFieldVector[] = Array.from(
    { length: FOREST_SPIRITS_CHAIN_COUNT },
    () => ({ x: 0, y: 0 }),
  );
  private readonly chainDrives = new Float32Array(FOREST_SPIRITS_CHAIN_COUNT);

  private canvasWidth = 0;
  private canvasHeight = 0;
  private pendingDt = 0;
  private previousDrive = 0;
  private hasDriveSample = false;
  private disruption = 0;
  /** Committed per-chain headings: spirits hold course and only turn on a scheduled beat. */
  private readonly chainHeading = new Float32Array(FOREST_SPIRITS_CHAIN_COUNT);
  private readonly chainTargetHeading = new Float32Array(FOREST_SPIRITS_CHAIN_COUNT);
  private readonly turnTimer = new Float32Array(FOREST_SPIRITS_CHAIN_COUNT);
  private readonly turnSerial = new Int32Array(FOREST_SPIRITS_CHAIN_COUNT);
  private headingsPrimed = false;

  update(_frame: AudioVizFrame, dt: number): void {
    this.pendingDt = clamp(dt, 0, 0.1);
  }

  render(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    frame: AudioVizFrame,
    params: VisualizerParams,
    environment?: AudioVisualRenderEnvironment,
  ): void {
    const activeCount = resolveForestSpiritsAgentCount(params.density);
    this.ensureAgents(canvas, activeCount);

    let totalDrive = 0;
    for (let chain = 0; chain < FOREST_SPIRITS_CHAIN_COUNT; chain += 1) {
      const drive = chainBandDrive(frame, chain, params, environment);
      this.chainDrives[chain] = drive;
      totalDrive += drive;
    }
    const averageDrive = totalDrive / FOREST_SPIRITS_CHAIN_COUNT;
    const reduceMotion = environment?.reduceMotion === true;
    const dt = reduceMotion ? 0 : this.pendingDt;
    const driveRise = averageDrive - this.previousDrive;
    // BUG FIX: Forest Spirits first-frame false transient
    // Fix: Prime the audio baseline before rise detection so initial non-zero preview bands stay formed.
    const hasTransient = this.hasDriveSample && driveRise > 0.115;
    if (!reduceMotion && (frame.transient === true || hasTransient)) {
      this.disruption = 1;
    } else if (dt > 0) {
      const reformSeconds = 0.72 + clamp01(params.smoothing) * 0.58;
      this.disruption *= Math.exp(-dt / reformSeconds);
      if (this.disruption < 0.002) this.disruption = 0;
    }
    this.previousDrive = averageDrive;
    this.hasDriveSample = true;

    if (dt > 0) {
      let remaining = dt;
      while (remaining > 1e-6) {
        const step = Math.min(1 / 60, remaining);
        this.advanceSimulation(
          step,
          Math.max(0, frame.timeMs / 1000 - remaining),
          params,
        );
        remaining -= step;
      }
    }
    this.pendingDt = 0;

    const palette = resolveVisualPalette(params.color);
    ctx.save();
    ctx.globalCompositeOperation = params.highContrast ? 'source-over' : 'lighter';
    this.drawConnections(ctx, reduceMotion ? 0 : frame.timeMs / 1000, params, palette);
    this.drawAgents(ctx, reduceMotion ? 0 : frame.timeMs / 1000, params, palette);
    ctx.restore();
  }

  private ensureAgents(canvas: HTMLCanvasElement, activeCount: number): void {
    const resized = canvas.width !== this.canvasWidth || canvas.height !== this.canvasHeight;
    if (resized) {
      this.canvasWidth = Math.max(24, Number.isFinite(canvas.width) ? canvas.width : 24);
      this.canvasHeight = Math.max(24, Number.isFinite(canvas.height) ? canvas.height : 24);
      this.simulation.setActiveCount(0);
    }
    this.simulation.setActiveCount(activeCount, (agent) => this.resetAgent(agent));
  }

  private resetAgent(agent: ForestSpiritAgent): void {
    const heading = CHAIN_HEADING[agent.chain] ?? 0;
    // CHANGED: initial spacing shortened 25% to match the follow spacing (QA Pass B).
    const spacing = Math.min(this.canvasWidth, this.canvasHeight) * 0.036;
    const baseX = (CHAIN_BASE_X[agent.chain] ?? 0.5) * this.canvasWidth;
    const baseY = (CHAIN_BASE_Y[agent.chain] ?? 0.5) * this.canvasHeight;
    const sideways = Math.sin(agent.phase) * spacing * 0.24;
    agent.x = clamp(
      baseX - Math.cos(heading) * spacing * agent.order - Math.sin(heading) * sideways,
      6,
      this.canvasWidth - 6,
    );
    agent.y = clamp(
      baseY - Math.sin(heading) * spacing * agent.order + Math.cos(heading) * sideways,
      6,
      this.canvasHeight - 6,
    );
    agent.vx = Math.cos(heading) * (agent.order === 0 ? 18 : 8);
    agent.vy = Math.sin(heading) * (agent.order === 0 ? 18 : 8);
  }

  private advanceSimulation(
    dt: number,
    timeSeconds: number,
    params: VisualizerParams,
  ): void {
    this.simulation.rebuildSpatialIndex();
    for (let chain = 0; chain < FOREST_SPIRITS_CHAIN_COUNT; chain += 1) {
      const leader = this.simulation.pool.at(chain);
      if (leader?.active) this.advanceLeader(leader, dt, timeSeconds, params);
    }
    for (let index = FOREST_SPIRITS_CHAIN_COUNT; index < this.simulation.activeCount; index += 1) {
      const agent = this.simulation.pool.at(index);
      const predecessor = this.simulation.pool.at(index - FOREST_SPIRITS_CHAIN_COUNT);
      if (agent?.active && predecessor?.active) {
        this.advanceFollower(agent, predecessor, dt, timeSeconds, params);
      }
    }
  }

  private advanceLeader(
    agent: ForestSpiritAgent,
    dt: number,
    timeSeconds: number,
    params: VisualizerParams,
  ): void {
    const chain = agent.chain;
    if (!this.headingsPrimed) {
      for (let index = 0; index < FOREST_SPIRITS_CHAIN_COUNT; index += 1) {
        this.chainHeading[index] = CHAIN_HEADING[index] ?? 0;
        this.chainTargetHeading[index] = CHAIN_HEADING[index] ?? 0;
      }
      this.headingsPrimed = true;
    }
    const drive = this.chainDrives[chain] ?? 0;

    // CHANGED: leaders hold a committed heading and re-aim only on a seeded turn beat
    //          (≥ ~1 s apart), easing into each new course; flow-field influence is demoted
    //          to a light drift instead of being the steering target.
    // WHY: chasing the continuously-changing flow made spirits "wobble around"; a snake
    //      holds its line and turns deliberately (QA Pass B).
    this.turnTimer[chain] = (this.turnTimer[chain] ?? 0) + dt;
    const interval = Math.max(
      1,
      1.5 + seededUnit((this.turnSerial[chain] ?? 0) * 7 + chain, 53) * 1.6 - drive * 0.4,
    );
    const margin = Math.min(42, Math.min(this.canvasWidth, this.canvasHeight) * 0.1) * 1.8;
    const nearEdge = agent.x < margin
      || agent.x > this.canvasWidth - margin
      || agent.y < margin
      || agent.y > this.canvasHeight - margin;
    if (nearEdge) {
      const toCenter = Math.atan2(
        this.canvasHeight / 2 - agent.y,
        this.canvasWidth / 2 - agent.x,
      );
      this.chainTargetHeading[chain] = toCenter
        + (seededUnit((this.turnSerial[chain] ?? 0) + chain, 61) - 0.5) * 0.6;
    } else if ((this.turnTimer[chain] ?? 0) >= interval) {
      this.turnSerial[chain] = (this.turnSerial[chain] ?? 0) + 1;
      this.turnTimer[chain] = 0;
      const delta = (seededUnit((this.turnSerial[chain] ?? 0) * 13 + chain, 57) - 0.5)
        * 2 * (0.55 + drive * 0.7);
      this.chainTargetHeading[chain] = (this.chainHeading[chain] ?? 0) + delta;
    }
    const headingDelta = wrapAngle(
      (this.chainTargetHeading[chain] ?? 0) - (this.chainHeading[chain] ?? 0),
    );
    this.chainHeading[chain] = (this.chainHeading[chain] ?? 0)
      + headingDelta * Math.min(1, dt * 3.2);

    const normalizedX = agent.x / this.canvasWidth * 2 - 1;
    const normalizedY = agent.y / this.canvasHeight * 2 - 1;
    const flow = sampleLayeredVectorFlowField(
      normalizedX,
      normalizedY,
      timeSeconds,
      {
        complexity: 0.38 + clamp01(params.density) * 0.46,
        speed: 0.24 + (1 - clamp01(params.smoothing)) * 0.62,
        seed: 19 + chain * 23,
      },
      this.flowVectors[chain],
    );
    const wobble = Math.sin(timeSeconds * 0.9 + agent.phase) * 0.06;
    const heading = (this.chainHeading[chain] ?? 0) + wobble;
    const desiredSpeed = 17 + clamp01(params.intensity) * 19 + drive * 29;
    let ax = (Math.cos(heading) * desiredSpeed - agent.vx) * 2.35
      + flow.x * desiredSpeed * 0.3;
    let ay = (Math.sin(heading) * desiredSpeed - agent.vy) * 2.35
      + flow.y * desiredSpeed * 0.3;
    const kick = this.disruption * (28 + drive * 34);
    ax += Math.cos(agent.phase + timeSeconds * 2.2) * kick;
    ay += Math.sin(agent.phase + timeSeconds * 1.8) * kick;
    this.integrateBounded(agent, ax, ay, dt, desiredSpeed * 1.55);
  }

  private advanceFollower(
    agent: ForestSpiritAgent,
    predecessor: ForestSpiritAgent,
    dt: number,
    timeSeconds: number,
    params: VisualizerParams,
  ): void {
    const predecessorSpeed = Math.hypot(predecessor.vx, predecessor.vy);
    const fallbackHeading = CHAIN_HEADING[agent.chain] ?? 0;
    const headingX = predecessorSpeed > 1e-4
      ? predecessor.vx / predecessorSpeed
      : Math.cos(fallbackHeading);
    const headingY = predecessorSpeed > 1e-4
      ? predecessor.vy / predecessorSpeed
      : Math.sin(fallbackHeading);
    const normalX = -headingY;
    const normalY = headingX;
    const minDimension = Math.min(this.canvasWidth, this.canvasHeight);
    // CHANGED: segment length shortened 25% (0.055–0.04 → 0.041–0.03 of minDim) per QA Pass B.
    const spacing = minDimension * (0.041 - clamp01(params.density) * 0.011);
    const drive = this.chainDrives[agent.chain] ?? 0;
    const undulation = Math.sin(timeSeconds * (1.1 + drive) + agent.phase)
      * spacing * (0.08 + drive * 0.18);
    const targetX = predecessor.x - headingX * spacing + normalX * undulation;
    const targetY = predecessor.y - headingY * spacing + normalY * undulation;
    const spring = 20 - clamp01(params.smoothing) * 7;
    let ax = (targetX - agent.x) * spring;
    let ay = (targetY - agent.y) * spring;

    const separationRadius = spacing * 0.9;
    const neighbors = this.simulation.queryNeighbors(agent, separationRadius, this.neighborScratch);
    for (const neighbor of neighbors) {
      if (neighbor === agent || neighbor === predecessor) continue;
      const dx = agent.x - neighbor.x;
      const dy = agent.y - neighbor.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared < 1e-5) {
        ax += Math.cos(agent.phase) * 24;
        ay += Math.sin(agent.phase) * 24;
        continue;
      }
      const distance = Math.sqrt(distanceSquared);
      const pressure = (1 - distance / separationRadius) * (22 + drive * 20);
      ax += dx / distance * pressure;
      ay += dy / distance * pressure;
    }

    const breakStrength = this.disruption
      * (0.35 + agent.order / (FOREST_SPIRITS_MAX_AGENTS / FOREST_SPIRITS_CHAIN_COUNT))
      * (42 + drive * 28);
    ax += Math.cos(agent.phase + timeSeconds * 2.7) * breakStrength;
    ay += Math.sin(agent.phase * 1.3 - timeSeconds * 2.1) * breakStrength;
    const damping = Math.exp(-dt * (2.8 + clamp01(params.smoothing) * 1.7));
    agent.vx *= damping;
    agent.vy *= damping;
    this.integrateBounded(agent, ax, ay, dt, 62 + drive * 30);
  }

  private integrateBounded(
    agent: ForestSpiritAgent,
    inputAx: number,
    inputAy: number,
    dt: number,
    maxSpeed: number,
  ): void {
    const margin = Math.min(42, Math.min(this.canvasWidth, this.canvasHeight) * 0.1);
    let ax = inputAx;
    let ay = inputAy;
    if (agent.x < margin) ax += (margin - agent.x) * 8;
    if (agent.x > this.canvasWidth - margin) ax -= (agent.x - (this.canvasWidth - margin)) * 8;
    if (agent.y < margin) ay += (margin - agent.y) * 8;
    if (agent.y > this.canvasHeight - margin) ay -= (agent.y - (this.canvasHeight - margin)) * 8;

    agent.vx += ax * dt;
    agent.vy += ay * dt;
    const speed = Math.hypot(agent.vx, agent.vy);
    if (speed > maxSpeed && speed > 0) {
      agent.vx = agent.vx / speed * maxSpeed;
      agent.vy = agent.vy / speed * maxSpeed;
    }
    agent.x += agent.vx * dt;
    agent.y += agent.vy * dt;

    if (agent.x < 3 || agent.x > this.canvasWidth - 3) {
      agent.x = clamp(agent.x, 3, this.canvasWidth - 3);
      agent.vx *= -0.42;
    }
    if (agent.y < 3 || agent.y > this.canvasHeight - 3) {
      agent.y = clamp(agent.y, 3, this.canvasHeight - 3);
      agent.vy *= -0.42;
    }
  }

  private drawConnections(
    ctx: CanvasRenderingContext2D,
    timeSeconds: number,
    params: VisualizerParams,
    palette: readonly string[],
  ): void {
    const highContrast = params.highContrast === true;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let index = FOREST_SPIRITS_CHAIN_COUNT; index < this.simulation.activeCount; index += 1) {
      const agent = this.simulation.pool.at(index);
      const predecessor = this.simulation.pool.at(index - FOREST_SPIRITS_CHAIN_COUNT);
      if (!agent?.active || !predecessor?.active) continue;
      const fracture = this.disruption
        * (0.5 + 0.5 * Math.sin(agent.phase * 2.7 + agent.order * 1.9));
      if (!highContrast && fracture > 0.63) continue;

      const drive = this.chainDrives[agent.chain] ?? 0;
      const color = palette[agent.chain % palette.length] ?? '#7ad151';
      const hot = mixVisualColors(color, '#ffffff', 0.36 + drive * 0.28);
      const dx = agent.x - predecessor.x;
      const dy = agent.y - predecessor.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const curve = Math.sin(agent.phase + timeSeconds * 1.15) * Math.min(7, distance * 0.18);
      const controlX = (agent.x + predecessor.x) / 2 - dy / distance * curve;
      const controlY = (agent.y + predecessor.y) / 2 + dx / distance * curve;

      if (!highContrast) {
        ctx.beginPath();
        ctx.moveTo(predecessor.x, predecessor.y);
        ctx.quadraticCurveTo(controlX, controlY, agent.x, agent.y);
        ctx.strokeStyle = colorWithAlpha(color, 0.1 + drive * 0.12);
        ctx.lineWidth = 4.2 + drive * 2.4;
        ctx.shadowColor = color;
        ctx.shadowBlur = 6 + drive * 7;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.moveTo(predecessor.x, predecessor.y);
      ctx.quadraticCurveTo(controlX, controlY, agent.x, agent.y);
      ctx.strokeStyle = colorWithAlpha(hot, highContrast ? 0.92 : 0.38 + drive * 0.32);
      ctx.lineWidth = highContrast ? 2.35 : 1.05 + drive * 0.62;
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
      ctx.stroke();
    }
  }

  private drawAgents(
    ctx: CanvasRenderingContext2D,
    timeSeconds: number,
    params: VisualizerParams,
    palette: readonly string[],
  ): void {
    const highContrast = params.highContrast === true;
    const intensity = 0.62 + clamp01(params.intensity) * 0.8;
    const minDimension = Math.min(this.canvasWidth, this.canvasHeight);

    for (let index = this.simulation.activeCount - 1; index >= 0; index -= 1) {
      const agent = this.simulation.pool.at(index);
      if (!agent?.active) continue;
      const drive = this.chainDrives[agent.chain] ?? 0;
      const leader = agent.order === 0;
      const color = palette[agent.chain % palette.length] ?? '#7ad151';
      const hot = mixVisualColors(color, '#ffffff', highContrast ? 0.72 : 0.42 + drive * 0.28);
      // CHANGED: node dots grew ~5× so their diameter roughly matches the chain spacing
      //          (circles touch); the spacing itself is 25% shorter, so the cap factor
      //          rose to keep the same absolute dot size (QA §3c + Pass B).
      const chainSpacing = minDimension * (0.041 - clamp01(params.density) * 0.011);
      const radius = Math.min(
        chainSpacing * 0.77,
        minDimension
          * (leader ? 0.024 : 0.016 + agent.depth * 0.006)
          * (0.82 + drive * 0.4)
          * intensity,
      );
      // CHANGED: each dot carries a seeded alpha identity instead of one uniform level.
      const identity = 0.62 + seededUnit(agent.index, 87) * 0.38;
      const bodyAlpha = (highContrast ? 0.96 : 0.58 + drive * 0.36) * identity;

      if (highContrast) {
        ctx.fillStyle = colorWithAlpha(hot, bodyAlpha);
        ctx.beginPath();
        ctx.arc(agent.x, agent.y, Math.max(0.9, radius), 0, Math.PI * 2);
        ctx.fill();
      } else {
        // CHANGED: hard-edged discs become dandelion puffs — a soft-falloff gradient core
        //          plus a high-frequency sine fringe halo (QA Pass B).
        const core = ctx.createRadialGradient(agent.x, agent.y, 0, agent.x, agent.y, Math.max(0.9, radius));
        core.addColorStop(0, colorWithAlpha(hot, bodyAlpha));
        core.addColorStop(0.55, colorWithAlpha(hot, bodyAlpha * 0.82));
        core.addColorStop(1, colorWithAlpha(color, 0));
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(agent.x, agent.y, Math.max(0.9, radius), 0, Math.PI * 2);
        ctx.fill();

        const fringeSegments = 18;
        ctx.beginPath();
        for (let step = 0; step <= fringeSegments; step += 1) {
          const angle = step / fringeSegments * Math.PI * 2;
          const fringe = radius * (1.06
            + 0.09 * Math.sin(angle * 13 + agent.phase * 3)
            + 0.05 * Math.sin(angle * 21 - agent.phase * 5));
          const px = agent.x + Math.cos(angle) * fringe;
          const py = agent.y + Math.sin(angle) * fringe;
          if (step === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = colorWithAlpha(color, bodyAlpha * 0.28);
        ctx.fill();
      }

      if (leader) this.drawLeaderCrown(ctx, agent, radius, hot, highContrast, timeSeconds);
    }

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
  }

  private drawLeaderCrown(
    ctx: CanvasRenderingContext2D,
    agent: ForestSpiritAgent,
    radius: number,
    color: string,
    highContrast: boolean,
    timeSeconds: number,
  ): void {
    const speed = Math.hypot(agent.vx, agent.vy);
    const headingX = speed > 1e-4 ? agent.vx / speed : Math.cos(CHAIN_HEADING[agent.chain] ?? 0);
    const headingY = speed > 1e-4 ? agent.vy / speed : Math.sin(CHAIN_HEADING[agent.chain] ?? 0);
    const normalX = -headingY;
    const normalY = headingX;
    // CHANGED: the head's two swept arcs shrink (reach 2.4 → 1.7 radii), sway on
    //          independent phases, and fade to nothing at the tips (Pass C §3c).
    // WHY: QA read them as plain "ears/horns"; smaller wiggling wisps with an alpha
    //      ramp read as feelers on the spirit instead of fixed horns.
    const reach = Math.max(3, radius * 1.7);
    const baseAlpha = highContrast ? 0.92 : 0.58;
    ctx.lineWidth = highContrast ? 1.8 : 1.15;
    for (const side of [-1, 1] as const) {
      const sway = Math.sin(timeSeconds * 2.3 + agent.phase * 1.9 + side * 1.1) * 0.28;
      const bend = side * (1 + sway);
      const baseX = agent.x + side * normalX * radius * 0.4;
      const baseY = agent.y + side * normalY * radius * 0.4;
      const tipX = agent.x - headingX * reach * (0.72 + sway * side * 0.18)
        + normalX * bend * reach * 0.42;
      const tipY = agent.y - headingY * reach * (0.72 + sway * side * 0.18)
        + normalY * bend * reach * 0.42;
      if (highContrast) {
        ctx.strokeStyle = colorWithAlpha(color, baseAlpha);
      } else {
        const ramp = ctx.createLinearGradient(baseX, baseY, tipX, tipY);
        ramp.addColorStop(0, colorWithAlpha(color, baseAlpha));
        ramp.addColorStop(0.6, colorWithAlpha(color, baseAlpha * 0.55));
        ramp.addColorStop(1, colorWithAlpha(color, 0));
        ctx.strokeStyle = ramp;
      }
      ctx.beginPath();
      ctx.moveTo(baseX, baseY);
      ctx.quadraticCurveTo(
        agent.x - headingX * reach * 0.35 + normalX * bend * reach,
        agent.y - headingY * reach * 0.35 + normalY * bend * reach,
        tipX,
        tipY,
      );
      ctx.stroke();
    }
  }
}

export const FOREST_SPIRITS_VISUAL_DEFINITION: AudioVisualDefinition = Object.freeze({
  id: FOREST_SPIRITS_ID,
  label: 'Forest Spirits',
  kind: 'overlay',
  wants: Object.freeze({ bands: true }),
  family: 'chaining-boids',
  maxElements: FOREST_SPIRITS_MAX_ELEMENTS,
  defaultParams: Object.freeze({
    sensitivity: 0.68,
    intensity: 0.62,
    smoothing: 0.7,
    color: Object.freeze(['#2a788e', '#22a884', '#7ad151', '#fde725']),
    density: 0.55,
    highContrast: false,
  }),
  create: () => new ForestSpiritsVisual(),
});
