import {
  ANALYSER_FFT_SIZE,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  WAVEFORM_TARGET_FPS,
} from '@/src/utils/constants';
import {
  backgroundNeedsImage,
  drawThemeBackground,
  loadBackgroundImage,
  type WaveformTheme,
} from '@/src/theme';
import { DEFAULT_THEME_ID, getThemeById } from '@/src/theme/presets';

const FRAME_INTERVAL_MS = 1000 / WAVEFORM_TARGET_FPS;
const BAR_COUNT = 32;
const MIN_BAR_HEIGHT = 4;

interface BarLayout {
  barWidth: number;
  spacing: number;
  startX: number;
}

function computeBarLayout(canvasWidth: number, theme: WaveformTheme): BarLayout {
  const { width, spacing } = theme.bars;
  const totalWidth = BAR_COUNT * width + (BAR_COUNT - 1) * spacing;
  const startX = Math.max(0, (canvasWidth - totalWidth) / 2);
  return { barWidth: width, spacing, startX };
}

function fillRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  if (r <= 0) {
    ctx.fillRect(x, y, width, height);
    return;
  }

  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
}

function applyBarColor(baseColor: string, normalized: number): string {
  if (baseColor.startsWith('#') && (baseColor.length === 7 || baseColor.length === 4)) {
    const alpha = 0.35 + normalized * 0.65;
    const hex = baseColor.length === 4
      ? `#${baseColor[1]}${baseColor[1]}${baseColor[2]}${baseColor[2]}${baseColor[3]}${baseColor[3]}`
      : baseColor;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return baseColor;
}

export class WaveformRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly analyser: AnalyserNode;
  private readonly frequencyData: Uint8Array;
  private theme: WaveformTheme;
  private backgroundImage: HTMLImageElement | null = null;
  private backgroundLoadPromise: Promise<void> = Promise.resolve();
  private rafId = 0;
  private lastFrameAt = 0;
  private running = false;

  constructor(analyser: AnalyserNode, theme: WaveformTheme = getThemeById(DEFAULT_THEME_ID)) {
    this.analyser = analyser;
    this.analyser.fftSize = ANALYSER_FFT_SIZE;
    this.theme = theme;

    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_WIDTH;
    this.canvas.height = CANVAS_HEIGHT;

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create waveform canvas context.');
    this.ctx = ctx;

    this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
    this.backgroundLoadPromise = this.loadBackgroundIfNeeded();
  }

  /** Wait for bundled background assets before recording — preview uses the same canvas. */
  async whenReady(): Promise<void> {
    await this.backgroundLoadPromise;
  }

  setTheme(theme: WaveformTheme): void {
    this.theme = theme;
    this.backgroundLoadPromise = this.loadBackgroundIfNeeded();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameAt = 0;
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  private async loadBackgroundIfNeeded(): Promise<void> {
    const { background } = this.theme;
    if (!backgroundNeedsImage(background) || typeof background.value !== 'string') {
      this.backgroundImage = null;
      return;
    }

    this.backgroundImage = await loadBackgroundImage(background.value);
  }

  private tick = (timestamp: number): void => {
    if (!this.running) return;

    if (timestamp - this.lastFrameAt >= FRAME_INTERVAL_MS) {
      this.drawFrame();
      this.lastFrameAt = timestamp;
    }

    this.rafId = requestAnimationFrame(this.tick);
  };

  private drawFrame(): void {
    const { ctx, canvas, theme } = this;
    this.analyser.getByteFrequencyData(this.frequencyData as Uint8Array<ArrayBuffer>);

    drawThemeBackground(ctx, canvas, theme, this.backgroundImage);

    const step = Math.max(1, Math.floor(this.frequencyData.length / BAR_COUNT));
    const centerY = canvas.height / 2;
    const maxBarHeight = canvas.height * 0.7;
    const layout = computeBarLayout(canvas.width, theme);
    const { barWidth, spacing, startX } = layout;
    const { cornerRadius, glow } = theme.bars;

    for (let i = 0; i < BAR_COUNT; i += 1) {
      const value = this.frequencyData[i * step] ?? 0;
      const normalized = value / 255;
      const barHeight = Math.max(MIN_BAR_HEIGHT, normalized * maxBarHeight);
      const x = startX + i * (barWidth + spacing);
      const y = centerY - barHeight / 2;

      ctx.fillStyle = applyBarColor(theme.colors.bar, normalized);
      ctx.shadowColor = theme.colors.glow;
      ctx.shadowBlur = normalized * glow;
      fillRoundedRect(ctx, x, y, barWidth, barHeight, cornerRadius);
    }

    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
  }
}