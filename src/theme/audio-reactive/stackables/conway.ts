import type {
  AudioVisualRenderEnvironment,
  AudioVizFrame,
  LayoutMode,
  StackableEffect,
  StackableEffectDefinition,
  VisualizerParams,
} from '@/src/theme/audio-reactive';
import { BoundedLifeGrid } from '@/src/theme/audio-reactive';
import {
  colorWithAlpha,
  mixVisualColors,
  resolveVisualPalette,
} from '../palette';

export const CONWAY_LIFE_ID = 'conway' as const;
export const CONWAY_LIFE_LABEL = 'Conway Life' as const;
export const CONWAY_LIFE_COLUMNS = 48;
export const CONWAY_LIFE_ROWS = 16;
export const CONWAY_LIFE_MAX_CELLS = CONWAY_LIFE_COLUMNS * CONWAY_LIFE_ROWS;
/** One painted cell per live slot plus one shared boundary accent. */
export const CONWAY_LIFE_MAX_ELEMENTS = CONWAY_LIFE_MAX_CELLS + 1;

type CellOffset = readonly [column: number, row: number];

const LIFE_PATTERNS: readonly (readonly CellOffset[])[] = Object.freeze([
  Object.freeze([[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]] as const), // glider
  Object.freeze([[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]] as const), // R-pentomino
  Object.freeze([[0, 0], [1, 0], [1, 2], [3, 1], [4, 0], [5, 0], [6, 0]] as const), // acorn
  Object.freeze([[0, 0], [1, 0], [2, 0]] as const), // oscillator
]);

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function seededUnit(index: number, salt: number): number {
  const value = Math.sin(index * 73.217 + salt * 19.913) * 43758.5453;
  return value - Math.floor(value);
}

function resolveLayout(params: VisualizerParams): LayoutMode {
  return params.layoutMode === 'radial' || params.layoutMode === 'centered'
    ? params.layoutMode
    : 'linear';
}

export function resolveConwayTickSeconds(smoothing: number): number {
  return 0.08 + clamp01(smoothing) * 0.14;
}

function weightedBandAverage(
  frame: AudioVizFrame,
  start: number,
  end: number,
  weight: number | undefined,
): number {
  let total = 0;
  let count = 0;
  for (let index = start; index < Math.min(end, frame.bands.length); index += 1) {
    total += clamp01(frame.bands[index] ?? 0);
    count += 1;
  }
  return clamp01(count > 0 ? total / count * (weight ?? 1) : 0);
}

function paletteColorAt(palette: readonly string[], amount: number): string {
  if (palette.length === 1) return palette[0] ?? '#ffffff';
  const position = clamp01(amount) * (palette.length - 1);
  const left = Math.min(palette.length - 1, Math.floor(position));
  const right = Math.min(palette.length - 1, left + 1);
  return mixVisualColors(
    palette[left] ?? '#ffffff',
    palette[right] ?? palette[left] ?? '#ffffff',
    position - left,
  );
}

/**
 * CHANGED: Conway Life is a deterministic audio-seeded B3/S23 tapestry on a fixed 48x16 lattice.
 * WHY: the stackable should feel genuinely alive while keeping every generation, cell read, and paint pass bounded for record-time capture.
 */
class ConwayLifeEffect implements StackableEffect {
  readonly id = CONWAY_LIFE_ID;

  private readonly grid = new BoundedLifeGrid(CONWAY_LIFE_COLUMNS, CONWAY_LIFE_ROWS);
  private pendingDt = 0;
  private accumulator = 0;
  private seedSerial = 0;
  private lastLayout: LayoutMode | null = null;
  private wasReducedMotion = false;
  private drive = 0;
  private bassDrive = 0;
  private midDrive = 0;
  private trebleDrive = 0;

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
    const layout = resolveLayout(params);
    if (this.lastLayout !== layout) {
      this.resetLife();
      this.lastLayout = layout;
    }

    const reduceMotion = environment?.reduceMotion === true;
    if (reduceMotion !== this.wasReducedMotion) {
      this.resetLife();
      this.wasReducedMotion = reduceMotion;
    }
    this.resolveAudioDrive(frame, params, environment, reduceMotion);

