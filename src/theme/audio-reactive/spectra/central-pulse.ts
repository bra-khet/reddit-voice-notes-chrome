import type {
  AudioVisual,
  AudioVisualDefinition,
  AudioVisualRenderEnvironment,
  SpectrumRenderEnvironment,
} from '..';
import { mapCenteredContourPoint, resolveCenteredOrigin } from '../layout';
import { colorWithAlpha, mixVisualColors, resolveVisualPalette } from '../palette';
import { sampleLayeredFlowField } from '../simulation/flow-field';
import type { AudioVizFrame } from '../audio-frame';
import type { VisualizerParams } from '../params';

export const CENTRAL_PULSE_ID = 'central-pulse' as const;
export const CENTRAL_PULSE_MIN_POINTS = 36;
export const CENTRAL_PULSE_MAX_POINTS = 72;
export const CENTRAL_PULSE_MAX_ECHO_RINGS = 3;
export const CENTRAL_PULSE_MAX_ELEMENTS = CENTRAL_PULSE_MAX_POINTS
  * (1 + CENTRAL_PULSE_MAX_ECHO_RINGS);

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

/** Even point counts keep the continuous contour balanced at every density. */
export function resolveCentralPulsePointCount(density: number): number {
  const pairCount = Math.round(
    CENTRAL_PULSE_MIN_POINTS / 2
      + clamp01(density) * ((CENTRAL_PULSE_MAX_POINTS - CENTRAL_PULSE_MIN_POINTS) / 2),
  );
  return pairCount * 2;
}

/** Echo strength reveals at most three stateful contour histories. */
export function resolveCentralPulseEchoCount(afterimageStrength: number): number {
  const strength = clamp01(afterimageStrength);
  return strength <= 0.04
    ? 0
    : Math.min(CENTRAL_PULSE_MAX_ECHO_RINGS, Math.ceil(strength * CENTRAL_PULSE_MAX_ECHO_RINGS));
}

function bandWeight(index: number, params: VisualizerParams): number {
  if (index < 11) return params.bassWeight ?? 1;
  if (index < 22) return params.midWeight ?? 1;
  return params.trebleWeight ?? 1;
}

function resolveTargetEnergy(
  frame: AudioVizFrame,
  params: VisualizerParams,
  environment: SpectrumRenderEnvironment,
): number {
  const sensitivity = 0.62 + clamp01(params.sensitivity) * 0.98;
  if (environment.reduceMotion) {
    return Math.pow(clamp01(frame.energy * sensitivity * 2), 0.68);
  }

  let spectralSum = 0;
  for (let index = 0; index < frame.bands.length; index += 1) {
    spectralSum += Math.pow(clamp01(frame.bands[index] ?? 0), 0.78) * bandWeight(index, params);
  }
  const spectralEnergy = spectralSum / Math.max(1, frame.bands.length);
  // CHANGED: live spectral detail is multiplied by the honest whole-frame envelope.
  // WHY: the central orb should breathe with speech but settle instead of magnifying analyser-floor noise.
  const captureEnvelope = environment.amplitudeMode === 'capture'
    ? Math.pow(clamp01(frame.energy * 4), 0.6)
    : 1;
  const combined = frame.energy * 0.62
    + spectralEnergy * captureEnvelope * 0.86
    + (frame.transient ? 0.08 : 0);
  return Math.pow(clamp01(combined * sensitivity), 0.7);
}

function alignmentBias(alignment: SpectrumRenderEnvironment['alignment']): number {
  if (alignment === 'top') return -0.2;
  if (alignment === 'bottom') return 0.2;
  return 0;
}

interface ContourGeometry {
  centerX: number;
  centerY: number;
  pointCount: number;
  radius: number;
  displacement: number;
  timeSeconds: number;
  complexity: number;
  speed: number;
  seed: number;
}

