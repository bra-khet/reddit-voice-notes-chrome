import type {
  AudioVisual,
  AudioVisualDefinition,
  AudioVisualRenderEnvironment,
  SpectrumRenderEnvironment,
} from '..';
import { mapRadialSegment } from '../layout';
import { colorWithAlpha, mixVisualColors, resolveVisualPalette } from '../palette';
import type { AudioVizFrame } from '../audio-frame';
import type { VisualizerParams } from '../params';

export const RADIAL_SPECTRUM_ID = 'radial-spectrum' as const;
export const RADIAL_MIN_SEGMENTS = 24;
export const RADIAL_MAX_SEGMENTS = 64;

/** One calm half-ring contour; the renderer mirrors it across the full circle. */
export const RADIAL_REDUCED_MOTION_SHAPE: readonly number[] = Object.freeze([
  0.38, 0.44, 0.55, 0.69, 0.82, 0.74, 0.61, 0.5,
  0.46, 0.54, 0.67, 0.78, 0.7, 0.58, 0.47, 0.4,
]);

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

/** Density resolves only to even counts so the spectrum always has an exact mirror partner. */
export function resolveRadialSegmentCount(density: number): number {
  const pairCount = Math.round(
    (RADIAL_MIN_SEGMENTS / 2)
      + clamp01(density) * ((RADIAL_MAX_SEGMENTS - RADIAL_MIN_SEGMENTS) / 2),
  );
  return pairCount * 2;
}

/** Fold the second semicircle back over the first to make band symmetry explicit and testable. */
export function resolveRadialBandIndex(segment: number, segmentCount: number): number {
  const count = Math.max(2, Math.floor(segmentCount / 2) * 2);
  const wrapped = ((Math.floor(segment) % count) + count) % count;
  const half = count / 2;
  const mirrored = wrapped < half ? wrapped : count - 1 - wrapped;
  return Math.round(mirrored * 31 / Math.max(1, half - 1));
}

function bandWeight(index: number, params: VisualizerParams): number {
  if (index < 11) return params.bassWeight ?? 1;
  if (index < 22) return params.midWeight ?? 1;
  return params.trebleWeight ?? 1;
}

function resolveTargets(
  frame: AudioVizFrame,
  params: VisualizerParams,
  environment: SpectrumRenderEnvironment,
  segmentCount: number,
): number[] {
  const sensitivity = 0.55 + clamp01(params.sensitivity) * 1.05;
  if (environment.reduceMotion) {
    const energy = Math.pow(clamp01(frame.energy * sensitivity * 2.2), 0.68);
    return Array.from({ length: segmentCount }, (_, segment) => {
      const bandIndex = resolveRadialBandIndex(segment, segmentCount);
      const shapeIndex = Math.round(
        bandIndex * (RADIAL_REDUCED_MOTION_SHAPE.length - 1) / 31,
      );
      return energy * (RADIAL_REDUCED_MOTION_SHAPE[shapeIndex] ?? 0.5);
    });
  }

  let peak = 0;
  if (environment.amplitudeMode === 'capture') {
    for (const band of frame.bands) peak = Math.max(peak, clamp01(band));
  }
  const peakScale = peak > 1 / 255 ? 1 / peak : 1;
  // CHANGED: live normalization retains radial detail but remains gated by whole-frame energy.
  // WHY: a full-circle display makes analyser-floor noise especially conspicuous around silence.
  const captureEnvelope = environment.amplitudeMode === 'capture'
    ? Math.pow(clamp01(frame.energy * 4), 0.6)
    : 1;

  return Array.from({ length: segmentCount }, (_, segment) => {
    const bandIndex = resolveRadialBandIndex(segment, segmentCount);
    const raw = clamp01(frame.bands[bandIndex] ?? 0);
    const amplitude = environment.amplitudeMode === 'capture'
      ? raw * peakScale * captureEnvelope
      : raw;
    return Math.pow(clamp01(amplitude * sensitivity * bandWeight(bandIndex, params)), 0.72);
  });
}

function centerYForAlignment(
  alignment: SpectrumRenderEnvironment['alignment'],
  canvasHeight: number,
): number {
  if (alignment === 'top') return canvasHeight * 0.4;
  if (alignment === 'bottom') return canvasHeight * 0.6;
  return canvasHeight / 2;
}

class RadialSpectrumVisual implements AudioVisual {
  readonly id = RADIAL_SPECTRUM_ID;
  readonly kind = 'spectrum' as const;
  readonly wants = Object.freeze({ bands: true });
  readonly supportsAfterimage = true;
  readonly supportedLayouts = Object.freeze(['radial'] as const);

  private displayedLevels: number[] = [];
  private trailLevels: number[] = [];
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

    const segmentCount = resolveRadialSegmentCount(params.density);
    const targets = resolveTargets(frame, params, environment, segmentCount);
    if (this.displayedLevels.length !== segmentCount) {
      this.displayedLevels = [...targets];
      this.trailLevels = [...targets];
    } else {
      const smoothing = environment.reduceMotion
        ? Math.max(0.82, clamp01(params.smoothing))
        : clamp01(params.smoothing);
      const follow = smoothing <= 0
        ? 1
        : this.elapsedSeconds > 0
          ? 1 - Math.exp(-this.elapsedSeconds / (0.035 + smoothing * 0.38))
          : 0;
      const persistence = clamp01(params.afterimageStrength ?? 0);
      for (let index = 0; index < segmentCount; index += 1) {
        const target = targets[index] ?? 0;
        const displayed = this.displayedLevels[index] ?? 0;
        this.displayedLevels[index] = displayed + (target - displayed) * follow;

        // CHANGED: afterimage is stored as a second radial envelope, not retained canvas pixels.
        // WHY: deterministic state keeps preview/capture behavior equal and avoids an unbounded blur buffer.
        const trail = this.trailLevels[index] ?? 0;
        const trailTime = target >= trail ? 0.04 : 0.12 + persistence * 0.72;
        const trailFollow = this.elapsedSeconds > 0
          ? 1 - Math.exp(-this.elapsedSeconds / trailTime)
          : smoothing <= 0 ? 1 : 0;
        this.trailLevels[index] = trail + (target - trail) * trailFollow;
      }
    }
    this.elapsedSeconds = 0;

