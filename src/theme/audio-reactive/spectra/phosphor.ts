import type {
  AudioVisual,
  AudioVisualDefinition,
  AudioVisualRenderEnvironment,
  SpectrumRenderEnvironment,
} from '..';
import { colorWithAlpha, mixVisualColors, resolveVisualPalette } from '../palette';
import type { AudioVizFrame } from '../audio-frame';
import type { VisualizerParams } from '../params';

export const PHOSPHOR_SPECTRUM_ID = 'phosphor' as const;
export const PHOSPHOR_MIN_COLUMNS = 12;
export const PHOSPHOR_MAX_COLUMNS = 24;
export const PHOSPHOR_MIN_ROWS = 6;
export const PHOSPHOR_MAX_ROWS = 10;
export const PHOSPHOR_MAX_SEGMENTS = PHOSPHOR_MAX_COLUMNS * PHOSPHOR_MAX_ROWS;

/** A stable CRT-like contour used when FFT motion is intentionally reduced. */
export const PHOSPHOR_REDUCED_MOTION_SHAPE: readonly number[] = Object.freeze([
  0.42, 0.54, 0.7, 0.86, 0.74, 0.58, 0.64, 0.8,
  0.8, 0.64, 0.58, 0.74, 0.86, 0.7, 0.54, 0.42,
]);

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

export interface PhosphorGrid {
  columns: number;
  rows: number;
  segments: number;
}

/** Density changes grain size while a hard segment ceiling protects capture cost. */
export function resolvePhosphorGrid(density: number): PhosphorGrid {
  const normalized = clamp01(density);
  const columns = Math.round(
    PHOSPHOR_MIN_COLUMNS + normalized * (PHOSPHOR_MAX_COLUMNS - PHOSPHOR_MIN_COLUMNS),
  );
  const rows = Math.round(
    PHOSPHOR_MIN_ROWS + normalized * (PHOSPHOR_MAX_ROWS - PHOSPHOR_MIN_ROWS),
  );
  return { columns, rows, segments: columns * rows };
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
  columns: number,
): number[] {
  if (environment.reduceMotion) {
    const energy = Math.pow(
      clamp01(frame.energy * (1.25 + clamp01(params.sensitivity) * 1.75)),
      0.68,
    );
    return Array.from({ length: columns }, (_, index) => {
      const shapeIndex = Math.round(
        index * (PHOSPHOR_REDUCED_MOTION_SHAPE.length - 1) / Math.max(1, columns - 1),
      );
      return energy * (PHOSPHOR_REDUCED_MOTION_SHAPE[shapeIndex] ?? 0.6);
    });
  }

  let peak = 0;
  if (environment.amplitudeMode === 'capture') {
    for (const band of frame.bands) peak = Math.max(peak, clamp01(band));
  }
  const peakScale = peak > 1 / 255 ? 1 / peak : 1;
  // CHANGED: live peak normalization is modulated by whole-frame energy.
  // WHY: the segmented display must retain speech detail without lighting up analyser-floor noise.
  const captureEnvelope = environment.amplitudeMode === 'capture'
    ? Math.pow(clamp01(frame.energy * 4), 0.58)
    : 1;
  const gain = 0.58 + clamp01(params.sensitivity) * 0.92;

  return Array.from({ length: columns }, (_, column) => {
    const start = Math.floor(column * frame.bands.length / columns);
    const end = Math.max(start + 1, Math.floor((column + 1) * frame.bands.length / columns));
    let sum = 0;
    let samples = 0;
    for (let bandIndex = start; bandIndex < end; bandIndex += 1) {
      const raw = clamp01(frame.bands[bandIndex] ?? 0);
      const level = environment.amplitudeMode === 'capture'
        ? raw * peakScale * captureEnvelope
        : raw;
      sum += level * bandWeight(bandIndex, params);
      samples += 1;
    }
    return Math.pow(clamp01((samples > 0 ? sum / samples : 0) * gain), 0.76);
  });
}

function gridTop(
  alignment: SpectrumRenderEnvironment['alignment'],
  canvasHeight: number,
  gridHeight: number,
): number {
  if (alignment === 'top') return canvasHeight * 0.06;
  if (alignment === 'bottom') return canvasHeight - gridHeight - canvasHeight * 0.06;
  return (canvasHeight - gridHeight) / 2;
}

function isLitSegment(
  row: number,
  litRows: number,
  rows: number,
  alignment: SpectrumRenderEnvironment['alignment'],
): boolean {
  if (alignment === 'top') return row < litRows;
  if (alignment === 'bottom') return row >= rows - litRows;
  const normalizedDistance = Math.abs((row + 0.5) / rows - 0.5) * 2;
  return normalizedDistance <= litRows / rows;
}

class PhosphorVisual implements AudioVisual {
  readonly id = PHOSPHOR_SPECTRUM_ID;
  readonly kind = 'spectrum' as const;
  readonly supportsAfterimage = true;
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

