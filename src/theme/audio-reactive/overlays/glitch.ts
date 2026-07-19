import type {
  AudioVisual,
  AudioVisualDefinition,
  AudioVisualRenderEnvironment,
  AudioVizFrame,
  LayoutMode,
  VisualizerParams,
} from '@/src/theme/audio-reactive';
import { colorWithAlpha, resolveVisualPalette } from '../palette';

export const GLITCH_ID = 'glitch' as const;
export const GLITCH_LABEL = 'Glitch' as const;
export const GLITCH_MIN_SCANLINES = 12;
export const GLITCH_MAX_SCANLINES = 36;
export const GLITCH_MAX_TEAR_COUNT = 10;
/** Burst-gated sinusoidal row/column displacement slices (the CRT "wave" pass). */
export const GLITCH_MAX_WAVE_ROWS = 6;
/**
 * 36 scanlines + three split ghosts (two lateral + one burst vertical) + ten four-pass
 * tears + six wave slices + one inversion flash + three sync rails.
 */
export const GLITCH_MAX_ELEMENTS =
  GLITCH_MAX_SCANLINES + 3 + GLITCH_MAX_TEAR_COUNT * 4 + GLITCH_MAX_WAVE_ROWS + 1 + 3;

interface GlitchTear {
  active: boolean;
  age: number;
  lifetime: number;
  position: number;
  span: number;
  breadth: number;
  direction: -1 | 1;
  phase: number;
  band: number;
}

const GLITCH_BAND_COUNT = 32;
const RGB_MAGENTA = '#ff2f92';
const RGB_CYAN = '#00eaff';
const SIGNAL_WHITE = '#f7fbff';

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function seededUnit(index: number, salt: number): number {
  const value = Math.sin(index * 84.173 + salt * 31.417) * 43758.5453;
  return value - Math.floor(value);
}

function resolveLayout(params: VisualizerParams): LayoutMode {
  return params.layoutMode === 'centered' || params.layoutMode === 'radial'
    ? params.layoutMode
    : 'linear';
}

export function resolveGlitchScanlineCount(density: number): number {
  return Math.round(
    GLITCH_MIN_SCANLINES
      + clamp01(density) * (GLITCH_MAX_SCANLINES - GLITCH_MIN_SCANLINES),
  );
}

function bandWeight(index: number, params: VisualizerParams): number {
  if (index < 11) return params.bassWeight ?? 1;
  if (index < 22) return params.midWeight ?? 1;
  return params.trebleWeight ?? 1;
}

/**
 * CHANGED: Glitch owns a fixed tear pool plus lightweight onset history instead of retained frames.
 * WHY: convincing signal damage needs abrupt geometry, but capture cost and encoded entropy must stay bounded.
 */
class GlitchVisual implements AudioVisual {
  readonly id = GLITCH_ID;
  readonly kind = 'overlay' as const;
  readonly supportedLayouts = Object.freeze(['linear', 'centered', 'radial'] as const);

  private readonly tears: GlitchTear[] = Array.from(
    { length: GLITCH_MAX_TEAR_COUNT },
    () => ({
      active: false,
      age: 0,
      lifetime: 0.2,
      position: 0,
      span: 0.1,
      breadth: 0.3,
      direction: 1,
      phase: 0,
      band: 0,
    }),
  );
  private readonly previousBands = new Float32Array(GLITCH_BAND_COUNT);

  private pendingDt = 0;
  private burst = 0;
  private previousEnergy = 0;
  private hasAudioSample = false;
  private spawnSerial = 0;
  private lastPreviewBeat = -1;
  private activeTearCount = 0;
  /** Sustained-speech accumulator that fires seeded micro-glitches between true onsets. */
  private simmer = 0;
  private simmerSerial = 0;
  private waveSeed = 0;

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
    const width = Math.max(1, canvas.width);
    const height = Math.max(1, canvas.height);
    const reduceMotion = environment?.reduceMotion === true;
    const layout = resolveLayout(params);
    const drives = this.resolveDrives(frame, params, environment);
    const onset = this.resolveOnset(frame, params, environment, drives.total, reduceMotion);

    if (reduceMotion) {
      this.clearTears();
      this.drawReducedMotion(ctx, width, height, layout, params, drives.total);
      this.pendingDt = 0;
      return;
    }

