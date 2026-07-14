/**
 * Normalized audio carrier shared by Studio preview and record-time capture.
 * CHANGED: v6 visual layers receive energy, FFT bands, and optional waveform data together.
 * WHY: every preset must consume the same honest input at the preview/capture draw seam.
 */

export const AUDIO_VIZ_BAND_COUNT = 32;
export const SYNTHETIC_WAVEFORM_SAMPLE_COUNT = 256;

export interface AudioVizFrame {
  /** Smoothed whole-spectrum energy, normalized to 0–1. */
  energy: number;
  /** Log-spaced FFT bands, normalized to 0–1 and padded/truncated to 32. */
  bands: readonly number[];
  /** Time-domain samples normalized to -1–1; populated only for presets that request them. */
  waveform?: Float32Array;
  /** Shared animation clock for preview and capture. */
  timeMs: number;
  /** Optional onset hint; Phase 1+ simulations may use it without recomputing deltas. */
  transient?: boolean;
}

export interface BuildAudioVizFrameOptions {
  energy?: number;
  bands?: readonly number[];
  /** Divide source bands by this value before clamping (255 for analyser byte bands). */
  bandScale?: number;
  waveform?: Float32Array;
  /** Raw AnalyserNode time-domain bytes; normalized without an intermediate float buffer. */
  waveformBytes?: Uint8Array;
  timeMs?: number;
  transient?: boolean;
}

function clamp(value: number, min: number, max: number, fallback = min): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function normalizeBands(values: readonly number[], scale: number): number[] {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return Array.from({ length: AUDIO_VIZ_BAND_COUNT }, (_, index) =>
    clamp((values[index] ?? 0) / safeScale, 0, 1));
}

function normalizeWaveform(samples: Float32Array | undefined): Float32Array | undefined {
  if (!samples) return undefined;
  // BUG FIX: Non-finite waveform sample saturation
  // Fix: Invalid samples normalize to silence instead of a full-scale negative excursion.
  return Float32Array.from(samples, (sample) => clamp(sample, -1, 1, 0));
}

function normalizeByteWaveform(samples: Uint8Array | undefined): Float32Array | undefined {
  if (!samples) return undefined;
  return Float32Array.from(samples, (sample) => clamp((sample - 128) / 128, -1, 1, 0));
}

export function buildAudioVizFrame({
  energy = 0,
  bands = [],
  bandScale = 1,
  waveform,
  waveformBytes,
  timeMs = 0,
  transient,
}: BuildAudioVizFrameOptions = {}): AudioVizFrame {
  return {
    energy: clamp(energy, 0, 1),
    bands: normalizeBands(bands, bandScale),
    waveform: waveform
      ? normalizeWaveform(waveform)
      : normalizeByteWaveform(waveformBytes),
    timeMs: Math.max(0, Number.isFinite(timeMs) ? timeMs : 0),
    ...(transient === undefined ? {} : { transient }),
  };
}

export interface SyntheticAudioVizFrameOptions {
  /** Generate a deterministic, voice-like time-domain signal only when the active visual requests it. */
  waveform?: boolean;
  waveformSampleCount?: number;
}

function buildSyntheticWaveform(
  sampleCount: number,
  timeMs: number,
  energy: number,
): Float32Array {
  const count = Math.min(
    2048,
    Math.max(32, Number.isFinite(sampleCount) ? Math.round(sampleCount) : SYNTHETIC_WAVEFORM_SAMPLE_COUNT),
  );
  const seconds = Math.max(0, Number.isFinite(timeMs) ? timeMs : 0) / 1000;
  const amplitude = 0.28 + clamp(energy, 0, 1) * 0.92;
  const harmonicDrift = Math.sin(seconds * 0.73) * 0.42;

  // CHANGED: the no-mic preview has a deterministic, gently evolving harmonic waveform.
  // WHY: Oscilloscope should demonstrate its real trace path without pretending the Studio has live audio.
  return Float32Array.from({ length: count }, (_, index) => {
    const phase = index / Math.max(1, count - 1);
    const envelope = 0.72 + Math.sin(phase * Math.PI) ** 2 * 0.28;
    const fundamental = Math.sin(phase * Math.PI * 2 * 3.25 + seconds * 1.1) * 0.68;
    const overtone = Math.sin(
      phase * Math.PI * 2 * (7.5 + harmonicDrift) - seconds * 1.7,
    ) * 0.23;
    const air = Math.sin(phase * Math.PI * 2 * 13.25 + seconds * 0.41) * 0.09;
    return clamp((fundamental + overtone + air) * amplitude * envelope, -1, 1, 0);
  });
}

/** Representative no-microphone frame for the Studio preview path. */
export function buildSyntheticAudioVizFrame(
  bands: readonly number[],
  timeMs: number,
  energy = 0.32,
  options: SyntheticAudioVizFrameOptions = {},
): AudioVizFrame {
  return buildAudioVizFrame({
    energy,
    bands,
    timeMs,
    waveform: options.waveform
      ? buildSyntheticWaveform(
        options.waveformSampleCount ?? SYNTHETIC_WAVEFORM_SAMPLE_COUNT,
        timeMs,
        energy,
      )
      : undefined,
  });
}

/** Zero-input default keeps direct/background-only callers backward-safe. */
export const EMPTY_AUDIO_VIZ_FRAME: AudioVizFrame = Object.freeze({
  energy: 0,
  bands: Object.freeze(Array<number>(AUDIO_VIZ_BAND_COUNT).fill(0)),
  timeMs: 0,
});