    const grid = resolvePhosphorGrid(params.density);
    const targets = resolveTargets(frame, params, environment, grid.columns);
    if (this.displayedLevels.length !== grid.columns) {
      this.displayedLevels = [...targets];
    } else {
      // CHANGED: attack stays crisp while decay follows a longer, user-tunable phosphor tail.
      // WHY: persistence should read as stored light, not generic symmetric bar smoothing.
      const smoothing = clamp01(params.smoothing);
      const persistence = Math.max(smoothing, clamp01(params.afterimageStrength ?? 0));
      for (let index = 0; index < grid.columns; index += 1) {
        const current = this.displayedLevels[index] ?? 0;
        const target = targets[index] ?? 0;
        const timeConstant = target >= current
          ? 0.025 + smoothing * 0.08
          : 0.1 + persistence * 0.72;
        const follow = this.elapsedSeconds > 0
          ? 1 - Math.exp(-this.elapsedSeconds / timeConstant)
          : smoothing <= 0 ? 1 : 0;
        this.displayedLevels[index] = current + (target - current) * follow;
      }
    }
    this.elapsedSeconds = 0;

    const availableWidth = canvas.width * 0.74;
    const gridHeight = canvas.height * 0.66;
    const slotWidth = availableWidth / grid.columns;
    const slotHeight = gridHeight / grid.rows;
    const highContrast = params.highContrast === true;
    const gap = highContrast ? 1.5 : 2.5;
    const cellWidth = Math.max(1, slotWidth - gap);
    const cellHeight = Math.max(1, slotHeight - gap);
    const startX = (canvas.width - availableWidth) / 2;
    const startY = gridTop(environment.alignment, canvas.height, gridHeight);
    const intensity = 0.62 + clamp01(params.intensity) * 0.78;
    const palette = resolveVisualPalette(params.color);
    const tint = palette[0] ?? environment.colors.bar;
    const hotTint = palette[1] ?? mixVisualColors(tint, '#ffffff', highContrast ? 0.55 : 0.32);
    const shadowTint = mixVisualColors(tint, '#000000', highContrast ? 0.72 : 0.58);
    const unlitTint = mixVisualColors(tint, '#000000', 0.78);
    const aberrationOffset = environment.reduceMotion || highContrast
      ? 0
      : 0.7 + clamp01(params.intensity) * 1.6 + (frame.transient ? 0.8 : 0);

    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';

    // CHANGED: a bounded, always-stable unlit matrix establishes the physical CRT segment grain.
    // WHY: Phosphor should remain identifiable at low energy without random/noisy pixels.
    ctx.fillStyle = colorWithAlpha(unlitTint, highContrast ? 0.54 : 0.34);
    ctx.globalAlpha = 1;
    for (let column = 0; column < grid.columns; column += 1) {
      const x = startX + column * slotWidth + gap / 2;
      for (let row = 0; row < grid.rows; row += 1) {
        const y = startY + row * slotHeight + gap / 2;
        ctx.fillRect(x, y, cellWidth, cellHeight);
      }
    }

    for (let column = 0; column < grid.columns; column += 1) {
      const level = clamp01(this.displayedLevels[column] ?? 0);
      const litRows = Math.min(grid.rows, Math.ceil(level * grid.rows));
      const x = startX + column * slotWidth + gap / 2;
      for (let row = 0; row < grid.rows; row += 1) {
        if (!isLitSegment(row, litRows, grid.rows, environment.alignment)) continue;
        const y = startY + row * slotHeight + gap / 2;
        const rowEnergy = environment.alignment === 'center'
          ? 1 - Math.abs((row + 0.5) / grid.rows - 0.5)
          : environment.alignment === 'top'
            ? 1 - row / grid.rows
            : (row + 1) / grid.rows;
        const alpha = clamp01((0.48 + level * 0.5 + rowEnergy * 0.12) * intensity);

        if (aberrationOffset > 0) {
          ctx.globalAlpha = 0.2 + level * 0.18;
          ctx.fillStyle = 'rgba(255, 70, 92, 0.72)';
          ctx.fillRect(x - aberrationOffset, y, cellWidth, cellHeight);
          ctx.fillStyle = 'rgba(54, 188, 255, 0.68)';
          ctx.fillRect(x + aberrationOffset, y, cellWidth, cellHeight);
        }

        ctx.globalAlpha = highContrast ? 1 : alpha;
        ctx.fillStyle = tint;
        ctx.fillRect(x, y, cellWidth, cellHeight);

        const bevel = Math.min(highContrast ? 2 : 1, cellHeight / 3);
        ctx.fillStyle = hotTint;
        ctx.globalAlpha = highContrast ? 0.92 : 0.54;
        ctx.fillRect(x, y, cellWidth, bevel);
        ctx.fillStyle = shadowTint;
        ctx.globalAlpha = highContrast ? 0.88 : 0.62;
        ctx.fillRect(x, y + cellHeight - bevel, cellWidth, bevel);
      }
    }

    // One horizontal pass per row suggests a scanline mask without per-pixel noise.
    if (!highContrast) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.24)';
      ctx.globalAlpha = 0.32;
      for (let row = 1; row < grid.rows; row += 1) {
        ctx.fillRect(startX, startY + row * slotHeight - 0.5, availableWidth, 1);
      }
    }

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
  }
}

export const PHOSPHOR_VISUAL_DEFINITION: AudioVisualDefinition = Object.freeze({
  id: PHOSPHOR_SPECTRUM_ID,
  label: 'Phosphor',
  kind: 'spectrum',
  wants: Object.freeze({ bands: true }),
  family: 'segmented-spectrum',
  maxElements: PHOSPHOR_MAX_SEGMENTS,
  defaultParams: Object.freeze({
    sensitivity: 0.55,
    intensity: 0.6,
    smoothing: 0.68,
    color: Object.freeze(['#7dff9b', '#e2ffd9']),
    density: 0.52,
    highContrast: false,
    afterimageStrength: 0.58,
  }),
  create: () => new PhosphorVisual(),
});