    this.advanceState(this.pendingDt, params);
    if (onset) {
      this.burst = Math.max(this.burst, 0.68 + drives.treble * 0.32);
      this.waveSeed += 1;
      this.spawnTears(params, drives.treble);
    }
    // CHANGED: sustained speech accumulates toward seeded micro-glitches between true onsets.
    // WHY: QA found the effect rarely activated — splicing should simmer through normal
    //      speech, not only on sharp attacks (§3g / §5b).
    // CHANGED: simmer charges ~4× faster and fires harder bursts (Pass C: still rare).
    // WHY: at speech-level drives the old rate fired every 4–10 s; micro-glitches
    //      should splice every 1–3 s of sustained voice. Silence still charges nothing.
    this.simmer += (drives.mid * 0.9 + drives.treble * 1.1) * this.pendingDt;
    const simmerGate = 0.55 + seededUnit(this.simmerSerial, 29) * 0.9;
    if (this.simmer >= simmerGate) {
      this.simmer = 0;
      this.simmerSerial += 1;
      this.burst = Math.max(this.burst, 0.42 + drives.treble * 0.35);
      this.waveSeed += 1;
      this.spawnTears(params, drives.treble * 0.85);
    }
    this.pendingDt = 0;

    const palette = resolveVisualPalette(params.color);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    this.drawRgbSplit(ctx, canvas, params, drives);
    this.drawWaveSlices(ctx, canvas, layout, params, drives);
    this.drawTears(ctx, canvas, layout, params, palette, drives);
    this.drawInvertFlash(ctx, width, height, params);
    this.drawScanlines(ctx, width, height, layout, params, palette, drives);
    this.drawSyncRails(ctx, width, height, layout, params, drives);
    ctx.restore();
  }

  private resolveDrives(
    frame: AudioVizFrame,
    params: VisualizerParams,
    environment: AudioVisualRenderEnvironment | undefined,
  ): { bass: number; mid: number; treble: number; total: number } {
    const sums = [0, 0, 0];
    const counts = [11, 11, 10];
    for (let index = 0; index < GLITCH_BAND_COUNT; index += 1) {
      const group = index < 11 ? 0 : index < 22 ? 1 : 2;
      sums[group] += clamp01(frame.bands[index] ?? 0) * bandWeight(index, params);
    }
    // BUG FIX: Reduced-motion Glitch preview drift
    // Fix: Suppress the synthetic preview tide when motion is reduced so identical audio paints a fixed frame.
    const previewTide = environment?.amplitudeMode === 'preview' && !environment.reduceMotion
      ? 0.045 + Math.sin(frame.timeMs / 790) * 0.02
      : 0;
    const sensitivity = 0.42 + clamp01(params.sensitivity) * 1.42;
    const bass = clamp01((sums[0] / counts[0] + previewTide) * sensitivity);
    const mid = clamp01((sums[1] / counts[1] + previewTide) * sensitivity);
    const treble = clamp01((sums[2] / counts[2] + previewTide) * sensitivity);
    const total = clamp01(frame.energy * 0.46 + bass * 0.2 + mid * 0.2 + treble * 0.3);
    return { bass, mid, treble, total };
  }

  private resolveOnset(
    frame: AudioVizFrame,
    params: VisualizerParams,
    environment: AudioVisualRenderEnvironment | undefined,
    drive: number,
    reduceMotion: boolean,
  ): boolean {
    let positiveFlux = 0;
    let risingBands = 0;
    for (let index = 0; index < GLITCH_BAND_COUNT; index += 1) {
      const next = clamp01(frame.bands[index] ?? 0);
      if (this.hasAudioSample) {
        const delta = Math.max(0, next - (this.previousBands[index] ?? 0));
        // CHANGED: rising-band floor 0.012 → 0.008 (Pass C — still "rarely activates").
        if (delta > 0.008) {
          positiveFlux += delta;
          risingBands += 1;
        }
      }
      this.previousBands[index] = next;
    }
    // BUG FIX: Glitch onset flux diluted across the whole spectrum (QA §3g / §5b)
    // Fix: averaging positive flux over all 32 bands buried localized speech attacks
    //      (a strong 6-band consonant rise ÷ 32 fell under threshold, so the effect
    //      "rarely activated"). Flux now averages over the rising bands only.
    const focusedFlux = risingBands > 0 ? positiveFlux / Math.max(4, risingBands) : 0;
    const energyRise = this.hasAudioSample ? Math.max(0, frame.energy - this.previousEnergy) : 0;
    this.previousEnergy = clamp01(frame.energy);

    const previewBeat = Math.floor(Math.max(0, frame.timeMs) / 1320);
    const previewOnset = environment?.amplitudeMode === 'preview'
      && (this.lastPreviewBeat < 0 || previewBeat !== this.lastPreviewBeat);
    this.lastPreviewBeat = previewBeat;

    // CHANGED: onset threshold lowered again, 0.055−s·0.028 → 0.042−s·0.024 (Pass C).
    // WHY: the effect is nearly free in paint cost, so it should splice on ordinary
    //      speech attacks, not only the sharpest consonants (§3g).
    const threshold = 0.042 - clamp01(params.sensitivity) * 0.024;
    const detected = this.hasAudioSample
      && drive > 0.03
      && (focusedFlux + energyRise * 0.72) > threshold;
    this.hasAudioSample = true;
    return !reduceMotion && (frame.transient === true || detected || previewOnset);
  }

  private advanceState(dt: number, params: VisualizerParams): void {
    if (dt <= 0) return;
    const hold = 0.11 + clamp01(params.smoothing) * 0.22;
    this.burst *= Math.exp(-dt / hold);
    if (this.burst < 0.004) this.burst = 0;

    this.activeTearCount = 0;
    for (const tear of this.tears) {
      if (!tear.active) continue;
      tear.age += dt;
      if (tear.age >= tear.lifetime) {
        tear.active = false;
        continue;
      }
      this.activeTearCount += 1;
    }
  }

  private spawnTears(params: VisualizerParams, treble: number): void {
    const requested = Math.min(
      GLITCH_MAX_TEAR_COUNT,
      Math.round(2 + clamp01(params.density) * 4 + treble * 2),
    );
    for (let count = 0; count < requested; count += 1) {
      const slot = this.tears.find((tear) => !tear.active);
      if (!slot) break;
      const serial = this.spawnSerial;
      this.spawnSerial += 1;
      slot.active = true;
      slot.age = 0;
      slot.lifetime = 0.13 + seededUnit(serial, 3) * (0.18 + params.smoothing * 0.18);
      slot.position = 0.06 + seededUnit(serial, 5) * 0.88;
      slot.span = 0.018 + seededUnit(serial, 7) * (0.035 + params.density * 0.055);
      slot.breadth = 0.24 + seededUnit(serial, 11) * 0.52;
      slot.direction = seededUnit(serial, 13) > 0.5 ? 1 : -1;
      slot.phase = seededUnit(serial, 17) * Math.PI * 2;
      slot.band = serial % GLITCH_BAND_COUNT;
      this.activeTearCount += 1;
    }
  }

  private clearTears(): void {
    for (const tear of this.tears) tear.active = false;
    this.activeTearCount = 0;
    this.burst = 0;
    this.simmer = 0;
  }

  private drawRgbSplit(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    params: VisualizerParams,
    drives: { bass: number; mid: number; treble: number; total: number },
  ): void {
    if (params.highContrast || drives.total < 0.012) return;
    const width = Math.max(1, canvas.width);
    const shift = Math.max(1, Math.min(width * 0.018, (2 + drives.treble * 12) * params.intensity));
    const alpha = Math.min(0.12, 0.018 + drives.total * 0.05 + this.burst * 0.045);
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = alpha;
    ctx.filter = 'sepia(1) saturate(7) hue-rotate(285deg)';
    ctx.drawImage(canvas, -shift, 0);
    ctx.filter = 'sepia(1) saturate(7) hue-rotate(125deg)';
    ctx.drawImage(canvas, shift, 0);
    // CHANGED: bursts kick a third, vertically-shifted blue ghost (Pass C).
    // WHY: horizontal-only separation reads as static misconvergence; a transient
    //      vertical chroma jolt is the "real shader" aberration QA asked for (§3g).
    if (this.burst > 0.24) {
      ctx.filter = 'sepia(1) saturate(6) hue-rotate(205deg)';
      ctx.globalAlpha = Math.min(0.1, alpha * (0.5 + this.burst * 0.5));
      ctx.drawImage(canvas, 0, Math.max(1, shift * 0.55));
    }
    ctx.filter = 'none';
  }

  /**
   * CHANGED: hard attacks fire a one-frame partial inversion flash (Pass C).
   * WHY: difference-compositing a dim white wash over the corrupted frame is the
   *      classic shader "signal invert" hit — one bounded rect of extra aberration
   *      on the loudest onsets (§3g).
   */
  private drawInvertFlash(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    params: VisualizerParams,
  ): void {
    if (params.highContrast || this.burst < 0.52) return;
    ctx.globalCompositeOperation = 'difference';
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    ctx.fillStyle = colorWithAlpha('#ffffff', Math.min(0.3, (this.burst - 0.52) * 0.55));
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * CHANGED: burst-gated sinusoidal slice displacement (rows for linear/radial, columns
   * for centered) self-copies thin strips with per-slice offsets.
   * WHY: QA asked for "a real shader" feel with more aberrations — this is the classic
   *      CRT horizontal-hold wobble, bounded to GLITCH_MAX_WAVE_ROWS unfiltered copies (§3g).
   */
  private drawWaveSlices(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    layout: LayoutMode,
    params: VisualizerParams,
    drives: { bass: number; mid: number; treble: number; total: number },
  ): void {
    // CHANGED: wave gate 0.12 → 0.07 so decaying bursts keep wobbling longer (Pass C).
    if (this.burst < 0.07) return;
    const width = Math.max(1, canvas.width);
    const height = Math.max(1, canvas.height);
    const vertical = layout === 'centered';
    const along = vertical ? height : width;
    const across = vertical ? width : height;
    const magnitude = Math.min(
      along * 0.05,
      (3 + drives.treble * 14) * this.burst * (0.5 + clamp01(params.intensity)),
    );
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    for (let index = 0; index < GLITCH_MAX_WAVE_ROWS; index += 1) {
      const position = seededUnit(this.waveSeed * 7 + index, 37);
      const sliceSpan = Math.max(2, across * (0.012 + seededUnit(this.waveSeed + index, 41) * 0.03));
      const start = clampRectOrigin(position * across, sliceSpan, across);
      const offset = Math.round(
        Math.sin(this.waveSeed * 2.71 + index * 2.393 + this.burst * 5.3) * magnitude,
      );
      const span = along - Math.abs(offset);
      if (span < 8 || offset === 0) continue;
      const sourceStart = offset > 0 ? 0 : -offset;
      const destinationStart = offset > 0 ? offset : 0;
      ctx.globalAlpha = Math.min(0.9, 0.35 + this.burst * 0.5);
      if (vertical) {
        ctx.drawImage(canvas, start, sourceStart, sliceSpan, span, start, destinationStart, sliceSpan, span);
      } else {
        ctx.drawImage(canvas, sourceStart, start, span, sliceSpan, destinationStart, start, span, sliceSpan);
      }
    }
  }

  private drawTears(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    layout: LayoutMode,
    params: VisualizerParams,
    palette: readonly string[],
    drives: { bass: number; mid: number; treble: number; total: number },
  ): void {
    if (this.activeTearCount === 0) return;
    const width = Math.max(1, canvas.width);
    const height = Math.max(1, canvas.height);
    const minDimension = Math.max(1, Math.min(width, height));
    const baseOffset = minDimension * (0.015 + this.burst * 0.065) * (0.55 + params.intensity);

    ctx.globalCompositeOperation = params.highContrast ? 'source-over' : 'screen';
    ctx.filter = 'none';
    for (const tear of this.tears) {
      if (!tear.active) continue;
      const life = clamp01(1 - tear.age / tear.lifetime);
      const jitter = Math.sin(tear.phase + tear.age * 86) * 0.22 + 0.78;
      const weightedDrive = clamp01((frameBandDrive(drives, tear.band)) * bandWeight(tear.band, params));
      const offset = tear.direction * baseOffset * jitter * (0.62 + weightedDrive * 0.74) * life;
      const rect = resolveTearRect(layout, tear, width, height, minDimension);
      const destinationX = clampRectOrigin(rect.x + (layout === 'radial' ? -offset * 0.35 : offset), rect.width, width);
      const destinationY = clampRectOrigin(rect.y + (layout === 'radial' ? offset : 0), rect.height, height);

      ctx.globalAlpha = Math.min(0.96, (0.38 + this.burst * 0.5) * life);
      ctx.drawImage(
        canvas,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        destinationX,
        destinationY,
        rect.width,
        rect.height,
      );

      const fringe = Math.max(1, minDimension * 0.004);
      ctx.globalAlpha = params.highContrast ? 0.92 : 0.35 + life * 0.28;
      ctx.fillStyle = colorWithAlpha(RGB_MAGENTA, params.highContrast ? 0.94 : 0.72);
      drawTearFringe(ctx, layout, rect, destinationX, destinationY, fringe, -1);
      ctx.fillStyle = colorWithAlpha(RGB_CYAN, params.highContrast ? 0.94 : 0.72);
      drawTearFringe(ctx, layout, rect, destinationX, destinationY, fringe, 1);

      ctx.globalAlpha = 0.24 + life * 0.48;
      ctx.fillStyle = colorWithAlpha(
        palette[tear.band % palette.length] ?? SIGNAL_WHITE,
        params.highContrast ? 1 : 0.78,
      );
      drawTearSeam(ctx, layout, rect, destinationX, destinationY, Math.max(1, fringe * 0.42));
    }
  }

  private drawScanlines(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    layout: LayoutMode,
    params: VisualizerParams,
    palette: readonly string[],
    drives: { bass: number; mid: number; treble: number; total: number },
  ): void {
    const count = resolveGlitchScanlineCount(params.density);
    const time = Math.max(0, drives.total > 0.006 ? this.burst * 13 + drives.mid * 7 : 0);
    ctx.globalCompositeOperation = params.highContrast ? 'source-over' : 'screen';
    ctx.filter = 'none';
    ctx.lineWidth = params.highContrast ? 1.5 : 1;

    for (let index = 0; index < count; index += 1) {
      const unit = (index + 0.5) / count;
      const pulse = 0.5 + Math.sin(index * 2.173 + time) * 0.5;
      const alpha = params.highContrast
        ? 0.18 + drives.total * 0.28
        : 0.025 + drives.total * 0.08 + pulse * this.burst * 0.045;
      ctx.globalAlpha = Math.min(0.48, alpha);
      ctx.fillStyle = colorWithAlpha(
        palette[index % palette.length] ?? SIGNAL_WHITE,
        params.highContrast ? 0.9 : 0.72,
      );

      if (layout === 'radial') {
        const radius = Math.min(width, height) * (0.06 + unit * 0.62);
        ctx.beginPath();
        ctx.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
        ctx.strokeStyle = ctx.fillStyle;
        ctx.stroke();
      } else if (layout === 'centered') {
        const x = Math.round(unit * width);
        ctx.fillRect(x, 0, params.highContrast ? 2 : 1, height);
      } else {
        const y = Math.round(unit * height);
        ctx.fillRect(0, y, width, params.highContrast ? 2 : 1);
      }
    }
  }

  private drawSyncRails(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    layout: LayoutMode,
    params: VisualizerParams,
    drives: { bass: number; mid: number; treble: number; total: number },
  ): void {
    if (drives.total < 0.01 && this.burst <= 0) return;
    const alpha = params.highContrast ? 0.72 : 0.16 + drives.treble * 0.22 + this.burst * 0.2;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = Math.min(0.86, alpha);
    const thickness = params.highContrast ? 2 : 1;
    for (let index = 0; index < 3; index += 1) {
      ctx.fillStyle = index === 0
        ? colorWithAlpha(RGB_MAGENTA, 0.9)
        : index === 1
          ? colorWithAlpha(RGB_CYAN, 0.9)
          : colorWithAlpha(SIGNAL_WHITE, 0.88);
      if (layout === 'radial') {
        const size = Math.min(width, height) * (0.012 + index * 0.006);
        ctx.fillRect(width / 2 - size / 2, height / 2 - thickness / 2 + index * 3, size, thickness);
      } else if (layout === 'centered') {
        ctx.fillRect(width / 2 - thickness / 2 + (index - 1) * 3, height * 0.42, thickness, height * 0.16);
      } else {
        ctx.fillRect(width * 0.42, height * 0.5 + (index - 1) * 3, width * 0.16, thickness);
      }
    }
  }

  private drawReducedMotion(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    layout: LayoutMode,
    params: VisualizerParams,
    drive: number,
  ): void {
    const palette = resolveVisualPalette(params.color);
    const drives = { bass: drive, mid: drive, treble: drive, total: drive };
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    this.drawScanlines(ctx, width, height, layout, params, palette, drives);
    this.drawSyncRails(ctx, width, height, layout, params, drives);
    ctx.restore();
  }
}

