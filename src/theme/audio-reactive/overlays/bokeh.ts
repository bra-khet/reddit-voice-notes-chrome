import type {
  AudioVisual,
  AudioVisualDefinition,
  AudioVisualRenderEnvironment,
  AudioVizFrame,
  VisualizerParams,
} from '@/src/theme/audio-reactive';
import { BUBBLES_OVERLAY_LABEL } from '../catalog';
import { normalizeHexColor } from '@/src/theme/color-utils';
import { colorWithAlpha, mixVisualColors, resolveVisualPalette } from '../palette';

// CHANGED: more, smaller bubbles (5–14 → 7–20) per QA §3b.
export const BOKEH_MIN_ORBS = 7;
export const BOKEH_MAX_ORBS = 20;

interface BokehSeed {
  x: number;
  y: number;
  depth: number;
  radius: number;
  phase: number;
  bandIndex: number;
}

const BOKEH_SEEDS: readonly BokehSeed[] = [
  { x: 0.08, y: 0.18, depth: 0.28, radius: 0.11, phase: 0.2, bandIndex: 2 },
  { x: 0.23, y: 0.67, depth: 0.76, radius: 0.16, phase: 2.1, bandIndex: 8 },
  { x: 0.38, y: 0.28, depth: 0.52, radius: 0.09, phase: 4.4, bandIndex: 13 },
  { x: 0.51, y: 0.82, depth: 0.34, radius: 0.13, phase: 1.2, bandIndex: 18 },
  { x: 0.64, y: 0.17, depth: 0.88, radius: 0.18, phase: 3.6, bandIndex: 24 },
  { x: 0.82, y: 0.55, depth: 0.6, radius: 0.12, phase: 5.1, bandIndex: 29 },
  { x: 0.94, y: 0.24, depth: 0.4, radius: 0.08, phase: 2.8, bandIndex: 5 },
  { x: 0.1, y: 0.9, depth: 0.92, radius: 0.09, phase: 4.9, bandIndex: 11 },
  { x: 0.31, y: 0.08, depth: 0.66, radius: 0.07, phase: 0.8, bandIndex: 16 },
  { x: 0.47, y: 0.49, depth: 0.24, radius: 0.1, phase: 3.1, bandIndex: 21 },
  { x: 0.7, y: 0.72, depth: 0.48, radius: 0.15, phase: 1.9, bandIndex: 27 },
  { x: 0.89, y: 0.86, depth: 0.8, radius: 0.1, phase: 5.7, bandIndex: 31 },
  { x: 0.58, y: 0.04, depth: 0.58, radius: 0.06, phase: 2.5, bandIndex: 15 },
  { x: 0.18, y: 0.42, depth: 0.44, radius: 0.08, phase: 3.9, bandIndex: 7 },
  { x: 0.42, y: 0.65, depth: 0.7, radius: 0.07, phase: 1.5, bandIndex: 3 },
  { x: 0.76, y: 0.36, depth: 0.32, radius: 0.06, phase: 4.1, bandIndex: 19 },
  { x: 0.05, y: 0.52, depth: 0.56, radius: 0.08, phase: 5.4, bandIndex: 25 },
  { x: 0.6, y: 0.55, depth: 0.84, radius: 0.05, phase: 0.5, bandIndex: 9 },
  { x: 0.27, y: 0.33, depth: 0.38, radius: 0.06, phase: 3.3, bandIndex: 22 },
  { x: 0.86, y: 0.1, depth: 0.64, radius: 0.07, phase: 2.3, bandIndex: 14 },
];

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function getBokehOrbCount(density: number): number {
  return Math.min(
    BOKEH_MAX_ORBS,
    Math.max(
      BOKEH_MIN_ORBS,
      Math.round(BOKEH_MIN_ORBS + clamp01(density) * (BOKEH_MAX_ORBS - BOKEH_MIN_ORBS)),
    ),
  );
}

/** Dark photographic field used when Bubbles is the theme background, not only an overlay. */
export function drawBokehBackdrop(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  baseColor = '#050814',
): void {
  const base = normalizeHexColor(baseColor) ?? '#050814';
  const top = mixVisualColors(base, '#101b35', 0.36);
  const bottom = mixVisualColors(base, '#010208', 0.7);
  const field = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  field.addColorStop(0, top);
  field.addColorStop(0.52, base);
  field.addColorStop(1, bottom);
  ctx.fillStyle = field;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const vignette = ctx.createRadialGradient(
    canvas.width * 0.5,
    canvas.height * 0.44,
    Math.min(canvas.width, canvas.height) * 0.12,
    canvas.width * 0.5,
    canvas.height * 0.5,
    Math.max(canvas.width, canvas.height) * 0.7,
  );
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.56)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

class BokehVisual implements AudioVisual {
  readonly id = 'bokeh';
  readonly kind = 'overlay' as const;
  readonly supportedLayouts = ['linear', 'radial', 'centered'] as const;

  private initialized = false;
  private smoothedEnergy = 0;
  private readonly smoothedBands = new Float32Array(32);

