import {
  ANALYSER_FFT_SIZE,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  FULL_SPECTRUM_FREQ_MIN_HZ,
  VOICE_FREQ_MAX_HZ,
  VOICE_FREQ_MIN_HZ,
  WAVEFORM_TARGET_FPS,
} from '@/src/utils/constants';
import {
  drawThemeBackground,
  deriveGlowColor,
  effectiveBarGlow,
  resolveClipBackgrounds,
  userBackgroundLayoutFromAppearance,
  type UserBackgroundLayout,
  type WaveformTheme,
} from '@/src/theme';
import type { DrawableBackgroundImage } from '@/src/storage/background-loader';
import type { AnimatedBackground } from '@/src/storage/animated-background';
import { normalizeBackgroundAssetId } from '@/src/storage/image-db';
import { DEFAULT_THEME_ID, getThemeById } from '@/src/theme/presets';
import {
  AUDIO_VIZ_BAND_COUNT,
  buildAudioVizFrame,
  buildSyntheticAudioVizFrame,
  renderAudioVisualForCanvas,
  type AudioVizFrame,
  type SpectrumAlignment,
} from '@/src/theme/audio-reactive';
import {
  CLASSIC_NEON_SPECTRUM_ID,
  registerCoreSpectrumVisuals,
} from '@/src/theme/audio-reactive/spectra';
import {
  drawSubtitlePreview,
  type SubtitlePreviewOptions,
} from '@/src/transcription/subtitle-preview';

const FRAME_INTERVAL_MS = 1000 / WAVEFORM_TARGET_FPS;

registerCoreSpectrumVisuals();

/**
 * Compute 32 band values (0-255) by aggregating FFT bins over log-spaced
 * frequencies from VOICE_FREQ_MIN_HZ to VOICE_FREQ_MAX_HZ.
 *
 * VOICE FREQ RANGE: 80 Hz – 16 kHz.
 * BUG FIX: upper spectrum bars never activated (raw low-res linear bins + spectral tilt).
 * Fix: log-band aggregation over voice range + compression.
 *
 * Voice mode (default): 80 Hz – 16 kHz. Full-spectrum toggle widens to ~20 Hz – nyquist.
 */