function frameBandDrive(
  drives: { bass: number; mid: number; treble: number },
  band: number,
): number {
  return band < 11 ? drives.bass : band < 22 ? drives.mid : drives.treble;
}

function clampRectOrigin(origin: number, span: number, limit: number): number {
  return Math.min(Math.max(0, limit - span), Math.max(0, origin));
}

function resolveTearRect(
  layout: LayoutMode,
  tear: GlitchTear,
  width: number,
  height: number,
  minDimension: number,
): { x: number; y: number; width: number; height: number } {
  if (layout === 'radial') {
    const angle = tear.position * Math.PI * 2;
    const radius = minDimension * (0.12 + tear.breadth * 0.36);
    const blockWidth = Math.max(4, minDimension * (0.1 + tear.breadth * 0.16));
    const blockHeight = Math.max(3, minDimension * (0.035 + tear.span * 0.34));
    return {
      x: clampRectOrigin(width / 2 + Math.cos(angle) * radius - blockWidth / 2, blockWidth, width),
      y: clampRectOrigin(height / 2 + Math.sin(angle) * radius - blockHeight / 2, blockHeight, height),
      width: Math.min(width, blockWidth),
      height: Math.min(height, blockHeight),
    };
  }

  const tearHeight = Math.max(2, height * tear.span);
  if (layout === 'centered') {
    const tearWidth = Math.max(4, width * tear.breadth * 0.5);
    const right = tear.direction > 0;
    return {
      x: right ? width / 2 : width / 2 - tearWidth,
      y: clampRectOrigin(tear.position * height - tearHeight / 2, tearHeight, height),
      width: tearWidth,
      height: tearHeight,
    };
  }

  return {
    x: 0,
    y: clampRectOrigin(tear.position * height - tearHeight / 2, tearHeight, height),
    width,
    height: tearHeight,
  };
}

