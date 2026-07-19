import type {
  AudioVisual,
  AudioVisualDefinition,
  AudioVisualRenderEnvironment,
  SpectrumRenderEnvironment,
} from '..';
import { colorWithAlpha, mixVisualColors, resolveVisualPalette } from '../palette';
import type { AudioVizFrame } from '../audio-frame';
import type { VisualizerParams } from '../params';

export const OSCILLOSCOPE_SPECTRUM_ID = 'oscilloscope' as const;
export const OSCILLOSCOPE_MIN_TRACE_POINTS = 96;
export const OSCILLOSCOPE_MAX_TRACE_POINTS = 160;
export const OSCILLOSCOPE_MAX_HISTORY_FRAMES = 6;
export const OSCILLOSCOPE_MAX_ELEMENTS =
  OSCILLOSCOPE_MAX_TRACE_POINTS * OSCILLOSCOPE_MAX_HISTORY_FRAMES;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function clampSample(value: number): number {
  return Math.min(1, Math.max(-1, Number.isFinite(value) ? value : 0));
}

/** Even trace counts preserve a balanced circular seam while bounding path complexity. */
export function resolveOscilloscopePointCount(density: number): number {
  const pairCount = Math.round(
    OSCILLOSCOPE_MIN_TRACE_POINTS / 2
      + clamp01(density)
        * ((OSCILLOSCOPE_MAX_TRACE_POINTS - OSCILLOSCOPE_MIN_TRACE_POINTS) / 2),
  );
  return pairCount * 2;
}

/** Persistence reveals only a fixed number of downsampled snapshots, including the live trace. */
export function resolveOscilloscopeHistoryCount(afterimageStrength: number): number {
  const strength = clamp01(afterimageStrength);
  if (strength <= 0.04) return 1;
  return Math.min(
    OSCILLOSCOPE_MAX_HISTORY_FRAMES,
    1 + Math.ceil(strength * (OSCILLOSCOPE_MAX_HISTORY_FRAMES - 1)),
  );
}

function resolveSweepSampleCount(sampleCount: number, density: number): number {
  if (sampleCount <= 1) return sampleCount;
  // Oscilloscope's contextual Density control doubles as sweep timebase:
  // denser traces inspect a longer sample window while staying under the same point cap.
  return Math.min(
    sampleCount,
    Math.max(2, Math.round(sampleCount * (0.3 + clamp01(density) * 0.58))),
  );
}

/**
 * Downsample a stable sweep beginning near a strong rising zero crossing.
 * This is the small but important difference between a readable instrument trace and jittery polyline noise.
 */
export function sampleOscilloscopeTrace(
  waveform: Float32Array | undefined,
  requestedPointCount: number,
  density: number,
): Float32Array {
  const pointCount = Math.min(
    OSCILLOSCOPE_MAX_TRACE_POINTS,
    Math.max(2, Math.round(Number.isFinite(requestedPointCount) ? requestedPointCount : 2)),
  );
  const trace = new Float32Array(pointCount);
  if (!waveform || waveform.length < 2) return trace;

  const sweepSamples = resolveSweepSampleCount(waveform.length, density);
  const maxStart = Math.max(0, waveform.length - sweepSamples);
  const preferredStart = Math.round(maxStart * 0.38);
  let triggerStart = preferredStart;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let index = 1; index <= maxStart; index += 1) {
    const previousRaw = waveform[index - 1] ?? 0;
    const currentRaw = waveform[index] ?? 0;
    // BUG FIX: Non-finite waveform edge false trigger
    // Fix: Skip crossings adjacent to invalid samples so a sanitized discontinuity cannot win the trigger.
    if (!Number.isFinite(previousRaw) || !Number.isFinite(currentRaw)) continue;
    const previous = clampSample(previousRaw);
    const current = clampSample(currentRaw);
    if (previous > 0 || current <= 0) continue;
    const slope = current - previous;
    const distancePenalty = Math.abs(index - preferredStart) / Math.max(1, maxStart);
    const score = slope * 2.4 - distancePenalty * 0.28;
    if (score > bestScore) {
      bestScore = score;
      triggerStart = index;
    }
  }

  for (let index = 0; index < pointCount; index += 1) {
    const progress = index / Math.max(1, pointCount - 1);
    const sourcePosition = Math.min(
      waveform.length - 1,
      triggerStart + progress * Math.max(1, sweepSamples - 1),
    );
    const leftIndex = Math.floor(sourcePosition);
    const rightIndex = Math.min(waveform.length - 1, leftIndex + 1);
    const mix = sourcePosition - leftIndex;
    const left = clampSample(waveform[leftIndex] ?? 0);
    const right = clampSample(waveform[rightIndex] ?? left);
    trace[index] = left + (right - left) * mix;
  }
  return trace;
}

