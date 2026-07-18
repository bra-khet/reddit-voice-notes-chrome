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
// CHANGED: grid resolution raised (12–24×6–10 → 18–36×9–14) for smaller blocks.
// WHY: QA found the phosphor grain too coarse; fillRect cells are cheap enough that a
//      finer matrix stays well inside the comfortable governor budget (§2c).
export const PHOSPHOR_MIN_COLUMNS = 18;
export const PHOSPHOR_MAX_COLUMNS = 36;
export const PHOSPHOR_MIN_ROWS = 9;
export const PHOSPHOR_MAX_ROWS = 14;
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

/** Linear interpolation between adjacent (weighted, transformed) bands at a fractional index. */
function interpolatedBandLevel(
  frame: AudioVizFrame,
  params: VisualizerParams,
  position: number,
  transform: (raw: number) => number,
): number {
  const clamped = Math.min(frame.bands.length - 1, Math.max(0, position));
  const left = Math.floor(clamped);
  const right = Math.min(frame.bands.length - 1, left + 1);
  const mix = clamped - left;
  const leftLevel = transform(clamp01(frame.bands[left] ?? 0)) * bandWeight(left, params);
  const rightLevel = transform(clamp01(frame.bands[right] ?? 0)) * bandWeight(right, params);
  return leftLevel + (rightLevel - leftLevel) * mix;
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
      const shape = PHOSPHOR_REDUCED_MOTION_SHAPE[shapeIndex] ?? 0.6;
      // CHANGED: reduced motion keeps its stable silhouette but breathes per column
      //          with the spoken band level instead of freezing entirely.
      // WHY: QA §7b — reduced motion suppressed all motion; the a11y contract is "no
      //      autonomous animation", not "no audio response".
      const columnLevel = clamp01(interpolatedBandLevel(
        frame,
        params,
        (index + 0.5) / columns * (frame.bands.length - 1),
        (raw) => raw,
      ));
      return clamp01(energy * shape * (0.6 + columnLevel * 0.55));
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

  const transform = environment.amplitudeMode === 'capture'
    ? (raw: number): number => raw * peakScale * captureEnvelope
    : (raw: number): number => raw;

  return Array.from({ length: columns }, (_, column) => {
    const start = column * frame.bands.length / columns;
    const end = (column + 1) * frame.bands.length / columns;
    let level: number;
    if (end - start >= 1.5) {
      let sum = 0;
      let samples = 0;
      const last = Math.min(frame.bands.length, Math.ceil(end));
      for (let bandIndex = Math.floor(start); bandIndex < last; bandIndex += 1) {
        sum += transform(clamp01(frame.bands[bandIndex] ?? 0)) * bandWeight(bandIndex, params);
        samples += 1;
      }
      level = samples > 0 ? sum / samples : 0;
    } else {
      // CHANGED: sub-bin columns linearly interpolate between adjacent bands.
      // WHY: the finer grid can outnumber the 32 FFT bins; nearest-bin sampling would
      //      duplicate columns and stairstep the contour (§2c).
      level = interpolatedBandLevel(frame, params, (start + end) / 2 - 0.5, transform);
    }
    return Math.pow(clamp01(level * gain), 0.76);
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

/** 0 at the advancing lit edge (the hottest segment), 1 at the column base. */
function tipDistance(
  row: number,
  litRows: number,
  rows: number,
  alignment: SpectrumRenderEnvironment['alignment'],
): number {
  if (litRows <= 1) return 0;
  if (alignment === 'top') return 1 - (row + 1) / litRows;
  if (alignment === 'bottom') return (row - (rows - litRows)) / (litRows - 1);
  const normalizedDistance = Math.abs((row + 0.5) / rows - 0.5) * 2;
  return clamp01(1 - normalizedDistance / Math.max(1 / rows, litRows / rows));
}

class PhosphorVisual implements AudioVisual {
  readonly id = PHOSPHOR_SPECTRUM_ID;
  readonly kind = 'spectrum' as const;
  readonly supportsAfterimage = true;
  readonly supportedLayouts = Object.freeze(['linear'] as const);

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

    const grid = resolvePhosphorGrid(params.density);
    const targets = resolveTargets(frame, params, environment, grid.columns);
    const smoothing = clamp01(params.smoothing);
    const persistence = clamp01(params.afterimageStrength ?? 0);
    if (this.displayedLevels.length !== grid.columns) {
      this.displayedLevels = [...targets];
      this.trailLevels = [...targets];
    } else {
      // CHANGED: the level itself now falls with a fast meter ballistic, while a separate slower
      //          trail envelope stores the light and decays behind it as a dim afterglow band.
      // WHY: putting the whole 0.6 s persistence on the level made columns sink as sluggish
      //      blocks — real phosphor extinguishes the segment quickly but the glow lingers above.
      for (let index = 0; index < grid.columns; index += 1) {
        const current = this.displayedLevels[index] ?? 0;
        const target = targets[index] ?? 0;
        const timeConstant = target >= current
          ? 0.02 + smoothing * 0.055
          : 0.07 + smoothing * 0.3;
        const follow = this.elapsedSeconds > 0
          ? 1 - Math.exp(-this.elapsedSeconds / timeConstant)
          : smoothing <= 0 ? 1 : 0;
        this.displayedLevels[index] = current + (target - current) * follow;

        const trail = this.trailLevels[index] ?? 0;
        const displayed = this.displayedLevels[index] ?? 0;
        const trailTimeConstant = displayed >= trail
          ? 0.03
          : 0.18 + persistence * 0.85;
        const trailFollow = this.elapsedSeconds > 0
          ? 1 - Math.exp(-this.elapsedSeconds / trailTimeConstant)
          : smoothing <= 0 ? 1 : 0;
        this.trailLevels[index] = trail + (displayed - trail) * trailFollow;
      }
    }
    this.elapsedSeconds = 0;

    const availableWidth = canvas.width * 0.74;
    const gridHeight = canvas.height * 0.66;
    const slotWidth = availableWidth / grid.columns;
    const slotHeight = gridHeight / grid.rows;
    const highContrast = params.highContrast === true;
    const reduceMotion = environment.reduceMotion;
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
    const aberrationOffset = reduceMotion || highContrast
      ? 0
      : 0.7 + clamp01(params.intensity) * 1.6 + (frame.transient ? 0.8 : 0);
    const softLight = !highContrast && !reduceMotion;

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

    // CHANGED: one shadow-blurred backing rect per lit column blooms the whole run into the glass.
    // WHY: crisp zero-blur blocks read as an LCD; phosphor light visibly bleeds past the segment
    //      mask, and a single per-column pass buys that bloom for ≤24 extra rects per frame.
    if (softLight) {
      for (let column = 0; column < grid.columns; column += 1) {
        const level = clamp01(this.displayedLevels[column] ?? 0);
        const litRows = Math.min(grid.rows, Math.ceil(level * grid.rows));
        if (litRows <= 0) continue;
        const run = this.resolveLitRun(litRows, grid.rows, environment.alignment);
        const x = startX + column * slotWidth + gap / 2;
        const y = startY + run.firstRow * slotHeight + gap / 2;
        const height = (run.lastRow - run.firstRow) * slotHeight + cellHeight;
        ctx.globalAlpha = 1;
        ctx.fillStyle = colorWithAlpha(tint, 0.08 + level * 0.1);
        ctx.shadowColor = tint;
        ctx.shadowBlur = (5 + level * 9) * intensity;
        ctx.fillRect(x, y, cellWidth, height);
      }
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
    }

    for (let column = 0; column < grid.columns; column += 1) {
      const level = clamp01(this.displayedLevels[column] ?? 0);
      const trailLevel = clamp01(this.trailLevels[column] ?? 0);
      const litRows = Math.min(grid.rows, Math.ceil(level * grid.rows));
      const ghostRows = softLight
        ? Math.min(grid.rows, Math.ceil(trailLevel * grid.rows))
        : litRows;
      const x = startX + column * slotWidth + gap / 2;
      for (let row = 0; row < grid.rows; row += 1) {
        const lit = isLitSegment(row, litRows, grid.rows, environment.alignment);
        if (!lit) {
          // CHANGED: segments between the fallen level and the slower trail render as afterglow.
          // WHY: this dim, decaying band above the live column is the actual phosphor-decay
          //      signature; without it persistence is invisible whenever the level moves.
          if (ghostRows > litRows
            && isLitSegment(row, ghostRows, grid.rows, environment.alignment)) {
            const y = startY + row * slotHeight + gap / 2;
            const span = Math.max(1, ghostRows - litRows);
            const depth = clamp01(tipDistance(row, ghostRows, grid.rows, environment.alignment)
              * ghostRows / span);
            // depth ≈ 0 at the ghost tip (oldest light) and ≈ 1 beside the live column (freshest).
            ctx.globalAlpha = clamp01((0.1 + depth * 0.2) * (0.4 + persistence * 0.6) * intensity);
            ctx.fillStyle = tint;
            ctx.fillRect(x, y, cellWidth, cellHeight);
          }
          continue;
        }
        const y = startY + row * slotHeight + gap / 2;
        const heat = 1 - tipDistance(row, litRows, grid.rows, environment.alignment) * 0.55;
        // CHANGED: brightness now ramps toward the advancing tip instead of the column base.
        // WHY: the newest segment is the one being struck by the beam — a flat column with a
        //      slightly brighter base read as upside-down and hid all level motion.
        const alpha = clamp01((0.26 + level * 0.28 + heat * 0.48) * intensity);

        if (aberrationOffset > 0 && heat > 0.9) {
          // Misconvergence fringes belong at the advancing edge only; repeating them under
          // every interior cell doubled the paint cost and muddied the fill toward gray.
          ctx.globalAlpha = 0.2 + level * 0.18;
          ctx.fillStyle = 'rgba(255, 70, 92, 0.72)';
          ctx.fillRect(x - aberrationOffset, y, cellWidth, cellHeight);
          ctx.fillStyle = 'rgba(54, 188, 255, 0.68)';
          ctx.fillRect(x + aberrationOffset, y, cellWidth, cellHeight);
        }

        ctx.globalAlpha = highContrast ? 1 : alpha;
        ctx.fillStyle = tint;
        ctx.fillRect(x, y, cellWidth, cellHeight);

        if (softLight && heat > 0.9) {
          // A hot cap on the tip segment: the beam dwell point burns toward white.
          ctx.globalAlpha = clamp01((0.24 + level * 0.5) * intensity);
          ctx.fillStyle = hotTint;
          ctx.fillRect(x, y, cellWidth, Math.max(1, cellHeight * 0.45));
        }

        const bevel = Math.min(highContrast ? 2 : 1, cellHeight / 3);
        ctx.fillStyle = hotTint;
        ctx.globalAlpha = highContrast ? 0.92 : 0.42 + heat * 0.24;
        ctx.fillRect(x, y, cellWidth, bevel);
        ctx.fillStyle = shadowTint;
        ctx.globalAlpha = highContrast ? 0.88 : 0.62;
        ctx.fillRect(x, y + cellHeight - bevel, cellWidth, bevel);
      }
    }

    // One horizontal pass per row suggests a scanline mask without per-pixel noise.
    if (!highContrast) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.24)';
      // CHANGED: the mask rows are actually visible now (0.32 → 0.55 effective weight).
      // WHY: at 0.077 effective alpha the scanline pass changed nothing on screen.
      ctx.globalAlpha = 0.55;
      for (let row = 1; row < grid.rows; row += 1) {
        ctx.fillRect(startX, startY + row * slotHeight - 0.5, availableWidth, 1);
      }
    }

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
  }

  /** Contiguous lit row span for the column bloom pass (top/bottom/center all form one band). */
  private resolveLitRun(
    litRows: number,
    rows: number,
    alignment: SpectrumRenderEnvironment['alignment'],
  ): { firstRow: number; lastRow: number } {
    let firstRow = rows - 1;
    let lastRow = 0;
    for (let row = 0; row < rows; row += 1) {
      if (!isLitSegment(row, litRows, rows, alignment)) continue;
      if (row < firstRow) firstRow = row;
      if (row > lastRow) lastRow = row;
    }
    return firstRow > lastRow ? { firstRow: 0, lastRow: 0 } : { firstRow, lastRow };
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
