import {
  ANALYSER_FFT_SIZE,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  WAVEFORM_TARGET_FPS,
} from '@/src/utils/constants';

// POLISH (Phase 5+): User-selectable waveform themes — bar/line style, colors, glow,
// background presets. Keep changes low-impact on CPU (stay near WAVEFORM_TARGET_FPS).

const FRAME_INTERVAL_MS = 1000 / WAVEFORM_TARGET_FPS;

export class WaveformRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly analyser: AnalyserNode;
  private readonly frequencyData: Uint8Array;
  private rafId = 0;
  private lastFrameAt = 0;
  private running = false;

  constructor(analyser: AnalyserNode) {
    this.analyser = analyser;
    this.analyser.fftSize = ANALYSER_FFT_SIZE;

    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_WIDTH;
    this.canvas.height = CANVAS_HEIGHT;

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create waveform canvas context.');
    this.ctx = ctx;

    this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
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

  private tick = (timestamp: number): void => {
    if (!this.running) return;

    if (timestamp - this.lastFrameAt >= FRAME_INTERVAL_MS) {
      this.drawFrame();
      this.lastFrameAt = timestamp;
    }

    this.rafId = requestAnimationFrame(this.tick);
  };

  private drawFrame(): void {
    const { ctx, canvas } = this;
    this.analyser.getByteFrequencyData(this.frequencyData as Uint8Array<ArrayBuffer>);

    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#0f1115');
    gradient.addColorStop(1, '#1a1d24');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const barCount = 32;
    const step = Math.max(1, Math.floor(this.frequencyData.length / barCount));
    const barWidth = canvas.width / barCount - 4;
    const centerY = canvas.height / 2;

    for (let i = 0; i < barCount; i += 1) {
      const value = this.frequencyData[i * step] ?? 0;
      const normalized = value / 255;
      const barHeight = Math.max(4, normalized * (canvas.height * 0.7));
      const x = i * (barWidth + 4) + 2;

      ctx.fillStyle = `rgba(0, 121, 211, ${0.35 + normalized * 0.65})`;
      ctx.shadowColor = 'rgba(0, 121, 211, 0.8)';
      ctx.shadowBlur = normalized * 12;
      ctx.fillRect(x, centerY - barHeight / 2, barWidth, barHeight);
    }

    ctx.shadowBlur = 0;
  }
}