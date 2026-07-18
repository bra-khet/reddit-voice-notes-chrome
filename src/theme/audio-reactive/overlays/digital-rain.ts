import type {
  AudioVisual,
  AudioVisualDefinition,
  AudioVisualRenderEnvironment,
  AudioVizFrame,
  LayoutMode,
  VisualizerParams,
} from '@/src/theme/audio-reactive';
import { colorWithAlpha, mixVisualColors, resolveVisualPalette } from '../palette';

export const DIGITAL_RAIN_ID = 'digital-rain' as const;
export const DIGITAL_RAIN_MIN_COLUMNS = 14;
export const DIGITAL_RAIN_MAX_COLUMNS = 32;
export const DIGITAL_RAIN_MIN_ROWS = 9;
export const DIGITAL_RAIN_MAX_ROWS = 18;
export const DIGITAL_RAIN_MAX_GLYPHS = DIGITAL_RAIN_MAX_COLUMNS * DIGITAL_RAIN_MAX_ROWS;
/** Hard per-lane lit-run ceiling (head + fading trail cells). */
export const DIGITAL_RAIN_MAX_TRAIL_CELLS = 9;
/** One bounded stream run per lane plus one horizon/axis accent. */
export const DIGITAL_RAIN_MAX_ELEMENTS = DIGITAL_RAIN_MAX_COLUMNS * DIGITAL_RAIN_MAX_TRAIL_CELLS + 1;

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

/**
 * BUG FIX: Digital Rain global-step strobe filled the screen and failed the 120 s size gate
 * Fix: The single shared propagation accumulator stepped every column at the same instant and
 *      re-derived every visible glyph identity per generation, so the whole lattice mutated in
 *      sync (~7×/s) — visually "stationary changing characters" and an entropy bomb for the
 *      encoder (base MP4 >30 MiB before 2:00). Replaced with per-lane streams: fractional
 *      per-lane speeds, seeded per-lane pauses that erode the tail (trailing effect), bounded
 *      lit runs, and glyph identity that is stable along the trail (only head cells shimmer).
 */
class DigitalRainVisual implements AudioVisual {
  readonly id = DIGITAL_RAIN_ID;
  readonly kind = 'overlay' as const;
  readonly supportedLayouts = Object.freeze(['linear', 'centered', 'radial'] as const);

  private readonly head = new Float32Array(DIGITAL_RAIN_MAX_COLUMNS);
  private readonly tail = new Float32Array(DIGITAL_RAIN_MAX_COLUMNS);
  private readonly speed = new Float32Array(DIGITAL_RAIN_MAX_COLUMNS);
  private readonly strength = new Float32Array(DIGITAL_RAIN_MAX_COLUMNS);
  private readonly trailLength = new Float32Array(DIGITAL_RAIN_MAX_COLUMNS);
  /** Pause timer while active; respawn cooldown while inactive. */
  private readonly holdTimer = new Float32Array(DIGITAL_RAIN_MAX_COLUMNS);
  private readonly streamId = new Int32Array(DIGITAL_RAIN_MAX_COLUMNS);
  private readonly active = new Uint8Array(DIGITAL_RAIN_MAX_COLUMNS);

  private pendingDt = 0;
  private lastLayout: LayoutMode | null = null;
  private lastLanes = 0;
  private lastDepth = 0;
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
    const lanes = layout === 'centered' ? shape.rows : shape.columns;
    const depth = layout === 'centered' ? shape.columns : shape.rows;
    if (layout !== this.lastLayout || lanes !== this.lastLanes || depth !== this.lastDepth) {
      this.resetStreams();
      this.lastLayout = layout;
      this.lastLanes = lanes;
      this.lastDepth = depth;
    }

    const reduceMotion = environment?.reduceMotion === true;
    if (reduceMotion) {
      this.drawReducedMotion(ctx, canvas, frame, params, layout, shape);
      this.pendingDt = 0;
      return;
    }

    const previewTide = environment?.amplitudeMode === 'preview'
      ? 0.12 + Math.sin(frame.timeMs / 1000 * 0.83) * 0.05
      : 0;

    if (!this.primed) {
      this.primeStreams(frame, params, lanes, depth, previewTide);
      this.primed = true;
    }