function computeBandValues(
  frequencyData: Uint8Array,
  sampleRate: number,
  minHz: number,
  maxHz: number,
): number[] {
  const binCount = frequencyData.length;
  const nyquist = sampleRate / 2;
  const binHz = nyquist / binCount;
  const freqMax = Math.min(maxHz, nyquist);
  const freqMin = Math.max(1, Math.min(minHz, freqMax - 1));

  const bands: number[] = [];
  for (let i = 0; i < AUDIO_VIZ_BAND_COUNT; i += 1) {
    // Log spacing between min and max
    const t0 = i / AUDIO_VIZ_BAND_COUNT;
    const t1 = (i + 1) / AUDIO_VIZ_BAND_COUNT;
    const f0 = freqMin * Math.pow(freqMax / freqMin, t0);
    const f1 = freqMin * Math.pow(freqMax / freqMin, t1);

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

/** Existing public name retained while the registry owns the alignment vocabulary. */
export type BarAlignment = SpectrumAlignment;

function resolveSpectrumColors(theme: WaveformTheme): { bar: string; glow: string } {
  const color = theme.designEffects?.visualizerParams?.color;
  if (typeof color === 'string') {
    return { bar: color, glow: deriveGlowColor(color) };
  }
  if (Array.isArray(color) && color.length > 0) {
    const bar = color[0] ?? theme.colors.bar;
    return { bar, glow: color[1] ?? deriveGlowColor(bar) };
  }
  return { bar: theme.colors.bar, glow: theme.colors.glow };
}

function drawThemeSpectrum(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  theme: WaveformTheme,
  alignment: BarAlignment,
  frame: AudioVizFrame,
  reduceMotion: boolean,
  amplitudeMode: 'capture' | 'preview',
): void {
  const requestedId = theme.designEffects?.spectrumPreset ?? CLASSIC_NEON_SPECTRUM_ID;
  const environment = {
    spectrum: {
      alignment,
      amplitudeMode,
      reduceMotion,
      bars: {
        width: theme.bars.width,
        spacing: theme.bars.spacing,
        cornerRadius: theme.bars.cornerRadius,
        glow: effectiveBarGlow(theme),
      },
      colors: resolveSpectrumColors(theme),
    },
  } as const;
  const rendered = renderAudioVisualForCanvas(
    'spectrum',
    requestedId,
    ctx,
    canvas,
    frame,
    theme.designEffects?.visualizerParams,
    environment,
  );

  // CHANGED: an unavailable additive preset falls back to the founding spectrum.
  // WHY: imported or partially-developed v6 preferences must never produce a blank capture.
  if (!rendered && requestedId !== CLASSIC_NEON_SPECTRUM_ID) {
    renderAudioVisualForCanvas(
      'spectrum',
      CLASSIC_NEON_SPECTRUM_ID,
      ctx,
      canvas,
      frame,
      undefined,
      environment,
    );
  }
}

export class WaveformRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly analyser: AnalyserNode;
  private readonly frequencyData: Uint8Array;
  private theme: WaveformTheme;
  private customBackgroundId: string | null = null;
  private userBackgroundLayout: UserBackgroundLayout = userBackgroundLayoutFromAppearance({});
  private bundledBackgroundImage: HTMLImageElement | null = null;
  private userBackgroundImage: DrawableBackgroundImage | null = null;
  /** Set when the personal background is an animated GIF — drives per-frame looping. */
  private userAnimatedBackground: AnimatedBackground | null = null;
  private backgroundLoadPromise: Promise<void> = Promise.resolve();
  /** Monotonic token — stale async loads must not overwrite newer background state. */
  private backgroundLoadGeneration = 0;
  private rafId = 0;
  private backgroundPumpId = 0;
  private lastFrameAt = 0;
  private running = false;
  private readonly onVisibilityChange = (): void => {
    this.syncFramePump();
  };

  // CHANGED: analyser tuning + alignment support added for spectrum re-weighting and future settings.
  // WHY: defaults gave poor high-frequency visibility; alignment will be user-selectable.
  private sampleRate: number;
  private alignment: BarAlignment = 'center'; // default preserves current centered+mirrored look
  private fullSpectrumViz = false;
  private reduceMotion = false;
  private smoothedAudioEnergy = 0;

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
    // CHANGED: defer first background load until setCustomBackgroundId / setTheme.
    // WHY: constructor used to race an id=null load against the prefs-driven personal bg load.
  }

  /** Wait for background assets (bundled or ImageDB) before recording — preview uses the same canvas. */
  async whenReady(): Promise<void> {
    await this.backgroundLoadPromise;
  }

  setTheme(theme: WaveformTheme): void {
    this.theme = theme;
    this.backgroundLoadPromise = this.loadBackgroundIfNeeded();
  }

  /** ImageDB personal background id — hot-swaps during recording like theme (pretty-7b). */
  setCustomBackgroundId(id: string | null | undefined): void {
    this.customBackgroundId = normalizeBackgroundAssetId(id);
    this.backgroundLoadPromise = this.loadBackgroundIfNeeded();
  }

  /** Personal background fit/fill and anchor (pretty-8). */
  setUserBackgroundLayout(layout: UserBackgroundLayout): void {
    this.userBackgroundLayout = layout;
  }

  /** Prepared for future user setting (center | bottom | top). Default = center (current mirrored behavior). */
  setBarAlignment(alignment: BarAlignment): void {
    this.alignment = alignment;
  }

  /** Widen viz beyond voice-focused band for music / ambient input (pretty-3). */
  setFullSpectrumViz(enabled: boolean): void {
    this.fullSpectrumViz = enabled;
  }

  /** Simplify bar motion and freeze animated backgrounds when OS requests reduced motion (pretty-4). */
  setReduceMotion(enabled: boolean): void {
    this.reduceMotion = enabled;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameAt = 0;
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.syncFramePump();
  }

  stop(): void {
    this.running = false;
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.stopFramePump();
  }

  /**
   * Force one canvas paint before MediaRecorder stop. Background tabs throttle
   * requestAnimationFrame, so captureStream can miss the final video frame.
   */
  flushFrameForCapture(): void {
    if (!this.running) return;
    this.drawFrame();
    this.lastFrameAt = performance.now();
  }

  private stopFramePump(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    if (this.backgroundPumpId) window.clearInterval(this.backgroundPumpId);
    this.backgroundPumpId = 0;
  }

  /** rAF when focused; setInterval when hidden so captureStream keeps receiving frames. */
  private syncFramePump(): void {
    if (!this.running) return;

    const hidden = document.hidden;
    if (hidden) {
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = 0;
      }
      if (!this.backgroundPumpId) {
        this.backgroundPumpId = window.setInterval(() => {
          if (!this.running) return;
          this.drawFrame();
          this.lastFrameAt = performance.now();
        }, FRAME_INTERVAL_MS);
      }
      return;
    }

    if (this.backgroundPumpId) {
      window.clearInterval(this.backgroundPumpId);
      this.backgroundPumpId = 0;
    }
    if (!this.rafId) {
      this.lastFrameAt = 0;
      this.rafId = requestAnimationFrame(this.tick);
    }
  }

  private async loadBackgroundIfNeeded(): Promise<void> {
    const generation = ++this.backgroundLoadGeneration;
    const theme = this.theme;
    const customBackgroundId = this.customBackgroundId;

    let resolved = await resolveClipBackgrounds(theme, customBackgroundId);

    // CHANGED: retry once when personal bg id is set but relay/decode failed (MV3 SW cold start).
    // WHY: first content-script request can race service worker IndexedDB wake-up.
    if (customBackgroundId && !resolved.userBackgroundImage) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (generation !== this.backgroundLoadGeneration) return;
      resolved = await resolveClipBackgrounds(theme, customBackgroundId);
    }

    // BUG FIX: Personal background missing on live recorder canvas
    // Fix: Ignore stale loads — constructor/prefs could finish a bundled-only load after personal bg resolved.
    if (generation !== this.backgroundLoadGeneration) return;

    this.userBackgroundImage = resolved.userBackgroundImage;
    this.userAnimatedBackground = resolved.userAnimatedBackground;
    this.bundledBackgroundImage = resolved.bundledBackgroundImage;
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

    // CHANGED: replaced naive i*step on 32 bins from fft=64.
    // WHY: that produced almost no energy in upper bars for any voice input.
    // Now uses log-banded aggregation over 80 Hz-16 kHz + compression.
    const minHz = this.fullSpectrumViz ? FULL_SPECTRUM_FREQ_MIN_HZ : VOICE_FREQ_MIN_HZ;
    const maxHz = this.fullSpectrumViz ? this.sampleRate / 2 : VOICE_FREQ_MAX_HZ;
    const bandValues = computeBandValues(this.frequencyData, this.sampleRate, minHz, maxHz);

    let bandSum = 0;
    for (const value of bandValues) bandSum += value;
    const instantEnergy = bandValues.length > 0 ? bandSum / bandValues.length / 255 : 0;
    const energySmoothing = this.reduceMotion ? 0.94 : 0.82;
    const energyBlend = this.reduceMotion ? 0.06 : 0.18;
    this.smoothedAudioEnergy =
      this.smoothedAudioEnergy * energySmoothing + instantEnergy * energyBlend;

    // CHANGED: pick the animated GIF frame for this instant (reduce-motion freezes to frame 0).
    // WHY: animated branch Phase 2 — the captured canvas is the exported MP4, so looping here
    //      animates the live recorder, the preview, and the export in lockstep (WYSIWYG).
    const animationTimeMs = this.reduceMotion ? 0 : performance.now();
    const backgroundFrame = this.userAnimatedBackground
      ? this.userAnimatedBackground.frameAt(animationTimeMs)
      : this.userBackgroundImage;

    // CHANGED: capture now publishes normalized energy + all 32 FFT bands to the draw seam.
    // WHY: v6 spectrum/overlay presets must share the same record-time input and clock.
    const audioFrame = buildAudioVizFrame({
      energy: this.smoothedAudioEnergy,
      bands: bandValues,
      bandScale: 255,
      timeMs: animationTimeMs,
    });

    drawThemeBackground(
      ctx,
      canvas,
      theme,
      this.bundledBackgroundImage,
      audioFrame,
      backgroundFrame,
      this.userBackgroundLayout,
    );

    drawThemeSpectrum(
      ctx,
      canvas,
      theme,
      this.alignment,
      audioFrame,
      this.reduceMotion,
      'capture',
    );
  }
}