function traceContour(ctx: CanvasRenderingContext2D, geometry: ContourGeometry): void {
  ctx.beginPath();
  for (let index = 0; index < geometry.pointCount; index += 1) {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / geometry.pointCount;
    const field = sampleLayeredFlowField(
      Math.cos(angle),
      Math.sin(angle),
      geometry.timeSeconds,
      {
        complexity: geometry.complexity,
        speed: geometry.speed,
        seed: geometry.seed,
      },
    );
    const point = mapCenteredContourPoint(
      index,
      geometry.pointCount,
      geometry.centerX,
      geometry.centerY,
      geometry.radius,
      field * geometry.displacement,
    );
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  }
  ctx.closePath();
}

class CentralPulseVisual implements AudioVisual {
  readonly id = CENTRAL_PULSE_ID;
  readonly kind = 'spectrum' as const;
  readonly supportsAfterimage = true;
  readonly supportedLayouts = Object.freeze(['centered'] as const);

  private displayedEnergy = 0;
  private readonly echoEnergies = Array<number>(CENTRAL_PULSE_MAX_ECHO_RINGS).fill(0);
  private elapsedSeconds = 0;
  private initialized = false;

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

    const targetEnergy = resolveTargetEnergy(frame, params, environment);
    const afterimageStrength = clamp01(params.afterimageStrength ?? 0);
    if (!this.initialized) {
      this.displayedEnergy = targetEnergy;
      this.echoEnergies.fill(targetEnergy);
      this.initialized = true;
    } else {
      const responseTime = environment.reduceMotion
        ? 0.38
        : targetEnergy >= this.displayedEnergy ? 0.07 : 0.24;
      const follow = this.elapsedSeconds > 0
        ? 1 - Math.exp(-this.elapsedSeconds / responseTime)
        : 0;
      this.displayedEnergy += (targetEnergy - this.displayedEnergy) * follow;

      // CHANGED: echo rings form a fixed three-stage envelope chain rather than retained pixels.
      // WHY: bounded state gives Central a real afterimage while preserving deterministic capture behavior.
      for (let index = 0; index < this.echoEnergies.length; index += 1) {
        const source = index === 0 ? this.displayedEnergy : this.echoEnergies[index - 1] ?? 0;
        const current = this.echoEnergies[index] ?? 0;
        const echoTime = 0.16 + index * 0.17 + afterimageStrength * 0.34;
        const echoFollow = this.elapsedSeconds > 0
          ? 1 - Math.exp(-this.elapsedSeconds / echoTime)
          : 0;
        this.echoEnergies[index] = current + (source - current) * echoFollow;
      }
    }
    this.elapsedSeconds = 0;

    const minDimension = Math.min(canvas.width, canvas.height);
    const origin = resolveCenteredOrigin(
      canvas.width,
      canvas.height,
      alignmentBias(environment.alignment),
    );
    const pointCount = resolveCentralPulsePointCount(params.density);
    const complexity = clamp01(params.density);
    // Central's shared `smoothing` slot is intentionally the contextual Pulse Speed control.
    const pulseSpeed = 0.28 + clamp01(params.smoothing) * 1.52;
    const timeSeconds = environment.reduceMotion ? 0 : Math.max(0, frame.timeMs / 1000);
    const intensity = 0.55 + clamp01(params.intensity) * 0.9;
    const pulse = environment.reduceMotion
      ? 0
      : Math.sin(timeSeconds * pulseSpeed * Math.PI * 2) * this.displayedEnergy;
    const radius = minDimension * (
      0.135
      + this.displayedEnergy * (0.025 + clamp01(params.intensity) * 0.04)
      + pulse * (0.006 + clamp01(params.intensity) * 0.012)
    );
    const displacement = minDimension
      * (0.012 + complexity * 0.024)
      * (0.15 + this.displayedEnergy * 0.85)
      * intensity;
    const palette = resolveVisualPalette(params.color);
    const primary = palette[0] ?? environment.colors.bar;
    const secondary = palette[1] ?? primary;
    const hot = palette[palette.length - 1] ?? environment.colors.glow;
    const highContrast = params.highContrast === true;
    const contrast = mixVisualColors(hot, '#ffffff', 0.32);
    const echoCount = highContrast || environment.reduceMotion
      ? 0
      : resolveCentralPulseEchoCount(afterimageStrength);

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.lineCap = 'round';