  update(frame: AudioVizFrame, dt: number): void {
    if (!this.initialized) {
      this.smoothedEnergy = frame.energy;
      this.smoothedBands.set(frame.bands);
      this.initialized = true;
      return;
    }

    // CHANGED: audio smoothing sped up (4.5 → 7.5) so bubbles pulse with speech (§3b).
    const blend = 1 - Math.exp(-Math.max(0, dt) * 7.5);
    this.smoothedEnergy += (frame.energy - this.smoothedEnergy) * blend;
    for (let index = 0; index < this.smoothedBands.length; index += 1) {
      this.smoothedBands[index] += ((frame.bands[index] ?? 0) - this.smoothedBands[index]) * blend;
    }
  }

  render(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    frame: AudioVizFrame,
    params: VisualizerParams,
    environment?: AudioVisualRenderEnvironment,
  ): void {
    const palette = resolveVisualPalette(params.color);
    const count = getBokehOrbCount(params.density);
    const seconds = frame.timeMs / 1000;
    const scale = Math.min(canvas.width, canvas.height);
    const sensitivity = 0.25 + params.sensitivity * 1.15;
    const intensity = 0.3 + params.intensity * 0.76;
    // CHANGED: faster drift (more bob) per QA §3b.
    const driftSpeed = 0.14 + (1 - params.smoothing) * 0.24;

    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    for (let index = 0; index < count; index += 1) {
      const seed = BOKEH_SEEDS[index]!;
      const band = this.smoothedBands[seed.bandIndex] ?? 0;
      const audio = clamp01((band * 0.58 + this.smoothedEnergy * 0.62) * sensitivity);
      const parallax = 0.011 + seed.depth * 0.028;
      const x = (seed.x + Math.sin(seconds * driftSpeed + seed.phase) * parallax) * canvas.width;
      const y = (seed.y + Math.cos(seconds * driftSpeed * 0.74 + seed.phase) * parallax) * canvas.height;
      // CHANGED: faster, deeper breathing and a stronger audio pulse share (§3b).
      const breathe = 0.9 + 0.1 * Math.sin(seconds * 1.5 + seed.phase);
      const radius = seed.radius * scale * breathe * (0.76 + audio * 0.46);
      const depthAlpha = 0.16 + seed.depth * 0.27;
      // CHANGED: over an image backdrop the lens alpha lifts 30–50%, fluttering per orb
      //          on its own slow phase (Pass C §3b).
      // WHY: photographic backgrounds swallow the translucent field; the base boost
      //      covers the contrast need and the flutter keeps the lift feeling alive.
      const backdropBoost = environment?.imageBackdrop
        ? 1.4 + 0.1 * Math.sin(seconds * 0.7 + seed.phase * 2.3)
        : 1;
      const alpha = clamp01(depthAlpha * intensity * (0.7 + audio * 0.72) * backdropBoost);
      const color = palette[index % palette.length]!;
      const rim = mixVisualColors(color, '#ffffff', params.highContrast ? 0.68 : 0.38);

      const lens = ctx.createRadialGradient(
        x - radius * 0.16,
        y - radius * 0.18,
        radius * 0.04,
        x,
        y,
        radius,
      );
      lens.addColorStop(0, colorWithAlpha(rim, alpha * 0.72));
      lens.addColorStop(0.18, colorWithAlpha(color, alpha * 0.52));
      lens.addColorStop(0.62, colorWithAlpha(color, alpha * 0.24));
      lens.addColorStop(0.84, colorWithAlpha(rim, alpha * 0.3));
      lens.addColorStop(1, colorWithAlpha(color, 0));
      ctx.fillStyle = lens;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();

      if (index % 2 === 0) {
        ctx.strokeStyle = colorWithAlpha(rim, alpha * (params.highContrast ? 0.42 : 0.2));
        ctx.lineWidth = Math.max(0.8, radius * (params.highContrast ? 0.022 : 0.012));
        ctx.stroke();
      }

      const highlightRadius = Math.max(1, radius * (0.025 + seed.depth * 0.018));
      ctx.fillStyle = colorWithAlpha('#ffffff', alpha * 0.54);
      ctx.beginPath();
      ctx.arc(x - radius * 0.23, y - radius * 0.25, highlightRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}

export const BOKEH_VISUAL_DEFINITION: AudioVisualDefinition = {
  id: 'bokeh',
  // CHANGED: Bubbles is the public name; `bokeh` remains the serialized stability key.
  // WHY: the orb field reads as bubbles, while existing styles must continue to resolve.
  label: BUBBLES_OVERLAY_LABEL,
  kind: 'overlay',
  wants: Object.freeze({ bands: true }),
  family: 'soft-orb-depth',
  maxElements: BOKEH_MAX_ORBS,
  defaultParams: {
    sensitivity: 0.54,
    intensity: 0.68,
    smoothing: 0.76,
    color: ['#67e8f9', '#818cf8', '#c084fc'],
    density: 0.52,
  },
  create: () => new BokehVisual(),
};
