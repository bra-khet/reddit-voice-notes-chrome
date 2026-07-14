import type {
  AudioVisual,
  AudioVisualDefinition,
  AudioVisualRenderEnvironment,
  SpectrumRenderEnvironment,
} from '..';
import type { AudioVizFrame } from '../audio-frame';
import type { VisualizerParams } from '../params';

export const CLASSIC_NEON_SPECTRUM_ID = 'classic-neon' as const;
export const CLASSIC_NEON_BAR_COUNT = 32;
export const CLASSIC_NEON_MIN_BAR_HEIGHT = 4;

/** Fixed spectral silhouette for reduced-motion mode — amplitude scales, shape stays calm. */
export const CLASSIC_NEON_REDUCED_MOTION_SHAPE: readonly number[] = Object.freeze([
  0.42, 0.58, 0.71, 0.55, 0.48, 0.62, 0.78, 0.66,
  0.52, 0.44, 0.57, 0.69, 0.74, 0.61, 0.5, 0.46,
  0.53, 0.67, 0.72, 0.59, 0.41, 0.38, 0.49, 0.63,
  0.7, 0.56, 0.45, 0.4, 0.47, 0.6, 0.65, 0.51,
]);

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

/** Preserve the v5 voice-detail lift as Classic's neutral transfer curve. */
export function compressClassicNeonLevel(value: number): number {
  const normalized = clamp01(value);
  if (normalized <= 0) return 0;
  const k = 4;
  return (1 - Math.exp(-k * normalized)) / (1 - Math.exp(-k));
}

function fillRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const resolvedRadius = Math.min(radius, width / 2, height / 2);
  if (resolvedRadius <= 0) {
    ctx.fillRect(x, y, width, height);
    return;
  }

  ctx.beginPath();
  ctx.moveTo(x + resolvedRadius, y);
  ctx.lineTo(x + width - resolvedRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + resolvedRadius);
  ctx.lineTo(x + width, y + height - resolvedRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - resolvedRadius, y + height);
  ctx.lineTo(x + resolvedRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - resolvedRadius);
  ctx.lineTo(x, y + resolvedRadius);
  ctx.quadraticCurveTo(x, y, x + resolvedRadius, y);
  ctx.closePath();
  ctx.fill();
}

function barColor(baseColor: string, normalized: number): string {
  if (baseColor.startsWith('#') && (baseColor.length === 7 || baseColor.length === 4)) {
    const alpha = 0.35 + normalized * 0.65;
    const hex = baseColor.length === 4
      ? `#${baseColor[1]}${baseColor[1]}${baseColor[2]}${baseColor[2]}${baseColor[3]}${baseColor[3]}`
      : baseColor;
    const red = parseInt(hex.slice(1, 3), 16);
    const green = parseInt(hex.slice(3, 5), 16);
    const blue = parseInt(hex.slice(5, 7), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }
  return baseColor;
}

function getBarY(
  environment: SpectrumRenderEnvironment,
  centerY: number,
  barHeight: number,
  canvasHeight: number,
): number {
  if (environment.alignment === 'bottom') return canvasHeight - barHeight;
  if (environment.alignment === 'top') return 0;
  return centerY - barHeight / 2;
}

function neutralControlScale(value: number): number {
  return 0.5 + clamp01(value);
}

function resolveTargetLevels(
  frame: AudioVizFrame,
  params: VisualizerParams,
  environment: SpectrumRenderEnvironment,
): number[] {
  const sensitivity = neutralControlScale(params.sensitivity);
  if (environment.reduceMotion) {
    const uniformLevel = compressClassicNeonLevel(frame.energy);
    return CLASSIC_NEON_REDUCED_MOTION_SHAPE.map((shape) =>
      compressClassicNeonLevel(Math.min(1, uniformLevel * shape * sensitivity)));
  }

  let peak = 0;
  if (environment.amplitudeMode === 'capture') {
    for (const band of frame.bands) peak = Math.max(peak, band);
  }
  const peakScale = peak > 1 / 255 ? 1 / peak : 1;

  return Array.from({ length: CLASSIC_NEON_BAR_COUNT }, (_, index) => {
    const band = clamp01(frame.bands[index] ?? 0);
    const amplitude = environment.amplitudeMode === 'capture' ? band * peakScale : band;
    return compressClassicNeonLevel(Math.min(1, amplitude * sensitivity));
  });
}

class ClassicNeonVisual implements AudioVisual {
  readonly id = CLASSIC_NEON_SPECTRUM_ID;
  readonly kind = 'spectrum' as const;
  readonly wants = Object.freeze({ bands: true });
  readonly supportsAfterimage = true;
  readonly supportedLayouts = Object.freeze(['linear'] as const);

  private readonly displayedLevels = Array<number>(CLASSIC_NEON_BAR_COUNT).fill(0);

  render(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    frame: AudioVizFrame,
    params: VisualizerParams,
    renderEnvironment?: AudioVisualRenderEnvironment,
  ): void {
    const environment = renderEnvironment?.spectrum;
    if (!environment) return;

    const targets = resolveTargetLevels(frame, params, environment);
    // CHANGED: Classic owns optional temporal smoothing, with zero as the parity default.
    // WHY: registry state enables the Style control without altering the v5 no-change path.
    const follow = 1 - clamp01(params.smoothing) * 0.85;
    for (let index = 0; index < CLASSIC_NEON_BAR_COUNT; index += 1) {
      const current = this.displayedLevels[index] ?? 0;
      this.displayedLevels[index] = current + ((targets[index] ?? 0) - current) * follow;
    }

    const densityScale = 0.65 + clamp01(params.density) * 0.7;
    const barWidth = environment.bars.width * densityScale;
    const spacing = environment.bars.spacing * (1.5 - densityScale / 2);
    const totalWidth = CLASSIC_NEON_BAR_COUNT * barWidth
      + (CLASSIC_NEON_BAR_COUNT - 1) * spacing;
    const startX = Math.max(0, (canvas.width - totalWidth) / 2);
    const centerY = canvas.height / 2;
    const maxBarHeight = canvas.height * 0.7;
    const intensityScale = neutralControlScale(params.intensity);

    for (let index = 0; index < CLASSIC_NEON_BAR_COUNT; index += 1) {
      const normalized = clamp01(this.displayedLevels[index] ?? 0);
      const barHeight = Math.max(
        CLASSIC_NEON_MIN_BAR_HEIGHT,
        normalized * maxBarHeight * intensityScale,
      );
      const x = startX + index * (barWidth + spacing);
      const y = getBarY(environment, centerY, barHeight, canvas.height);

      ctx.fillStyle = barColor(environment.colors.bar, normalized);
      ctx.shadowColor = environment.colors.glow;
      ctx.shadowBlur = normalized * environment.bars.glow * intensityScale;
      fillRoundedRect(ctx, x, y, barWidth, barHeight, environment.bars.cornerRadius);
    }

    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
  }
}

/**
 * CHANGED: the historical 32-bar renderer is now the founding spectrum definition.
 * WHY: every no-change theme must traverse the same registry seam as future v6 spectra.
 */
export const CLASSIC_NEON_VISUAL_DEFINITION: AudioVisualDefinition = Object.freeze({
  id: CLASSIC_NEON_SPECTRUM_ID,
  label: 'Classic (Neon Glow)',
  kind: 'spectrum',
  family: 'bar-spectrum',
  maxElements: CLASSIC_NEON_BAR_COUNT,
  defaultParams: Object.freeze({
    sensitivity: 0.5,
    intensity: 0.5,
    smoothing: 0,
    density: 0.5,
  }),
  create: () => new ClassicNeonVisual(),
});