/** Voice-like demo amplitudes (0–1) for popup preview — no mic required. */
const PREVIEW_BAND_LEVELS: readonly number[] = [
  0.42, 0.58, 0.71, 0.55, 0.48, 0.62, 0.78, 0.66,
  0.52, 0.44, 0.57, 0.69, 0.74, 0.61, 0.5, 0.46,
  0.53, 0.67, 0.72, 0.59, 0.41, 0.38, 0.49, 0.63,
  0.7, 0.56, 0.45, 0.4, 0.47, 0.6, 0.65, 0.51,
];

/** Clip preview for popup settings — same draw path as live waveform output. */
export async function renderThemePreview(
  canvas: HTMLCanvasElement,
  theme: WaveformTheme,
  alignment: BarAlignment = 'center',
  timeMs: number = performance.now(),
  customBackgroundId: string | null = null,
  userBackgroundLayout: UserBackgroundLayout = userBackgroundLayoutFromAppearance({}),
  subtitlePreview?: SubtitlePreviewOptions,
): Promise<void> {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;

  const { userBackgroundImage, userAnimatedBackground, bundledBackgroundImage } =
    await resolveClipBackgrounds(theme, customBackgroundId);

  // Animated GIF: pick the frame for `timeMs` (callers pass 0 to freeze for reduced motion).
  const backgroundFrame = userAnimatedBackground
    ? userAnimatedBackground.frameAt(timeMs)
    : userBackgroundImage;

  // CHANGED: the no-mic preview emits the same complete carrier as live capture.
  // WHY: representative synthetic bands keep future presets honest about the fidelity gap.
  const audioFrame = buildSyntheticAudioVizFrame(PREVIEW_BAND_LEVELS, timeMs, 0.32);

  drawThemeBackground(
    ctx,
    canvas,
    theme,
    bundledBackgroundImage,
    audioFrame,
    backgroundFrame,
    userBackgroundLayout,
  );
  drawThemeSpectrum(ctx, canvas, theme, alignment, audioFrame, false, 'preview');
  if (subtitlePreview) {
    drawSubtitlePreview(ctx, canvas, { ...subtitlePreview, previewTimeMs: timeMs });
  }
}
