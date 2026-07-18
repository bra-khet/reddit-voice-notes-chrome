import type {
  AudioVisual,
  AudioVisualDefinition,
  AudioVizFrame,
  VisualizerParams,
} from '@/src/theme/audio-reactive';
import { colorWithAlpha, mixVisualColors, resolveVisualPalette } from '../palette';

export const SPARKLE_MIN_PARTICLES = 18;
export const SPARKLE_MAX_PARTICLES = 64;

interface SparkleSeed {
  x: number;
  y: number;
  depth: number;
  size: number;
  phase: number;
  speed: number;
  bandIndex: number;
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const random = seededRandom(0x5a17c1e);
const SPARKLE_SEEDS: readonly SparkleSeed[] = Array.from(
  { length: SPARKLE_MAX_PARTICLES },
  (_, index) => ({
    x: 0.035 + random() * 0.93,
    y: 0.035 + random() * 0.93,
    depth: 0.22 + random() * 0.78,
    size: 0.55 + random() * 1.25,
    phase: random() * Math.PI * 2,
    speed: 0.65 + random() * 1.5,
    bandIndex: (index * 11 + Math.floor(random() * 7)) % 32,
  }),
);

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function wrap01(value: number): number {
  return ((value % 1) + 1) % 1;
}

export function getSparkleParticleCount(density: number): number {
  return Math.min(
    SPARKLE_MAX_PARTICLES,
    Math.max(
      SPARKLE_MIN_PARTICLES,
      Math.round(SPARKLE_MIN_PARTICLES + clamp01(density) *
        (SPARKLE_MAX_PARTICLES - SPARKLE_MIN_PARTICLES)),
    ),
  );
}

class SparkleVisual implements AudioVisual {
  readonly id = 'sparkle';
  readonly kind = 'overlay' as const;
  readonly supportedLayouts = ['linear', 'radial', 'centered'] as const;

  private initialized = false;
  private smoothedEnergy = 0;
  private travel = 0;
  private readonly smoothedBands = new Float32Array(32);

  update(frame: AudioVizFrame, dt: number): void {
    if (!this.initialized) {
      this.smoothedEnergy = frame.energy;
      this.smoothedBands.set(frame.bands);
      this.initialized = true;
      return;
    }

    const blend = 1 - Math.exp(-Math.max(0, dt) * 9);
    this.smoothedEnergy += (frame.energy - this.smoothedEnergy) * blend;
    for (let index = 0; index < this.smoothedBands.length; index += 1) {
      this.smoothedBands[index] += ((frame.bands[index] ?? 0) - this.smoothedBands[index]) * blend;
    }
    // BUG FIX: Sparkle motes teleported on loudness changes late in a clip (QA §3a)
    // Fix: rise was computed as current-audio × total elapsed seconds, so a level swing
    //      displaced positions proportionally to clip age. The audio-scaled rise rate is
    //      now integrated over dt into one bounded travel accumulator.
    // (unwrapped: wrap01 at draw time handles overflow; wrapping here would jump depth-scaled motes)
    this.travel += (0.0015 + this.smoothedEnergy * 0.0035) * Math.max(0, dt);
  }

  render(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    frame: AudioVizFrame,
    params: VisualizerParams,
  ): void {
    const palette = resolveVisualPalette(params.color);
    const count = getSparkleParticleCount(params.density);
    const scale = Math.min(canvas.width, canvas.height);
    const seconds = frame.timeMs / 1000;
    const motion = 0.35 + (1 - params.smoothing) * 0.9;
    const sensitivity = 0.35 + params.sensitivity * 1.5;
    const intensity = 0.35 + params.intensity * 0.9;

    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    for (let index = 0; index < count; index += 1) {
      const seed = SPARKLE_SEEDS[index]!;
      const band = this.smoothedBands[seed.bandIndex] ?? 0;
      const audio = clamp01((band * 0.72 + this.smoothedEnergy * 0.45) * sensitivity);
      const wave = 0.5 + 0.5 * Math.sin(seconds * seed.speed * motion * 2.1 + seed.phase);
      const twinkle = Math.pow(wave, 5.5);
      const shimmer = 0.18 + twinkle * 0.72 + audio * 0.46 + (frame.transient ? 0.28 : 0);
      const alpha = clamp01(shimmer * intensity * (0.42 + seed.depth * 0.4));
      if (alpha < 0.055) continue;

      const drift = 0.006 + seed.depth * 0.012;
      const x = wrap01(seed.x + Math.sin(seconds * 0.11 + seed.phase) * drift) * canvas.width;
      const y = wrap01(seed.y - this.travel * seed.depth +
        Math.cos(seconds * 0.09 + seed.phase) * drift) * canvas.height;
      const radius = scale * (0.0023 + seed.size * 0.0034) * (0.72 + audio * 0.62);
      const color = palette[index % palette.length]!;
      const hotColor = mixVisualColors(color, '#ffffff', 0.62 + twinkle * 0.3);

      const halo = ctx.createRadialGradient(x, y, 0, x, y, radius * 2.8);
      halo.addColorStop(0, colorWithAlpha(hotColor, alpha));
      halo.addColorStop(0.2, colorWithAlpha(color, alpha * 0.72));
      halo.addColorStop(0.62, colorWithAlpha(color, alpha * 0.16));
      halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x, y, radius * 2.8, 0, Math.PI * 2);
      ctx.fill();

      if (twinkle + audio < 0.62) continue;
      const ray = radius * (2.1 + twinkle * 3.2);
      ctx.strokeStyle = colorWithAlpha(hotColor, alpha * 0.86);
      ctx.lineWidth = Math.max(0.65, radius * (params.highContrast ? 0.34 : 0.22));
      ctx.beginPath();
      ctx.moveTo(x - ray, y);
      ctx.lineTo(x + ray, y);
      ctx.moveTo(x, y - ray);
      ctx.lineTo(x, y + ray);
      ctx.stroke();
    }

    ctx.restore();
  }
}

export const SPARKLE_VISUAL_DEFINITION: AudioVisualDefinition = {
  id: 'sparkle',
  label: 'Sparkle',
  kind: 'overlay',
  wants: Object.freeze({ bands: true }),
  family: 'twinkle-particle',
  maxElements: SPARKLE_MAX_PARTICLES,
  defaultParams: {
    sensitivity: 0.68,
    intensity: 0.62,
    smoothing: 0.58,
    color: ['#dff8ff', '#8be9fd', '#c4a7ff'],
    density: 0.48,
  },
  create: () => new SparkleVisual(),
};
