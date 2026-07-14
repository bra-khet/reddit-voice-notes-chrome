import type {
  AudioVisual,
  AudioVisualDefinition,
  AudioVisualRenderEnvironment,
  AudioVizFrame,
  LayoutMode,
  VisualizerParams,
} from '@/src/theme/audio-reactive';
import { BoundedActivationGrid } from '@/src/theme/audio-reactive';
import { colorWithAlpha, mixVisualColors, resolveVisualPalette } from '../palette';

export const DIGITAL_RAIN_ID = 'digital-rain' as const;
export const DIGITAL_RAIN_MIN_COLUMNS = 14;
export const DIGITAL_RAIN_MAX_COLUMNS = 32;
export const DIGITAL_RAIN_MIN_ROWS = 9;
export const DIGITAL_RAIN_MAX_ROWS = 18;
export const DIGITAL_RAIN_MAX_GLYPHS = DIGITAL_RAIN_MAX_COLUMNS * DIGITAL_RAIN_MAX_ROWS;
/** One glyph per cell plus one bounded horizon/axis accent. */
export const DIGITAL_RAIN_MAX_ELEMENTS = DIGITAL_RAIN_MAX_GLYPHS + 1;

const DIGITAL_RAIN_GLYPHS = Object.freeze([
  '0', '1', '2', '3', '7', '9', 'A', 'E', 'F', 'K', 'M', 'R', 'V', 'X',
  'ア', 'イ', 'ウ', 'カ', 'キ', 'サ', 'シ', 'ナ', 'ミ', 'ム', '◆', '◇', '+', '/', '\\', ':',
]);