function reducedMotionTrace(pointCount: number, frame: AudioVizFrame): Float32Array {
  // BUG FIX: reduced-motion trace clipped flat at the rails (QA §7b)
  // Fix: full-scale sine × gain saturated clampSample, flattening peaks/troughs into a
  //      square wave. The calm trace now peaks at 0.8 and renders with a fixed sub-unity
  //      gain so the curve keeps its shape at any loudness.
  const energy = Math.pow(clamp01(frame.energy * 1.6), 0.68) * 0.8;
  return Float32Array.from({ length: pointCount }, (_, index) => {
    const progress = index / Math.max(1, pointCount - 1);
    const envelope = 0.68 + Math.sin(progress * Math.PI) ** 2 * 0.32;
    return Math.sin(progress * Math.PI * 4) * energy * envelope;
  });
}

function baselineY(
  alignment: SpectrumRenderEnvironment['alignment'],
  canvasHeight: number,
): number {
  if (alignment === 'top') return canvasHeight * 0.3;
  if (alignment === 'bottom') return canvasHeight * 0.7;
  return canvasHeight / 2;
}

function traceLinearPath(
  ctx: CanvasRenderingContext2D,
  trace: Float32Array,
  pointCount: number,
  canvas: HTMLCanvasElement,
  environment: SpectrumRenderEnvironment,
  gain: number,
  intensity: number,
): void {
  const left = canvas.width * 0.1;
  const width = canvas.width * 0.8;
  const baseline = baselineY(environment.alignment, canvas.height);
  // CHANGED: 0.23 → 0.26 — the extra ~13% visual headroom QA measured room for (§2f).
  const amplitude = canvas.height * 0.26 * intensity;
  ctx.beginPath();
  for (let index = 0; index < pointCount; index += 1) {
    const progress = index / Math.max(1, pointCount - 1);
    const x = left + progress * width;
    const y = baseline - clampSample((trace[index] ?? 0) * gain) * amplitude;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

function traceRadialPath(
  ctx: CanvasRenderingContext2D,
  trace: Float32Array,
  pointCount: number,
  canvas: HTMLCanvasElement,
  environment: SpectrumRenderEnvironment,
  gain: number,
  intensity: number,
): void {
  const minDimension = Math.min(canvas.width, canvas.height);
  const centerX = canvas.width / 2;
  const centerY = baselineY(environment.alignment, canvas.height);
  const baseRadius = minDimension * 0.23;
  // CHANGED: 0.105 → 0.118 — matching ~12% amplitude headroom for the ring (§2f).
  const amplitude = minDimension * 0.118 * intensity;
  ctx.beginPath();
  for (let index = 0; index < pointCount; index += 1) {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / pointCount;
    const radius = Math.max(
      minDimension * 0.08,
      baseRadius + clampSample((trace[index] ?? 0) * gain) * amplitude,
    );
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawGraticule(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  environment: SpectrumRenderEnvironment,
  radial: boolean,
  color: string,
  highContrast: boolean,
): void {
  const baseline = baselineY(environment.alignment, canvas.height);
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
  ctx.globalAlpha = 1;

  if (radial) {
    const minDimension = Math.min(canvas.width, canvas.height);
    const centerX = canvas.width / 2;
    const radii = highContrast
      ? [minDimension * 0.23]
      : [minDimension * 0.15, minDimension * 0.23, minDimension * 0.31];
    for (const radius of radii) {
      ctx.beginPath();
      ctx.arc(centerX, baseline, radius, 0, Math.PI * 2);
      ctx.strokeStyle = colorWithAlpha(color, highContrast ? 0.52 : 0.13);
      ctx.lineWidth = highContrast ? 1.5 : 1;
      ctx.stroke();
    }
    return;
  }

  const left = canvas.width * 0.1;
  const width = canvas.width * 0.8;
  ctx.fillStyle = colorWithAlpha(color, highContrast ? 0.5 : 0.12);
  ctx.fillRect(left, baseline - (highContrast ? 0.75 : 0.5), width, highContrast ? 1.5 : 1);
  if (highContrast) return;

  for (let column = 0; column <= 8; column += 1) {
    const x = left + column * width / 8;
    ctx.fillRect(x, baseline - canvas.height * 0.24, 1, canvas.height * 0.48);
  }
  for (const offset of [-0.5, 0.5]) {
    const y = baseline + offset * canvas.height * 0.23;
    ctx.fillRect(left, y, width, 1);
  }
}

class OscilloscopeVisual implements AudioVisual {
  readonly id = OSCILLOSCOPE_SPECTRUM_ID;
  readonly kind = 'spectrum' as const;
  readonly supportsAfterimage = true;
  readonly supportedLayouts = Object.freeze(['linear', 'radial'] as const);

  private readonly history = Array.from(
    { length: OSCILLOSCOPE_MAX_HISTORY_FRAMES },
    () => new Float32Array(OSCILLOSCOPE_MAX_TRACE_POINTS),
  );
  private historyHead = -1;
  private historySize = 0;
  private elapsedSeconds = 0;
  private historyDiscontinuity = false;
  private modeKey = '';

  update(_frame: AudioVizFrame, dt: number): void {
    this.elapsedSeconds = dt;
    this.historyDiscontinuity = dt >= 0.099;
  }

  private resetHistory(): void {
    this.historyHead = -1;
    this.historySize = 0;
    for (const trace of this.history) trace.fill(0);
  }

  private historyAt(age: number): Float32Array | null {
    if (age < 0 || age >= this.historySize || this.historyHead < 0) return null;
    const index = (
      this.historyHead - age + OSCILLOSCOPE_MAX_HISTORY_FRAMES
    ) % OSCILLOSCOPE_MAX_HISTORY_FRAMES;
    return this.history[index] ?? null;
  }

  private pushTrace(
    source: Float32Array,
    pointCount: number,
    smoothing: number,
  ): Float32Array {
    const previous = this.historyAt(0);
    this.historyHead = (this.historyHead + 1) % OSCILLOSCOPE_MAX_HISTORY_FRAMES;
    const target = this.history[this.historyHead] as Float32Array;
    const spatialMix = smoothing * 0.42;
    const follow = previous
      ? this.elapsedSeconds > 0
        ? 1 - Math.exp(-this.elapsedSeconds / (0.018 + smoothing * 0.2))
        : 1 - smoothing * 0.72
      : 1;

    // CHANGED: each frame is resampled into a preallocated six-slot ring.
    // WHY: persistence should look like phosphor memory without retaining pixels or full analyser buffers.
    for (let index = 0; index < pointCount; index += 1) {
      const sample = source[index] ?? 0;
      const neighborAverage = (
        (source[Math.max(0, index - 1)] ?? sample)
        + (source[Math.min(pointCount - 1, index + 1)] ?? sample)
      ) / 2;
      const spatiallySmoothed = sample + (neighborAverage - sample) * spatialMix;
      target[index] = previous
        ? (previous[index] ?? 0) + (spatiallySmoothed - (previous[index] ?? 0)) * follow
        : spatiallySmoothed;
    }
    target.fill(0, pointCount);
    this.historySize = Math.min(OSCILLOSCOPE_MAX_HISTORY_FRAMES, this.historySize + 1);
    this.elapsedSeconds = 0;
    return target;
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

    const pointCount = resolveOscilloscopePointCount(params.density);
    const radial = params.layoutMode === 'radial';
    const modeKey = `${pointCount}:${radial ? 'radial' : 'linear'}:${environment.reduceMotion}`;
    // CHANGED: long render gaps clear the trace ring before the visual resumes.
    // WHY: switching away from Oscilloscope must not replay stale voice snapshots on return.
    if (modeKey !== this.modeKey || this.historyDiscontinuity) {
      this.resetHistory();
      this.modeKey = modeKey;
    }
    this.historyDiscontinuity = false;

    const sampled = environment.reduceMotion
      ? reducedMotionTrace(pointCount, frame)
      : sampleOscilloscopeTrace(frame.waveform, pointCount, params.density);
    const current = this.pushTrace(sampled, pointCount, clamp01(params.smoothing));
    const highContrast = params.highContrast === true;
    const persistence = clamp01(params.afterimageStrength ?? 0);
    const requestedHistory = highContrast || environment.reduceMotion
      ? 1
      : resolveOscilloscopeHistoryCount(persistence);
    const visibleHistory = Math.min(this.historySize, requestedHistory);
    const palette = resolveVisualPalette(params.color);
    const primary = palette[0] ?? environment.colors.bar;
    const hot = palette[palette.length - 1] ?? environment.colors.glow;
    const contrast = mixVisualColors(hot, '#ffffff', 0.38);
    // CHANGED: defaults retuned to the old maxed-out feel (Pass C §2f) — gain
    //          0.6+s·1.95 → 1.1+s·2.2 and intensity 0.62+i·0.72 → 0.9+i·0.65, so the
    //          default midpoint lands where "everything turned all the way up" sat.
    // WHY: the operator found the maxed behavior right and asked for the tuning
    //      midpoint moved there; the reduced trace keeps its calm sub-unity gain.
    const gain = environment.reduceMotion
      ? 0.85
      : 1.1 + clamp01(params.sensitivity) * 2.2;
    const intensity = 0.9 + clamp01(params.intensity) * 0.65;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    drawGraticule(
      ctx,
      canvas,
      environment,
      radial,
      highContrast ? contrast : primary,
      highContrast,
    );

    const tracePath = (trace: Float32Array): void => {
      if (radial) {
        traceRadialPath(ctx, trace, pointCount, canvas, environment, gain, intensity);
      } else {
        traceLinearPath(ctx, trace, pointCount, canvas, environment, gain, intensity);
      }
    };

    for (let age = visibleHistory - 1; age >= 1; age -= 1) {
      const historyTrace = this.historyAt(age);
      if (!historyTrace) continue;
      tracePath(historyTrace);
      const fade = 1 - age / Math.max(1, visibleHistory);
      const trailColor = palette[age % palette.length] ?? primary;
      ctx.strokeStyle = colorWithAlpha(trailColor, (0.06 + persistence * 0.23) * fade);
      ctx.lineWidth = 1.25;
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
      ctx.globalAlpha = 1;
      ctx.stroke();
    }

    if (!highContrast && !environment.reduceMotion) {
      tracePath(current);
      ctx.strokeStyle = colorWithAlpha(hot, 0.28 + clamp01(frame.energy) * 0.28);
      ctx.lineWidth = 7.5;
      ctx.shadowColor = hot;
      ctx.shadowBlur = Math.min(20, environment.bars.glow * (0.46 + intensity * 0.38));
      ctx.globalAlpha = 1;
      ctx.stroke();
    }

    tracePath(current);
    ctx.strokeStyle = highContrast ? contrast : hot;
    ctx.lineWidth = highContrast ? 4 : environment.reduceMotion ? 3 : 2.25;
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.globalAlpha = 1;
    ctx.stroke();

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
  }
}

export const OSCILLOSCOPE_VISUAL_DEFINITION: AudioVisualDefinition = Object.freeze({
  id: OSCILLOSCOPE_SPECTRUM_ID,
  label: 'Oscilloscope',
  kind: 'spectrum',
  wants: Object.freeze({ waveform: true }),
  family: 'waveform-spectrum',
  maxElements: OSCILLOSCOPE_MAX_ELEMENTS,
  defaultParams: Object.freeze({
    sensitivity: 0.64,
    intensity: 0.62,
    smoothing: 0.34,
    color: Object.freeze(['#38bdf8', '#a78bfa', '#f8fafc']),
    density: 0.48,
    layoutMode: 'linear',
    highContrast: false,
    afterimageStrength: 0.62,
  }),
  create: () => new OscilloscopeVisual(),
});