    const palette = resolveVisualPalette(params.color);
    if (reduceMotion) {
      this.drawReducedMotion(ctx, canvas, frame, params, layout, palette);
      this.pendingDt = 0;
      return;
    }

    if (this.grid.countAlive() === 0 && this.drive > 0.012) {
      this.seedAudioPatterns(frame, params, layout, true);
    }
    if (frame.transient) {
      // CHANGED: a transient stamps several small Life seeds before the next fixed generation.
      // WHY: consonant onsets should be visible immediately without increasing the simulation tick cap.
      this.seedAudioPatterns(frame, params, layout, false, 3);
    }

    const tickSeconds = resolveConwayTickSeconds(params.smoothing);
    this.accumulator += this.pendingDt;
    let steps = 0;
    while (this.accumulator >= tickSeconds && steps < 2) {
      this.seedAudioPatterns(frame, params, layout, false);
      const alive = this.grid.step();
      if (alive < 5 && this.drive > 0.025) this.seedAudioPatterns(frame, params, layout, true);
      this.accumulator -= tickSeconds;
      steps += 1;
    }
    this.accumulator = Math.min(this.accumulator, tickSeconds * 2);
    this.pendingDt = 0;
    this.drawLife(ctx, canvas, frame, params, layout, palette);
  }

  getPerformanceCost(): number {
    return CONWAY_LIFE_MAX_ELEMENTS;
  }

  private resetLife(): void {
    this.grid.clear();
    this.accumulator = 0;
    this.seedSerial = 0;
  }

  private resolveAudioDrive(
    frame: AudioVizFrame,
    params: VisualizerParams,
    environment: AudioVisualRenderEnvironment | undefined,
    reduceMotion: boolean,
  ): void {
    this.bassDrive = weightedBandAverage(frame, 0, 10, params.bassWeight);
    this.midDrive = weightedBandAverage(frame, 10, 22, params.midWeight);
    this.trebleDrive = weightedBandAverage(frame, 22, 32, params.trebleWeight);
    const previewLift = environment?.amplitudeMode === 'preview'
      ? reduceMotion
        ? 0.12
        : 0.105 + Math.sin(frame.timeMs / 1000 * 0.51) * 0.025
      : 0;
    const sensitivity = 0.55 + clamp01(params.sensitivity) * 1.45;
    this.drive = clamp01(
      (clamp01(frame.energy) * 0.28
        + this.bassDrive * 0.18
        + this.midDrive * 0.31
        + this.trebleDrive * 0.23
        + previewLift)
      * sensitivity,
    );
  }

  private seedAudioPatterns(
    frame: AudioVizFrame,
    params: VisualizerParams,
    layout: LayoutMode,
    prime: boolean,
    forcedCount = 0,
  ): void {
    if (this.drive <= 0.008 && forcedCount === 0) return;
    const density = clamp01(params.density);
    const requested = forcedCount > 0
      ? forcedCount
      : prime
        ? 2 + Math.round(density * 3 + this.drive * 2)
        : Math.min(2, Math.floor(this.drive * (1.2 + density * 2.4)));
    const count = Math.min(6, requested);

    for (let seedIndex = 0; seedIndex < count; seedIndex += 1) {
      const serial = this.seedSerial;
      this.seedSerial += 1;
      const bandIndex = (serial * 7 + seedIndex * 11) % frame.bands.length;
      const spectral = clamp01(frame.bands[bandIndex] ?? 0);
      const familyDrive = bandIndex < 10
        ? this.bassDrive
        : bandIndex < 22
          ? this.midDrive
          : this.trebleDrive;
      if (!prime && forcedCount === 0 && spectral + familyDrive < 0.12 + seededUnit(serial, 7) * 0.35) {
        continue;
      }

      const patternIndex = Math.floor(
        seededUnit(serial, 13) * LIFE_PATTERNS.length + familyDrive * 2,
      ) % LIFE_PATTERNS.length;
      const pattern = LIFE_PATTERNS[patternIndex] ?? LIFE_PATTERNS[0] ?? [];
      const maxColumn = Math.max(1, CONWAY_LIFE_COLUMNS - 8);
      const maxRow = Math.max(1, CONWAY_LIFE_ROWS - 4);
      let originColumn = 1 + Math.floor(seededUnit(serial, 17) * maxColumn);
      let originRow = 1 + Math.floor(seededUnit(serial, 23) * maxRow);

      if (layout === 'centered') {
        originColumn = Math.max(1, Math.min(CONWAY_LIFE_COLUMNS - 8,
          Math.round(CONWAY_LIFE_COLUMNS / 2 + (seededUnit(serial, 29) - 0.5) * 18)));
        originRow = Math.max(1, Math.min(CONWAY_LIFE_ROWS - 4,
          Math.round(CONWAY_LIFE_ROWS / 2 + (seededUnit(serial, 31) - 0.5) * 8)));
      } else if (layout === 'radial') {
        originColumn = (serial * 9 + Math.round(this.trebleDrive * 11)) % (CONWAY_LIFE_COLUMNS - 8) + 1;
        originRow = (serial * 3 + Math.round(this.bassDrive * 5)) % (CONWAY_LIFE_ROWS - 4) + 1;
      }

      const mirror = seededUnit(serial, 37) > 0.5;
      for (const [columnOffset, rowOffset] of pattern) {
        const offset = mirror ? 6 - columnOffset : columnOffset;
        this.grid.setAlive(originColumn + offset, originRow + rowOffset);
      }
    }
  }

  private drawLife(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    frame: AudioVizFrame,
    params: VisualizerParams,
    layout: LayoutMode,
    palette: readonly string[],
  ): void {
    const alive = this.grid.countAlive();
    if (alive === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = params.highContrast ? 'source-over' : 'lighter';
    for (let row = 0; row < CONWAY_LIFE_ROWS; row += 1) {
      for (let column = 0; column < CONWAY_LIFE_COLUMNS; column += 1) {
        if (!this.grid.isAlive(column, row)) continue;
        this.drawCell(
          ctx,
          canvas,
          column,
          row,
          this.grid.neighborsAt(column, row),
          frame,
          params,
          layout,
          palette,
          this.grid.generation,
        );
      }
    }
    this.drawBoundary(ctx, canvas, params, layout, palette[0] ?? '#22d3ee');
    ctx.restore();
  }

  private drawReducedMotion(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    frame: AudioVizFrame,
    params: VisualizerParams,
    layout: LayoutMode,
    palette: readonly string[],
  ): void {
    if (this.drive <= 0.01) return;
    let painted = 0;
    ctx.save();
    ctx.globalCompositeOperation = params.highContrast ? 'source-over' : 'lighter';
    const threshold = 0.76 - clamp01(params.density) * 0.18 - this.drive * 0.12;
    for (let row = 0; row < CONWAY_LIFE_ROWS; row += 1) {
      for (let column = 0; column < CONWAY_LIFE_COLUMNS; column += 1) {
        const bandIndex = (column * 3 + row * 5) % frame.bands.length;
        const audio = clamp01(frame.bands[bandIndex] ?? 0);
        const pattern = seededUnit(column + row * CONWAY_LIFE_COLUMNS, 53);
        if (pattern + audio * 0.26 + this.drive * 0.18 < threshold) continue;
        this.drawCell(ctx, canvas, column, row, 2, frame, params, layout, palette, 0);
        painted += 1;
      }
    }
    if (painted > 0) this.drawBoundary(ctx, canvas, params, layout, palette[0] ?? '#22d3ee');
    ctx.restore();
  }

  private drawCell(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    column: number,
    row: number,
    neighbors: number,
    frame: AudioVizFrame,
    params: VisualizerParams,
    layout: LayoutMode,
    palette: readonly string[],
    generation: number,
  ): void {
    const highContrast = params.highContrast === true;
    const texture = seededUnit(column + row * CONWAY_LIFE_COLUMNS, generation + 61);
    const bandIndex = (column * 5 + row * 7) % frame.bands.length;
    const audio = clamp01(frame.bands[bandIndex] ?? 0);
    const heat = clamp01(0.18 + audio * 0.38 + neighbors / 8 * 0.3 + texture * 0.18);
    const baseColor = paletteColorAt(palette, heat);
    const color = neighbors === 3
      ? mixVisualColors(baseColor, '#ffffff', highContrast ? 0.62 : 0.42)
      : baseColor;
    const alpha = highContrast
      ? 0.82 + heat * 0.18
      : (0.24 + heat * 0.66) * (0.62 + clamp01(params.intensity) * 0.55);

    let x: number;
    let y: number;
    let width: number;
    let height: number;
    if (layout === 'radial') {
      const minDimension = Math.max(24, Math.min(canvas.width, canvas.height));
      const angle = -Math.PI / 2 + (column + 0.5) / CONWAY_LIFE_COLUMNS * Math.PI * 2;
      const radius = minDimension * (0.1 + (row + 0.5) / CONWAY_LIFE_ROWS * 0.38);
      const cellSize = Math.max(1.4, minDimension / CONWAY_LIFE_ROWS * 0.24);
      x = canvas.width / 2 + Math.cos(angle) * radius - cellSize / 2;
      y = canvas.height / 2 + Math.sin(angle) * radius - cellSize / 2;
      width = cellSize;
      height = cellSize;
    } else {
      const insetX = layout === 'centered' ? canvas.width * 0.12 : canvas.width * 0.025;
      const insetY = layout === 'centered' ? canvas.height * 0.18 : canvas.height * 0.055;
      const gridWidth = Math.max(1, canvas.width - insetX * 2);
      const gridHeight = Math.max(1, canvas.height - insetY * 2);
      const cellWidth = gridWidth / CONWAY_LIFE_COLUMNS;
      const cellHeight = gridHeight / CONWAY_LIFE_ROWS;
      const gap = highContrast ? 0.16 : 0.24;
      width = Math.max(0.8, cellWidth * (1 - gap));
      height = Math.max(0.8, cellHeight * (1 - gap));
      x = insetX + column * cellWidth + (cellWidth - width) / 2;
      y = insetY + row * cellHeight + (cellHeight - height) / 2;
    }

    ctx.fillStyle = colorWithAlpha(color, clamp01(alpha));
    ctx.shadowColor = highContrast ? 'transparent' : colorWithAlpha(color, 0.86);
    ctx.shadowBlur = highContrast ? 0 : Math.max(2, Math.min(width, height) * (0.75 + heat * 1.35));
    ctx.fillRect(x, y, width, height);
  }

  private drawBoundary(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    params: VisualizerParams,
    layout: LayoutMode,
    color: string,
  ): void {
    const highContrast = params.highContrast === true;
    ctx.beginPath();
    if (layout === 'radial') {
      const minDimension = Math.min(canvas.width, canvas.height);
      ctx.arc(canvas.width / 2, canvas.height / 2, minDimension * 0.095, 0, Math.PI * 2);
      ctx.arc(canvas.width / 2, canvas.height / 2, minDimension * 0.485, 0, Math.PI * 2);
    } else {
      const insetX = layout === 'centered' ? canvas.width * 0.12 : canvas.width * 0.025;
      const insetY = layout === 'centered' ? canvas.height * 0.18 : canvas.height * 0.055;
      ctx.rect(insetX, insetY, canvas.width - insetX * 2, canvas.height - insetY * 2);
    }
    ctx.strokeStyle = colorWithAlpha(color, highContrast ? 0.72 : 0.18 + this.drive * 0.18);
    ctx.lineWidth = highContrast ? 1.5 : 0.75;
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.stroke();
  }
}

export const CONWAY_LIFE_EFFECT_DEFINITION: StackableEffectDefinition = Object.freeze({
  id: CONWAY_LIFE_ID,
  label: CONWAY_LIFE_LABEL,
  maxElements: CONWAY_LIFE_MAX_ELEMENTS,
  defaultParams: Object.freeze({
    sensitivity: 0.68,
    intensity: 0.64,
    smoothing: 0.46,
    density: 0.62,
    color: Object.freeze(['#173b6c', '#2a788e', '#22a884', '#7ad151', '#fde725']),
    layoutMode: 'linear',
    highContrast: false,
  }),
  create: () => new ConwayLifeEffect(),
});