    for (let echoIndex = echoCount - 1; echoIndex >= 0; echoIndex -= 1) {
      const echoEnergy = clamp01(this.echoEnergies[echoIndex] ?? 0);
      const echoRadius = minDimension * (
        0.135
        + echoEnergy * (0.025 + clamp01(params.intensity) * 0.04)
      ) + (echoIndex + 1) * (2.5 + afterimageStrength * 4);
      traceContour(ctx, {
        centerX: origin.x,
        centerY: origin.y,
        pointCount,
        radius: echoRadius,
        displacement: displacement * (0.72 + echoIndex * 0.08),
        timeSeconds: Math.max(0, timeSeconds - (echoIndex + 1) * 0.08 * afterimageStrength),
        complexity,
        speed: pulseSpeed,
        seed: 29,
      });
      ctx.strokeStyle = colorWithAlpha(
        palette[(echoIndex + 1) % palette.length] ?? secondary,
        (0.1 + afterimageStrength * 0.2) / (echoIndex + 1),
      );
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    const contour: ContourGeometry = {
      centerX: origin.x,
      centerY: origin.y,
      pointCount,
      radius,
      displacement,
      timeSeconds,
      complexity: environment.reduceMotion ? 0.32 : complexity,
      speed: environment.reduceMotion ? 0 : pulseSpeed,
      seed: 29,
    };
    traceContour(ctx, contour);

    if (highContrast) {
      ctx.fillStyle = colorWithAlpha(contrast, 0.16);
      ctx.fill();
    } else {
      const gradient = ctx.createRadialGradient(
        origin.x,
        origin.y,
        radius * 0.08,
        origin.x,
        origin.y,
        radius + Math.abs(displacement) + minDimension * 0.025,
      );
      gradient.addColorStop(0, colorWithAlpha(hot, 0.48 + this.displayedEnergy * 0.18));
      gradient.addColorStop(0.58, colorWithAlpha(secondary, 0.28 + this.displayedEnergy * 0.14));
      gradient.addColorStop(1, colorWithAlpha(primary, 0.02));
      ctx.fillStyle = gradient;
      ctx.fill();
    }

    if (!highContrast && !environment.reduceMotion) {
      ctx.strokeStyle = colorWithAlpha(hot, 0.34 + this.displayedEnergy * 0.34);
      ctx.lineWidth = 7;
      ctx.shadowColor = hot;
      ctx.shadowBlur = Math.min(20, environment.bars.glow * (0.35 + this.displayedEnergy * 0.5));
      ctx.stroke();
    }

    ctx.strokeStyle = highContrast ? contrast : hot;
    ctx.lineWidth = highContrast ? 4 : environment.reduceMotion ? 3 : 2.4;
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.globalAlpha = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(
      origin.x,
      origin.y,
      Math.max(2.5, radius * (0.16 + this.displayedEnergy * 0.08)),
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = colorWithAlpha(highContrast ? contrast : hot, highContrast ? 0.92 : 0.2);
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.lineCap = 'butt';
  }
}

export const CENTRAL_PULSE_VISUAL_DEFINITION: AudioVisualDefinition = Object.freeze({
  id: CENTRAL_PULSE_ID,
  label: 'Central Pulse',
  kind: 'spectrum',
  wants: Object.freeze({ bands: true }),
  family: 'organic-spectrum',
  maxElements: CENTRAL_PULSE_MAX_ELEMENTS,
  defaultParams: Object.freeze({
    sensitivity: 0.58,
    intensity: 0.62,
    smoothing: 0.48,
    color: Object.freeze(['#2a788e', '#22a884', '#7ad151', '#fde725']),
    density: 0.52,
    layoutMode: 'centered',
    highContrast: false,
    afterimageStrength: 0.42,
  }),
  create: () => new CentralPulseVisual(),
});