    this.advanceStreams(frame, params, lanes, depth, previewTide, this.pendingDt);
    this.pendingDt = 0;

    this.drawStreams(ctx, canvas, frame, params, layout, shape, lanes, depth);
  }

  private resetStreams(): void {
    this.active.fill(0);
    this.head.fill(0);
    this.tail.fill(0);
    this.holdTimer.fill(0);
    this.strength.fill(0);
    this.streamId.fill(0);
    this.primed = false;
  }

  private laneDrive(
    frame: AudioVizFrame,
    params: VisualizerParams,
    lane: number,
    lanes: number,
    previewTide: number,
  ): number {
    const bandIndex = Math.floor(lane / Math.max(1, lanes - 1) * (frame.bands.length - 1));
    const spectral = weightedBand(frame, bandIndex, params);
    const sensitivity = 0.62 + clamp01(params.sensitivity) * 1.35;
    return clamp01((spectral * 0.7 + clamp01(frame.energy) * 0.3 + previewTide) * sensitivity);
  }

  private spawnStream(lane: number, depth: number, drive: number, prime: boolean): void {
    const sid = this.streamId[lane] ?? 0;
    // CHANGED: fractional per-lane speeds and trail lengths are seeded per (lane, stream pass).
    // WHY: every respawn re-rolls the lane so columns drift further out of phase over time.
    this.speed[lane] = 2.2 + seededUnit(lane, sid * 3 + 7) * 3.6;
    this.trailLength[lane] = 5.5 + seededUnit(lane, sid + 29) * 2.5;
    this.strength[lane] = Math.max(prime ? 0.5 : 0.45, drive);
    this.holdTimer[lane] = 0;
    this.active[lane] = 1;
    if (prime) {
      const head = 0.6 + seededUnit(lane, sid + 43) * Math.max(1, depth - 1);
      this.head[lane] = head;
      this.tail[lane] = head - Math.min(this.trailLength[lane] ?? 0, head);
    } else {
      const entry = -(seededUnit(lane, sid + 17) * 2.2);
      this.head[lane] = entry;
      this.tail[lane] = entry;
    }
  }

  private primeStreams(
    frame: AudioVizFrame,
    params: VisualizerParams,
    lanes: number,
    depth: number,
    previewTide: number,
  ): void {
    for (let lane = 0; lane < lanes; lane += 1) {
      const drive = this.laneDrive(frame, params, lane, lanes, previewTide);
      const gate = 0.14 + seededUnit(lane, 3) * 0.3;
      if (drive >= gate) this.spawnStream(lane, depth, drive, true);
    }
  }

  private advanceStreams(
    frame: AudioVizFrame,
    params: VisualizerParams,
    lanes: number,
    depth: number,
    previewTide: number,
    dt: number,
  ): void {
    for (let lane = 0; lane < lanes; lane += 1) {
      const drive = this.laneDrive(frame, params, lane, lanes, previewTide);
      const sid = this.streamId[lane] ?? 0;

      if (this.active[lane] !== 1) {
        this.holdTimer[lane] = Math.max(0, (this.holdTimer[lane] ?? 0) - dt);
        const gate = 0.26 + seededUnit(lane, sid) * 0.5;
        if (frame.transient && seededUnit(lane, sid + 11) > 0.42) {
          this.spawnStream(lane, depth, Math.max(0.72, drive), false);
        } else if (this.holdTimer[lane] === 0 && drive >= gate) {
          this.spawnStream(lane, depth, drive, false);
        }
        continue;
      }

      this.strength[lane] = Math.max(drive, (this.strength[lane] ?? 0) - dt * 0.55);
      if (frame.transient) {
        this.strength[lane] = Math.max(this.strength[lane] ?? 0, Math.min(1, drive + 0.25));
      }

      const advanceRate = (this.speed[lane] ?? 3) * (0.55 + drive * 0.95);
      const previousHeadCell = Math.floor(this.head[lane] ?? 0);
      const paused = (this.holdTimer[lane] ?? 0) > 0;
      if (paused) {
        this.holdTimer[lane] = Math.max(0, (this.holdTimer[lane] ?? 0) - dt);
      } else {
        this.head[lane] = (this.head[lane] ?? 0) + advanceRate * dt;
      }
      // CHANGED: the tail keeps advancing while the head pauses, eroding the lit run.
      // WHY: a paused lane must visibly "trail off" instead of freezing as a solid bar.
      const run = (this.head[lane] ?? 0) - (this.tail[lane] ?? 0);
      const tailRate = run >= (this.trailLength[lane] ?? 0) ? 1 : 0.8;
      this.tail[lane] = Math.min(
        this.head[lane] ?? 0,
        (this.tail[lane] ?? 0) + advanceRate * tailRate * dt,
      );

      const headCell = Math.floor(this.head[lane] ?? 0);
      if (!paused && headCell !== previousHeadCell) {
        const roll = seededUnit(lane * 31 + headCell, sid + 13);
        if (roll < 0.09 + (1 - drive) * 0.14) {
          this.holdTimer[lane] = 0.12 + seededUnit(lane, headCell + sid) * 0.55;
        }
      }

      if ((this.tail[lane] ?? 0) >= depth) {
        this.active[lane] = 0;
        this.streamId[lane] = sid + 1;
        this.holdTimer[lane] = 0.15 + seededUnit(lane, sid + 5) * 1.15;
      }
    }
  }

  private drawStreams(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    frame: AudioVizFrame,
    params: VisualizerParams,
    layout: LayoutMode,
    shape: DigitalRainGridShape,
    lanes: number,
    depth: number,
  ): void {
    const palette = resolveVisualPalette(params.color);
    const highContrast = params.highContrast === true;
    const minDimension = Math.max(24, Math.min(canvas.width, canvas.height));
    const fontSize = layout === 'radial'
      ? Math.max(7, minDimension / (shape.rows * 1.32))
      : Math.max(8, Math.min(canvas.width / shape.columns, canvas.height / shape.rows) * 0.78);
    const trailFont = `500 ${fontSize}px ui-monospace, SFMono-Regular, Consolas, monospace`;
    const headFont = `700 ${fontSize}px ui-monospace, SFMono-Regular, Consolas, monospace`;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalCompositeOperation = highContrast ? 'source-over' : 'lighter';

    for (let lane = 0; lane < lanes; lane += 1) {
      if (this.active[lane] !== 1) continue;
      const head = this.head[lane] ?? 0;
      const tail = this.tail[lane] ?? 0;
      const trail = this.trailLength[lane] ?? 0;
      const strength = this.strength[lane] ?? 0;
      const sid = this.streamId[lane] ?? 0;
      const headCell = Math.floor(head);
      const start = Math.min(headCell, depth - 1);
      let cells = 0;
      for (let cell = start; cell >= 0 && cells < DIGITAL_RAIN_MAX_TRAIL_CELLS; cell -= 1) {
        if (cell < tail) break;
        const distance = head - cell;
        if (distance > trail) break;
        const intensity = strength * Math.max(0, 1 - distance / (trail + 0.6));
        if (intensity < (highContrast ? 0.16 : 0.045)) continue;
        cells += 1;
        const isHead = cell === headCell && head < depth;
        // CHANGED: glyph identity is frozen along the trail; only the head shimmers.
        // WHY: full-lattice glyph churn strobed visually and inflated the encoded stream.
        const shimmer = distance < 1.4 ? Math.floor(head * 3) : 0;
        const column = layout === 'centered' ? cell : lane;
        const row = layout === 'centered' ? lane : cell;
        this.drawGlyph(
          ctx, canvas, column, row, intensity, isHead,
          glyphFor(column, row, sid * 13 + shimmer),
          palette, params, layout, minDimension, shape,
          isHead ? headFont : trailFont,
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
    shape: DigitalRainGridShape,
  ): void {
    const palette = resolveVisualPalette(params.color);
    const minDimension = Math.max(24, Math.min(canvas.width, canvas.height));
    const fontSize = layout === 'radial'
      ? Math.max(7, minDimension / (shape.rows * 1.32))
      : Math.max(8, Math.min(canvas.width / shape.columns, canvas.height / shape.rows) * 0.78);
    const trailFont = `500 ${fontSize}px ui-monospace, SFMono-Regular, Consolas, monospace`;
    const headFont = `700 ${fontSize}px ui-monospace, SFMono-Regular, Consolas, monospace`;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalCompositeOperation = params.highContrast ? 'source-over' : 'lighter';
    for (let row = 0; row < shape.rows; row += 1) {
      for (let column = 0; column < shape.columns; column += 1) {
        const bandIndex = (column * 5 + row * 3) % frame.bands.length;
        const audio = weightedBand(frame, bandIndex, params);
        const pattern = seededUnit(column + row * shape.columns, 23);
        const activation = clamp01(0.16 + frame.energy * 0.35 + audio * 0.38 - pattern * 0.42);
        if (activation < (params.highContrast ? 0.2 : 0.08)) continue;
        const isHead = activation > 0.76;
        this.drawGlyph(
          ctx, canvas, column, row, activation, isHead, glyphFor(column, row, 0),
          palette, params, layout, minDimension, shape,
          isHead ? headFont : trailFont,
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
    isHead: boolean,
    glyph: string,
    palette: readonly string[],
    params: VisualizerParams,
    layout: LayoutMode,
    minDimension: number,
    shape: DigitalRainGridShape,
    font: string,
  ): void {
    const highContrast = params.highContrast === true;
    const color = palette[(column + row) % palette.length] ?? '#7ad151';
    const lit = isHead ? mixVisualColors(color, '#ffffff', highContrast ? 0.72 : 0.5) : color;
    const opacity = highContrast ? 0.78 + activation * 0.22 : 0.12 + activation ** 0.72 * 0.76;
    ctx.font = font;
    ctx.fillStyle = colorWithAlpha(lit, opacity);
    // CHANGED: only head glyphs carry a glow; trail cells draw blur-free.
    // WHY: per-glyph shadow across the lattice was the single hottest paint cost.
    ctx.shadowColor = highContrast || !isHead ? 'transparent' : colorWithAlpha(color, 0.72);
    ctx.shadowBlur = highContrast || !isHead ? 0 : 9;

    if (layout === 'radial') {
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const innerRadius = minDimension * 0.075;
      const outerRadius = minDimension * 0.48;
      const radius = innerRadius + (row + 0.5) / shape.rows * (outerRadius - innerRadius);
      const angle = -Math.PI / 2 + column / shape.columns * Math.PI * 2;
      ctx.save();
      ctx.translate(centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius);
      ctx.rotate(angle + Math.PI / 2);
      ctx.fillText(glyph, 0, 0);
      ctx.restore();
      return;
    }

    const x = (column + 0.5) / shape.columns * canvas.width;
    const y = (row + 0.5) / shape.rows * canvas.height;
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
    const alpha = highContrast ? 0.72 : 0.12 + energy * 0.18;
    ctx.beginPath();
    if (layout === 'radial') {
      ctx.arc(canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) * 0.065, 0, Math.PI * 2);
      ctx.strokeStyle = colorWithAlpha(color, alpha);
    } else if (layout === 'centered') {
      ctx.moveTo(1, 0);
      ctx.lineTo(1, canvas.height);
      ctx.strokeStyle = highContrast
        ? colorWithAlpha(color, alpha)
        : this.axisTaperGradient(ctx, 0, 0, 0, canvas.height, color, alpha);
    } else {
      ctx.moveTo(0, 1);
      ctx.lineTo(canvas.width, 1);
      ctx.strokeStyle = highContrast
        ? colorWithAlpha(color, alpha)
        : this.axisTaperGradient(ctx, 0, 0, canvas.width, 0, color, alpha);
    }
    ctx.lineWidth = highContrast ? 1.5 : 0.75;
    ctx.shadowBlur = 0;
    ctx.stroke();
  }

  // CHANGED: the axis accent fades out toward both line ends instead of cutting off sharp.
  // WHY: QA flagged raw hard-edged line segments across the atmosphere catalog (§3 general note).
  private axisTaperGradient(
    ctx: CanvasRenderingContext2D,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color: string,
    peakAlpha: number,
  ): CanvasGradient {
    const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
    gradient.addColorStop(0, colorWithAlpha(color, 0));
    gradient.addColorStop(0.12, colorWithAlpha(color, peakAlpha));
    gradient.addColorStop(0.88, colorWithAlpha(color, peakAlpha));
    gradient.addColorStop(1, colorWithAlpha(color, 0));
    return gradient;
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
