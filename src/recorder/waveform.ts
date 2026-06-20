import {
  ANALYSER_FFT_SIZE,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  VOICE_FREQ_MAX_HZ,
  VOICE_FREQ_MIN_HZ,
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

/**
 * Compresses a 0-1 normalized amplitude for better visual dynamics on voice.
 * WHY: Raw FFT values for voice have strong low-end tilt; simple /255 leaves
 * high bars tiny. Compression lifts quieter detail without per-bar hard boosts.
 * BUG FIX (waveform dynamics): Previously used direct linear normalize from tiny FFT.
 * Fix: Use exponential-style compression after band aggregation so normal speech
 * populates most of the bar height range, including upper spectrum on sibilance.
 */
function compressForViz(n: number): number {
  if (n <= 0) return 0;
  // k controls how aggressively lows are lifted. Tuned for typical mic speech.
  const k = 4.0;
  // Normalize the curve output to still reach ~1.0 at input=1.
  return (1 - Math.exp(-k * n)) / (1 - Math.exp(-k));
}

/**
 * Compute 32 band values (0-255) by aggregating FFT bins over log-spaced
 * frequencies from VOICE_FREQ_MIN_HZ to VOICE_FREQ_MAX_HZ.
 *
 * VOICE FREQ RANGE: 80 Hz – 16 kHz.
 * BUG FIX: upper spectrum bars never activated (raw low-res linear bins + spectral tilt).
 * Fix: log-band aggregation over voice range + compression.
 *
 * IMPORTANT — revisit before merging the pretty branch:
 * This is deliberately voice-focused (sibilance reaches upper bars now).
 * User requested future UI toggle (music / full spectrum mode).
 * See pretty-branch.md and claude-progress.md "Future audio pipeline & settings".
 * Do not widen without the toggle or the revisit comment will be stale.
 */
function computeBandValues(
  frequencyData: Uint8Array,
  fftSize: number,
  sampleRate: number,
): number[] {
  const binCount = frequencyData.length;
  const nyquist = sampleRate / 2;
  const binHz = nyquist / binCount;

  const bands: number[] = [];
  for (let i = 0; i < BAR_COUNT; i += 1) {
    // Log spacing between min and max
    const t0 = i / BAR_COUNT;
    const t1 = (i + 1) / BAR_COUNT;
    const f0 = VOICE_FREQ_MIN_HZ * Math.pow(VOICE_FREQ_MAX_HZ / VOICE_FREQ_MIN_HZ, t0);
    const f1 = VOICE_FREQ_MIN_HZ * Math.pow(VOICE_FREQ_MAX_HZ / VOICE_FREQ_MIN_HZ, t1);

    let b0 = Math.max(0, Math.floor(f0 / binHz));
    let b1 = Math.min(binCount - 1, Math.floor(f1 / binHz));
    if (b1 < b0) b1 = b0;

    let sum = 0;
    let count = 0;
    for (let b = b0; b <= b1; b += 1) {
      sum += frequencyData[b] ?? 0;
      count += 1;
    }
    const avg = count > 0 ? sum / count : 0;
    bands.push(avg);
  }
  return bands;
}

/** Future-proofing type for bar vertical alignment (user setting planned). */
export type BarAlignment = 'center' | 'bottom' | 'top';

/**
 * Compute top Y for a bar given alignment mode.
 * Default remains 'center' (vertically mirrored / symmetric around middle)
 * to preserve current behavior until the setting UI is built.
 */
function getBarY(alignment: BarAlignment, centerY: number, barHeight: number, canvasHeight: number): number {
  if (alignment === 'bottom') {
    return canvasHeight - barHeight;
  }
  if (alignment === 'top') {
    return 0;
  }
  // center (mirrored vertically)
  return centerY - barHeight / 2;
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

  // CHANGED: analyser tuning + alignment support added for spectrum re-weighting and future settings.
  // WHY: defaults gave poor high-frequency visibility; alignment will be user-selectable.
  private sampleRate: number;
  private alignment: BarAlignment = 'center'; // default preserves current centered+mirrored look

  constructor(analyser: AnalyserNode, theme: WaveformTheme = getThemeById(DEFAULT_THEME_ID)) {
    this.analyser = analyser;
    this.analyser.fftSize = ANALYSER_FFT_SIZE;

    // Configure analyser for voice (much better range than defaults -100..-30).
    this.analyser.minDecibels = -90;
    this.analyser.maxDecibels = -20;
    this.analyser.smoothingTimeConstant = 0.65;

    this.theme = theme;

    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_WIDTH;
    this.canvas.height = CANVAS_HEIGHT;

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create waveform canvas context.');
    this.ctx = ctx;

    this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
    this.sampleRate = this.analyser.context?.sampleRate ?? 48000;
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

  /** Prepared for future user setting (center | bottom | top). Default = center (current mirrored behavior). */
  setBarAlignment(alignment: BarAlignment): void {
    this.alignment = alignment;
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

    // CHANGED: replaced naive i*step on 32 bins from fft=64.
    // WHY: that produced almost no energy in upper bars for any voice input.
    // Now uses log-banded aggregation over 80 Hz-16 kHz + compression.
    const bandValues = computeBandValues(this.frequencyData, ANALYSER_FFT_SIZE, this.sampleRate);

    const centerY = canvas.height / 2;
    const maxBarHeight = canvas.height * 0.7;
    const layout = computeBarLayout(canvas.width, theme);
    const { barWidth, spacing, startX } = layout;
    const { cornerRadius, glow } = theme.bars;

    // Optional light per-frame peak normalization so loud speech fills range.
    // Combined with compressForViz this makes upper spectrum visible on sibilants etc.
    let peak = 0;
    for (let v of bandValues) peak = Math.max(peak, v);
    const peakScale = peak > 1 ? 255 / peak : 1;

    for (let i = 0; i < BAR_COUNT; i += 1) {
      const raw = bandValues[i] ?? 0;
      // Peak scale first (so strongest bar can reach full), then compress.
      const rawNorm = Math.min(1, (raw * peakScale) / 255);
      const normalized = compressForViz(rawNorm);

      const barHeight = Math.max(MIN_BAR_HEIGHT, normalized * maxBarHeight);
      const x = startX + i * (barWidth + spacing);
      const y = getBarY(this.alignment, centerY, barHeight, canvas.height);

      ctx.fillStyle = applyBarColor(theme.colors.bar, normalized);
      ctx.shadowColor = theme.colors.glow;
      ctx.shadowBlur = normalized * glow;
      fillRoundedRect(ctx, x, y, barWidth, barHeight, cornerRadius);
    }

    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
  }
}

/** Voice-like demo amplitudes (0–1) for popup preview — no mic required. */
const PREVIEW_BAND_LEVELS: readonly number[] = [
  0.42, 0.58, 0.71, 0.55, 0.48, 0.62, 0.78, 0.66,
  0.52, 0.44, 0.57, 0.69, 0.74, 0.61, 0.5, 0.46,
  0.53, 0.67, 0.72, 0.59, 0.41, 0.38, 0.49, 0.63,
  0.7, 0.56, 0.45, 0.4, 0.47, 0.6, 0.65, 0.51,
];

function drawBarsFromLevels(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  theme: WaveformTheme,
  alignment: BarAlignment,
  levels: readonly number[],
): void {
  const centerY = canvas.height / 2;
  const maxBarHeight = canvas.height * 0.7;
  const layout = computeBarLayout(canvas.width, theme);
  const { barWidth, spacing, startX } = layout;
  const { cornerRadius, glow } = theme.bars;

  for (let i = 0; i < BAR_COUNT; i += 1) {
    const normalized = compressForViz(Math.min(1, levels[i] ?? 0));
    const barHeight = Math.max(MIN_BAR_HEIGHT, normalized * maxBarHeight);
    const x = startX + i * (barWidth + spacing);
    const y = getBarY(alignment, centerY, barHeight, canvas.height);

    ctx.fillStyle = applyBarColor(theme.colors.bar, normalized);
    ctx.shadowColor = theme.colors.glow;
    ctx.shadowBlur = normalized * glow;
    fillRoundedRect(ctx, x, y, barWidth, barHeight, cornerRadius);
  }

  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
}

/** Static clip preview for popup settings — same draw path as live waveform output. */
export async function renderThemePreview(
  canvas: HTMLCanvasElement,
  theme: WaveformTheme,
  alignment: BarAlignment = 'center',
): Promise<void> {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;

  let backgroundImage: HTMLImageElement | null = null;
  if (backgroundNeedsImage(theme.background) && typeof theme.background.value === 'string') {
    backgroundImage = await loadBackgroundImage(theme.background.value);
  }

  drawThemeBackground(ctx, canvas, theme, backgroundImage);
  drawBarsFromLevels(ctx, canvas, theme, alignment, PREVIEW_BAND_LEVELS);
}