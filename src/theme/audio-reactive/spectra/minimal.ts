import type {
  AudioVisual,
  AudioVisualDefinition,
  AudioVisualRenderEnvironment,
  SpectrumRenderEnvironment,
} from '..';
import type { AudioVizFrame } from '../audio-frame';
import type { VisualizerParams } from '../params';

export const MINIMAL_SPECTRUM_ID = 'minimal' as const;
export const MINIMAL_MIN_BAR_COUNT = 8;
export const MINIMAL_MAX_BAR_COUNT = 16;
export const MINIMAL_MIN_BAR_HEIGHT = 3;

/** A calm, recognizable silhouette when the operating system requests less motion. */
export const MINIMAL_REDUCED_MOTION_SHAPE: readonly number[] = Object.freeze([
  0.58, 0.68, 0.8, 0.9, 0.76, 0.64, 0.72, 0.86,
  0.86, 0.72, 0.64, 0.76, 0.9, 0.8, 0.68, 0.58,
]);

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

export function resolveMinimalBarCount(density: number): number {
  return Math.round(
    MINIMAL_MIN_BAR_COUNT
      + clamp01(density) * (MINIMAL_MAX_BAR_COUNT - MINIMAL_MIN_BAR_COUNT),
  );
}

function opaqueHex(color: string): string | null {
  const match = color.trim().match(/^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i);
  return match ? `#${match[1]?.toLowerCase()}` : null;
}