function drawTearFringe(
  ctx: CanvasRenderingContext2D,
  layout: LayoutMode,
  rect: { width: number; height: number },
  x: number,
  y: number,
  thickness: number,
  side: -1 | 1,
): void {
  if (layout === 'centered') {
    ctx.fillRect(side < 0 ? x : x + rect.width - thickness, y, thickness, rect.height);
  } else {
    ctx.fillRect(x, side < 0 ? y : y + rect.height - thickness, rect.width, thickness);
  }
}

function drawTearSeam(
  ctx: CanvasRenderingContext2D,
  layout: LayoutMode,
  rect: { width: number; height: number },
  x: number,
  y: number,
  thickness: number,
): void {
  if (layout === 'centered') {
    ctx.fillRect(x + rect.width / 2, y, thickness, rect.height);
  } else {
    ctx.fillRect(x, y + rect.height / 2, rect.width, thickness);
  }
}

export const GLITCH_VISUAL_DEFINITION: AudioVisualDefinition = Object.freeze({
  id: GLITCH_ID,
  label: GLITCH_LABEL,
  kind: 'overlay',
  family: 'signal-corruption',
  wants: Object.freeze({ bands: true }),
  maxElements: GLITCH_MAX_ELEMENTS,
  defaultParams: Object.freeze({
    sensitivity: 0.72,
    intensity: 0.76,
    smoothing: 0.3,
    density: 0.58,
    color: Object.freeze(['#ff2f92', '#00eaff', '#7dff72', '#f7fbff']),
    bassWeight: 0.84,
    midWeight: 1,
    trebleWeight: 1.34,
    layoutMode: 'linear',
    highContrast: false,
  }),
  create: () => new GlitchVisual(),
});