    const minDimension = Math.min(canvas.width, canvas.height);
    const centerX = canvas.width / 2;
    const centerY = centerYForAlignment(environment.alignment, canvas.height);
    const innerRadius = minDimension * 0.16;
    const amplitudeSpan = minDimension * (0.2 + clamp01(params.intensity) * 0.13);
    const palette = resolveVisualPalette(params.color);
    const highContrast = params.highContrast === true;
    const reducedMotion = environment.reduceMotion;
    // CHANGED: High Contrast collapses the palette to one bright structural ink.
    // WHY: removing glow is only useful if the remaining rail, spokes, and contour stay easy to parse.
    const contrastColor = mixVisualColors(palette[palette.length - 1] ?? '#ffffff', '#ffffff', 0.35);
    const persistence = reducedMotion || highContrast
      ? 0
      : clamp01(params.afterimageStrength ?? 0);
    const bodyWidth = highContrast ? 4 : 2.25;

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.lineCap = 'round';

    // A stable inner rail keeps the shape legible even while the audio envelope settles.
    ctx.beginPath();
    ctx.arc(centerX, centerY, innerRadius, 0, Math.PI * 2);
    ctx.strokeStyle = colorWithAlpha(
      highContrast ? contrastColor : palette[0] ?? environment.colors.bar,
      highContrast ? 0.9 : 0.3,
    );
    ctx.lineWidth = highContrast ? 2.5 : 1;
    ctx.stroke();

    const outerPoints = [];
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const level = clamp01(this.displayedLevels[segment] ?? 0);
      const trailLevel = clamp01(this.trailLevels[segment] ?? 0);
      const radius = innerRadius + 3 + level * amplitudeSpan;
      const paletteIndex = Math.min(
        palette.length - 1,
        Math.floor(segment * palette.length / segmentCount),
      );
      const baseColor = reducedMotion
        ? palette[0] ?? environment.colors.bar
        : palette[paletteIndex] ?? environment.colors.bar;
      const color = highContrast ? contrastColor : baseColor;
      const inner = mapRadialSegment(segment, segmentCount, centerX, centerY, innerRadius);
      const outer = mapRadialSegment(segment, segmentCount, centerX, centerY, radius);
      outerPoints.push(outer);

      if (persistence > 0 && trailLevel > level + 0.01) {
        const trail = mapRadialSegment(
          segment,
          segmentCount,
          centerX,
          centerY,
          innerRadius + 3 + trailLevel * amplitudeSpan,
        );
        ctx.beginPath();
        ctx.moveTo(outer.x, outer.y);
        ctx.lineTo(trail.x, trail.y);
        ctx.strokeStyle = colorWithAlpha(color, 0.12 + persistence * 0.28);
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      if (!highContrast && !reducedMotion) {
        ctx.beginPath();
        ctx.moveTo(inner.x, inner.y);
        ctx.lineTo(outer.x, outer.y);
        ctx.strokeStyle = colorWithAlpha(color, 0.34 + level * 0.3);
        ctx.lineWidth = bodyWidth + 2.5;
        ctx.shadowColor = color;
        ctx.shadowBlur = Math.min(18, environment.bars.glow * (0.25 + level * 0.55));
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.moveTo(inner.x, inner.y);
      ctx.lineTo(outer.x, outer.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = bodyWidth;
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
      ctx.globalAlpha = highContrast ? 1 : 0.68 + level * 0.32;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(outer.x, outer.y, highContrast ? 2.4 : 1.4 + level * 1.1, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }

    // One bounded outline binds the spokes into a readable circular spectrum instead of a sunburst.
    if (outerPoints.length > 1) {
      ctx.beginPath();
      ctx.moveTo(outerPoints[0]?.x ?? centerX, outerPoints[0]?.y ?? centerY);
      for (let index = 1; index < outerPoints.length; index += 1) {
        const point = outerPoints[index];
        if (point) ctx.lineTo(point.x, point.y);
      }
      ctx.closePath();
      ctx.strokeStyle = colorWithAlpha(
        highContrast ? contrastColor : palette[0] ?? environment.colors.bar,
        highContrast ? 0.88 : 0.38,
      );
      ctx.lineWidth = highContrast ? 2 : 1;
      ctx.globalAlpha = 1;
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.lineCap = 'butt';
  }
}

export const RADIAL_SPECTRUM_VISUAL_DEFINITION: AudioVisualDefinition = Object.freeze({
  id: RADIAL_SPECTRUM_ID,
  label: 'Radial Spectrum',
  kind: 'spectrum',
  family: 'polar-spectrum',
  maxElements: RADIAL_MAX_SEGMENTS,
  defaultParams: Object.freeze({
    sensitivity: 0.55,
    intensity: 0.62,
    smoothing: 0.56,
    color: Object.freeze(['#414487', '#2a788e', '#22a884', '#fde725']),
    density: 0.55,
    layoutMode: 'radial',
    highContrast: false,
    afterimageStrength: 0.34,
  }),
  create: () => new RadialSpectrumVisual(),
});