export interface DigitalRainGridShape {
  columns: number;
  rows: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function resolveLayout(params: VisualizerParams): LayoutMode {
  return params.layoutMode === 'radial' || params.layoutMode === 'centered'
    ? params.layoutMode
    : 'linear';
}

export function resolveDigitalRainGrid(density: number): DigitalRainGridShape {
  const safeDensity = clamp01(density);
  return {
    columns: Math.round(DIGITAL_RAIN_MIN_COLUMNS
      + safeDensity * (DIGITAL_RAIN_MAX_COLUMNS - DIGITAL_RAIN_MIN_COLUMNS)),
    rows: Math.round(DIGITAL_RAIN_MIN_ROWS
      + safeDensity * (DIGITAL_RAIN_MAX_ROWS - DIGITAL_RAIN_MIN_ROWS)),
  };
}

function weightedBand(frame: AudioVizFrame, index: number, params: VisualizerParams): number {
  const bandIndex = ((index % frame.bands.length) + frame.bands.length) % frame.bands.length;
  const band = clamp01(frame.bands[bandIndex] ?? 0);
  const normalized = bandIndex / Math.max(1, frame.bands.length - 1);
  const weight = normalized < 1 / 3
    ? params.bassWeight ?? 1
    : normalized < 2 / 3
      ? params.midWeight ?? 1
      : params.trebleWeight ?? 1;
  return clamp01(band * weight);
}

function seededUnit(index: number, salt: number): number {
  const value = Math.sin(index * 78.233 + salt * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function glyphFor(column: number, row: number, generation: number): string {
  const index = Math.abs(Math.floor(
    column * 17 + row * 31 + generation * 7 + seededUnit(column + row * 41, 5) * 19,
  )) % DIGITAL_RAIN_GLYPHS.length;
  return DIGITAL_RAIN_GLYPHS[index] ?? '0';
}

class DigitalRainVisual implements AudioVisual {
  readonly id = DIGITAL_RAIN_ID;
  readonly kind = 'overlay' as const;
  readonly supportedLayouts = Object.freeze(['linear', 'centered', 'radial'] as const);

  private readonly grid = new BoundedActivationGrid(
    DIGITAL_RAIN_MAX_COLUMNS,
    DIGITAL_RAIN_MAX_ROWS,
  );
  private pendingDt = 0;
  private accumulator = 0;
  private generation = 0;
  private lastLayout: LayoutMode | null = null;
  private primed = false;

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
    const shape = resolveDigitalRainGrid(params.density);
    const layout = resolveLayout(params);
    const topologyChanged = this.grid.configure(shape.columns, shape.rows) || this.lastLayout !== layout;
    if (topologyChanged) {
      this.grid.clear();
      this.accumulator = 0;
      this.generation = 0;
      this.primed = false;
      this.lastLayout = layout;
    }

    const reduceMotion = environment?.reduceMotion === true;
    if (reduceMotion) {
      this.drawReducedMotion(ctx, canvas, frame, params, layout);
      this.pendingDt = 0;
      return;
    }

    if (!this.primed) {
      this.seedSource(frame, params, environment, layout, true);
      this.propagate(layout, params, true);
      this.primed = true;
    }

    const secondsPerStep = 0.11 + clamp01(params.smoothing) * 0.09;
    this.accumulator += this.pendingDt;
    // BUG FIX: Digital Rain could miss one-frame transients between grid steps
    // Fix: Inject transient cells immediately; fixed-rate propagation still advances on its bounded cadence.
    if (frame.transient) this.seedSource(frame, params, environment, layout, false);
    let steps = 0;
    while (this.accumulator >= secondsPerStep && steps < 2) {
      this.seedSource(frame, params, environment, layout, false);
      this.propagate(layout, params, false);
      this.accumulator -= secondsPerStep;
      this.generation += 1;
      steps += 1;
    }
    this.pendingDt = 0;

    this.drawGrid(ctx, canvas, frame, params, layout);
  }

  private propagate(layout: LayoutMode, params: VisualizerParams, prime: boolean): void {
    this.grid.propagate({
      direction: layout === 'centered' ? 'right' : 'down',
      decay: prime ? 0.54 : 0.42 + clamp01(params.smoothing) * 0.25,
      transfer: prime ? 0.92 : 0.88 + clamp01(params.intensity) * 0.1,
      spread: prime ? 0.035 : 0.018 + clamp01(params.density) * 0.038,
      threshold: 0.018,
    });
  }

  private seedSource(
    frame: AudioVizFrame,
    params: VisualizerParams,
    environment: AudioVisualRenderEnvironment | undefined,
    layout: LayoutMode,
    prime: boolean,
  ): void {
    const sourceCount = layout === 'centered' ? this.grid.rows : this.grid.columns;
    const previewTide = environment?.amplitudeMode === 'preview'
      ? 0.12 + Math.sin(frame.timeMs / 1000 * 0.83) * 0.05
      : 0;
    const sensitivity = 0.62 + clamp01(params.sensitivity) * 1.35;
    const energy = clamp01(frame.energy);

    for (let source = 0; source < sourceCount; source += 1) {
      const bandIndex = Math.floor(source / Math.max(1, sourceCount - 1) * (frame.bands.length - 1));
      const spectral = weightedBand(frame, bandIndex, params);
      const cadence = seededUnit(source, this.generation + 11);
      const drive = clamp01((spectral * 0.72 + energy * 0.34 + previewTide) * sensitivity);
      const gate = prime ? 0.18 : 0.31 + cadence * 0.42;
      if (drive < gate && !(frame.transient && cadence > 0.42)) continue;
      const strength = frame.transient ? Math.max(0.72, drive) : clamp01(0.3 + drive * 0.7);
      if (layout === 'centered') this.grid.activate(0, source, strength);
      else this.grid.activate(source, 0, strength);

      // BUG FIX: Digital Rain transient fork collapsed into an occupied source edge
      // Fix: Seed one deterministic interior cell as well as the local edge neighbor, still inside the fixed grid.
      if (frame.transient && source % 3 === this.generation % 3) {
        const depthLimit = layout === 'centered' ? this.grid.columns : this.grid.rows;
        const depth = Math.min(depthLimit - 1, 2 + (source + this.generation) % 3);
        if (layout === 'centered') {
          this.grid.activate(0, source + 1, strength * 0.76);
          this.grid.activate(depth, source, strength * 0.86);
        } else {
          this.grid.activate(source + 1, 0, strength * 0.76);
          this.grid.activate(source, depth, strength * 0.86);
        }
      }
    }
  }

  private drawGrid(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    frame: AudioVizFrame,
    params: VisualizerParams,
    layout: LayoutMode,
  ): void {
    const palette = resolveVisualPalette(params.color);
    const highContrast = params.highContrast === true;
    const minDimension = Math.max(24, Math.min(canvas.width, canvas.height));
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalCompositeOperation = highContrast ? 'source-over' : 'lighter';

    for (let row = 0; row < this.grid.rows; row += 1) {
      for (let column = 0; column < this.grid.columns; column += 1) {
        const activation = this.grid.valueAt(column, row);
        if (activation < (highContrast ? 0.16 : 0.055)) continue;
        this.drawGlyph(
          ctx, canvas, column, row, activation, glyphFor(column, row, this.generation),
          palette, params, layout, minDimension,
        );
      }
    }

    this.drawAxisAccent(ctx, canvas, frame, params, layout, palette[0] ?? '#7ad151');
    ctx.restore();
  }

  private drawReducedMotion(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    frame: AudioVizFrame,
    params: VisualizerParams,
    layout: LayoutMode,
  ): void {
    const palette = resolveVisualPalette(params.color);
    const minDimension = Math.max(24, Math.min(canvas.width, canvas.height));
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalCompositeOperation = params.highContrast ? 'source-over' : 'lighter';
    for (let row = 0; row < this.grid.rows; row += 1) {
      for (let column = 0; column < this.grid.columns; column += 1) {
        const bandIndex = (column * 5 + row * 3) % frame.bands.length;
        const audio = weightedBand(frame, bandIndex, params);
        const pattern = seededUnit(column + row * this.grid.columns, 23);
        const activation = clamp01(0.16 + frame.energy * 0.35 + audio * 0.38 - pattern * 0.42);
        if (activation < (params.highContrast ? 0.2 : 0.08)) continue;
        this.drawGlyph(
          ctx, canvas, column, row, activation, glyphFor(column, row, 0),
          palette, params, layout, minDimension,
        );
      }
    }
    this.drawAxisAccent(ctx, canvas, frame, params, layout, palette[0] ?? '#7ad151');
    ctx.restore();
  }

  private drawGlyph(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    column: number,
    row: number,
    activation: number,
    glyph: string,
    palette: readonly string[],
    params: VisualizerParams,
    layout: LayoutMode,
    minDimension: number,
  ): void {
    const highContrast = params.highContrast === true;
    const color = palette[(column + row) % palette.length] ?? '#7ad151';
    const head = activation > 0.76;
    const lit = head ? mixVisualColors(color, '#ffffff', highContrast ? 0.72 : 0.5) : color;
    const opacity = highContrast ? 0.78 + activation * 0.22 : 0.12 + activation ** 0.72 * 0.76;
    const fontSize = layout === 'radial'
      ? Math.max(7, minDimension / (this.grid.rows * 1.32))
      : Math.max(8, Math.min(canvas.width / this.grid.columns, canvas.height / this.grid.rows) * 0.78);
    ctx.font = `${head ? 700 : 500} ${fontSize}px ui-monospace, SFMono-Regular, Consolas, monospace`;
    ctx.fillStyle = colorWithAlpha(lit, opacity);
    ctx.shadowColor = highContrast ? 'transparent' : colorWithAlpha(color, 0.72);
    ctx.shadowBlur = highContrast ? 0 : head ? 9 : 3;

    if (layout === 'radial') {
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const innerRadius = minDimension * 0.075;
      const outerRadius = minDimension * 0.48;
      const radius = innerRadius + (row + 0.5) / this.grid.rows * (outerRadius - innerRadius);
      const angle = -Math.PI / 2 + column / this.grid.columns * Math.PI * 2;
      ctx.save();
      ctx.translate(centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius);
      ctx.rotate(angle + Math.PI / 2);
      ctx.fillText(glyph, 0, 0);
      ctx.restore();
      return;
    }

    const x = (column + 0.5) / this.grid.columns * canvas.width;
    const y = (row + 0.5) / this.grid.rows * canvas.height;
    ctx.fillText(glyph, x, y);
  }

  private drawAxisAccent(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    frame: AudioVizFrame,
    params: VisualizerParams,
    layout: LayoutMode,
    color: string,
  ): void {
    const highContrast = params.highContrast === true;
    const energy = clamp01(frame.energy);
    ctx.beginPath();
    if (layout === 'radial') {
      ctx.arc(canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) * 0.065, 0, Math.PI * 2);
    } else if (layout === 'centered') {
      ctx.moveTo(1, 0);
      ctx.lineTo(1, canvas.height);
    } else {
      ctx.moveTo(0, 1);
      ctx.lineTo(canvas.width, 1);
    }
    ctx.strokeStyle = colorWithAlpha(color, highContrast ? 0.72 : 0.12 + energy * 0.18);
    ctx.lineWidth = highContrast ? 1.5 : 0.75;
    ctx.shadowBlur = 0;
    ctx.stroke();
  }
}

export const DIGITAL_RAIN_VISUAL_DEFINITION: AudioVisualDefinition = Object.freeze({
  id: DIGITAL_RAIN_ID,
  label: 'Digital Rain',
  kind: 'overlay',
  wants: Object.freeze({ bands: true }),
  family: 'cellular-glyph-grid',
  maxElements: DIGITAL_RAIN_MAX_ELEMENTS,
  defaultParams: Object.freeze({
    sensitivity: 0.7,
    intensity: 0.68,
    smoothing: 0.42,
    color: Object.freeze(['#2a788e', '#22a884', '#7ad151', '#fde725']),
    density: 0.56,
    layoutMode: 'linear',
    highContrast: false,
  }),
  create: () => new DigitalRainVisual(),
});