function relativeLuminance(color: string): number | null {
  const normalized = opaqueHex(color);
  if (!normalized) return null;
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(normalized.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (channels[0] ?? 0)
    + 0.7152 * (channels[1] ?? 0)
    + 0.0722 * (channels[2] ?? 0);
}

function contrastRatio(left: string, right: string): number | null {
  const leftLuminance = relativeLuminance(left);
  const rightLuminance = relativeLuminance(right);
  if (leftLuminance === null || rightLuminance === null) return null;
  const lighter = Math.max(leftLuminance, rightLuminance);
  const darker = Math.min(leftLuminance, rightLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Pick a solid tip color that remains distinguishable from the spectrum body. */
export function resolveMinimalContrastColor(primary: string, candidate: string): string {
  const solidCandidate = opaqueHex(candidate);
  if (solidCandidate && (contrastRatio(primary, solidCandidate) ?? 0) >= 3) {
    return solidCandidate;
  }

  const blackRatio = contrastRatio(primary, '#000000') ?? 0;
  const whiteRatio = contrastRatio(primary, '#ffffff') ?? 0;
  if (blackRatio > 0 || whiteRatio > 0) {
    return blackRatio >= whiteRatio ? '#000000' : '#ffffff';
  }
  return candidate;
}

function bandWeight(index: number, params: VisualizerParams): number {
  if (index < 11) return params.bassWeight ?? 1;
  if (index < 22) return params.midWeight ?? 1;
  return params.trebleWeight ?? 1;
}

function sensitivityScale(params: VisualizerParams): number {
  return 0.6 + clamp01(params.sensitivity) * 0.8;
}

function resolveReactiveTargets(
  frame: AudioVizFrame,
  params: VisualizerParams,
  environment: SpectrumRenderEnvironment,
  barCount: number,
): number[] {
  if (environment.reduceMotion) {
    const energy = Math.pow(
      clamp01(frame.energy * (1.2 + clamp01(params.sensitivity) * 1.6)),
      0.65,
    );
    return Array.from({ length: barCount }, (_, index) => {
      const shapeIndex = Math.round(
        index * (MINIMAL_REDUCED_MOTION_SHAPE.length - 1) / Math.max(1, barCount - 1),
      );
      return energy * (MINIMAL_REDUCED_MOTION_SHAPE[shapeIndex] ?? 0.7);
    });
  }

  let peak = 0;
  if (environment.amplitudeMode === 'capture') {
    for (const band of frame.bands) peak = Math.max(peak, clamp01(band));
  }
  const peakScale = peak > 1 / 255 ? 1 / peak : 1;
  // CHANGED: capture peak normalization is gated by the smoothed whole-frame envelope.
  // WHY: broad Minimal marks should settle near silence instead of magnifying analyser noise.
  const captureEnvelope = environment.amplitudeMode === 'capture'
    ? Math.pow(clamp01(frame.energy * 4), 0.55)
    : 1;
  const gain = sensitivityScale(params);

  // CHANGED: 32 analyser bands collapse into a deliberately low-density signal meter.
  // WHY: Minimal is the accessibility anchor: broad shapes and bounded motion read cleanly.
  return Array.from({ length: barCount }, (_, barIndex) => {
    const start = Math.floor(barIndex * frame.bands.length / barCount);
    const end = Math.max(start + 1, Math.floor((barIndex + 1) * frame.bands.length / barCount));
    let sum = 0;
    let samples = 0;
    for (let bandIndex = start; bandIndex < end; bandIndex += 1) {
      const raw = clamp01(frame.bands[bandIndex] ?? 0);
      const normalized = environment.amplitudeMode === 'capture'
        ? raw * peakScale * captureEnvelope
        : raw;
      sum += normalized * bandWeight(bandIndex, params);
      samples += 1;
    }
    const average = samples > 0 ? sum / samples : 0;
    return Math.pow(clamp01(average * gain), 0.72);
  });
}

function barY(
  alignment: SpectrumRenderEnvironment['alignment'],
  canvasHeight: number,
  height: number,
): number {
  if (alignment === 'top') return 0;
  if (alignment === 'bottom') return canvasHeight - height;
  return (canvasHeight - height) / 2;
}

function railY(
  alignment: SpectrumRenderEnvironment['alignment'],
  canvasHeight: number,
  thickness: number,
): number {
  if (alignment === 'top') return 0;
  if (alignment === 'bottom') return canvasHeight - thickness;
  return (canvasHeight - thickness) / 2;
}

class MinimalVisual implements AudioVisual {
  readonly id = MINIMAL_SPECTRUM_ID;
  readonly kind = 'spectrum' as const;
  readonly wants = Object.freeze({ bands: true });
  readonly supportedLayouts = Object.freeze(['linear'] as const);

  private displayedLevels: number[] = [];
  private elapsedSeconds = 0;

  update(_frame: AudioVizFrame, dt: number): void {
    this.elapsedSeconds = dt;
  }

  render(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    frame: AudioVizFrame,
    params: VisualizerParams,
    renderEnvironment?: AudioVisualRenderEnvironment,
  ): void {
    const environment = renderEnvironment?.spectrum;
    if (!environment) return;

    const barCount = resolveMinimalBarCount(params.density);
    const targets = resolveReactiveTargets(frame, params, environment, barCount);
    if (this.displayedLevels.length !== barCount) {
      this.displayedLevels = [...targets];
    } else {
      const requestedSmoothing = environment.reduceMotion
        ? Math.max(0.82, clamp01(params.smoothing))
        : clamp01(params.smoothing);
      const follow = requestedSmoothing <= 0
        ? 1
        : this.elapsedSeconds > 0
          ? 1 - Math.exp(-this.elapsedSeconds / (0.04 + requestedSmoothing * 0.56))
          : 0;
      for (let index = 0; index < barCount; index += 1) {
        const current = this.displayedLevels[index] ?? 0;
        this.displayedLevels[index] = current + ((targets[index] ?? 0) - current) * follow;
      }
    }
    this.elapsedSeconds = 0;

    const availableWidth = canvas.width * 0.68;
    const slotWidth = availableWidth / barCount;
    const preferredWidth = Math.max(6, environment.bars.width * 1.45);
    const barWidth = Math.max(2, Math.min(preferredWidth, slotWidth * 0.62));
    const startX = (canvas.width - availableWidth) / 2;
    const firstBarX = startX + (slotWidth - barWidth) / 2;
    const railWidth = availableWidth - slotWidth + barWidth;
    const highContrast = params.highContrast !== false;
    const railThickness = highContrast ? 2 : 1;
    const capThickness = highContrast ? 3 : 1.5;
    const intensityScale = 0.6 + clamp01(params.intensity) * 0.8;
    const maxBarHeight = canvas.height * 0.58;
    const primary = environment.colors.bar;
    const accent = highContrast
      ? resolveMinimalContrastColor(primary, environment.colors.glow)
      : environment.colors.glow;

    // CHANGED: Minimal uses one quiet horizon and solid, broad meter marks with no glow pass.
    // WHY: restrained contrast and low visual entropy improve legibility and encoded-size safety.
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = primary;
    ctx.globalAlpha = highContrast ? 0.46 : 0.22;
    ctx.fillRect(
      firstBarX,
      railY(environment.alignment, canvas.height, railThickness),
      railWidth,
      railThickness,
    );

    const geometry = this.displayedLevels.map((level, index) => {
      const height = Math.min(
        canvas.height,
        Math.max(MINIMAL_MIN_BAR_HEIGHT, clamp01(level) * maxBarHeight * intensityScale),
      );
      return {
        x: startX + index * slotWidth + (slotWidth - barWidth) / 2,
        y: barY(environment.alignment, canvas.height, height),
        height,
      };
    });

    ctx.globalAlpha = highContrast ? 1 : 0.82;
    for (const bar of geometry) ctx.fillRect(bar.x, bar.y, barWidth, bar.height);

    ctx.fillStyle = accent;
    ctx.globalAlpha = highContrast ? 1 : 0.72;
    for (const bar of geometry) {
      const thickness = Math.min(capThickness, bar.height / 2);
      if (environment.alignment === 'top') {
        ctx.fillRect(bar.x, bar.y + bar.height - thickness, barWidth, thickness);
      } else {
        ctx.fillRect(bar.x, bar.y, barWidth, thickness);
        if (environment.alignment === 'center') {
          ctx.fillRect(bar.x, bar.y + bar.height - thickness, barWidth, thickness);
        }
      }
    }

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
  }
}

export const MINIMAL_VISUAL_DEFINITION: AudioVisualDefinition = Object.freeze({
  id: MINIMAL_SPECTRUM_ID,
  label: 'Minimal',
  kind: 'spectrum',
  family: 'accessible-spectrum',
  maxElements: MINIMAL_MAX_BAR_COUNT,
  defaultParams: Object.freeze({
    sensitivity: 0.5,
    intensity: 0.5,
    smoothing: 0.72,
    density: 0.35,
    highContrast: true,
  }),
  create: () => new MinimalVisual(),
});
