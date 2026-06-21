/**
 * Dulcet v3 — composable filter graph builders (dulcet-0 freeze).
 * Production wiring lands in dulcet-1 (isolated processor) and dulcet-3 (transcode -af).
 *
 * ## Integration decision (dulcet-0 audit)
 *
 * **Primary path: single-pass FFmpeg `-af` on existing WebM→MP4 transcode.**
 * Insert `-af <graph>` before `-c:a aac` in TRANSCODE_STRATEGIES (ffmpeg-runner.ts).
 * Video track untouched; duration-preserving pitch keeps A/V sync with canvas waveform.
 *
 * Rejected for production: pre-extract audio → process → remux (extra WASM pass, FS churn).
 * dulcet-1 `processAudio()` harness may still use audio-only FFmpeg graphs for A/B testing.
 *
 * ## Example graphs (reference — finalized in dulcet-1)
 *
 * Pitch (duration-preserving, 48 kHz):
 *   asetrate=48000*R,aresample=48000,atempo=1/R
 *   where R = 2^(semitones/12)
 *
 * 3-band EQ (placeholder center freqs — tune in dulcet-1):
 *   equalizer=f=120:width_type=o:width=1:g=LOW,
 *   equalizer=f=2500:width_type=o:width=1:g=MID,
 *   equalizer=f=8000:width_type=o:width=1:g=HIGH
 *
 * Light dynamics:
 *   loudnorm=I=-16:TP=-1.5:LRA=11  (normalize)
 *   acompressor=threshold=-18dB:ratio=3:attack=5:release=50  (compressor)
 *
 * Light reverb (v3 stretch — simple aecho, not convolution):
 *   aecho=0.8:0.9:40|80:0.3
 */

import {
  semitonesToPitchRatio,
  VOICE_EXPORT_SAMPLE_RATE_HZ,
  voiceEffectIsActive,
  type VoiceEffectConfig,
} from './types';

export interface FfmpegAudioFilterResult {
  /** Comma-joined -af string, or null when effects disabled / no-op. */
  filter: string | null;
  /** Human-readable stage label for semantic progress (dulcet-3). */
  stage: string;
}

function effectiveSemitones(config: VoiceEffectConfig): number {
  const semitones = config.pitchShift?.semitones ?? 0;
  if (!config.pitchShift?.exaggerateNatural || semitones === 0) return semitones;
  // Placeholder: dulcet-2 may replace sign using coarse pitch estimate from preview buffer.
  return semitones;
}

function buildPitchFilter(semitones: number, preserveDuration: boolean): string | null {
  if (semitones === 0) return null;

  const ratio = semitonesToPitchRatio(semitones);
  const rate = Math.round(VOICE_EXPORT_SAMPLE_RATE_HZ * ratio);

  if (!preserveDuration) {
    // Out of v3.0 gate — time-stretch without atempo compensation.
    return `asetrate=${rate},aresample=${VOICE_EXPORT_SAMPLE_RATE_HZ}`;
  }

  const tempo = (1 / ratio).toFixed(6);
  return `asetrate=${rate},aresample=${VOICE_EXPORT_SAMPLE_RATE_HZ},atempo=${tempo}`;
}

function buildEqFilter(eq: VoiceEffectConfig['eq']): string | null {
  if (!eq) return null;

  const segments: string[] = [];
  if (eq.lowGain) {
    segments.push(`equalizer=f=120:width_type=o:width=1:g=${eq.lowGain}`);
  }
  if (eq.midGain) {
    segments.push(`equalizer=f=2500:width_type=o:width=1:g=${eq.midGain}`);
  }
  if (eq.highGain) {
    segments.push(`equalizer=f=8000:width_type=o:width=1:g=${eq.highGain}`);
  }

  return segments.length > 0 ? segments.join(',') : null;
}

function buildDynamicsFilter(dynamics: VoiceEffectConfig['dynamics']): string | null {
  if (!dynamics) return null;

  const segments: string[] = [];
  if (dynamics.normalize) {
    segments.push('loudnorm=I=-16:TP=-1.5:LRA=11');
  }
  if (dynamics.compressorEnabled) {
    segments.push('acompressor=threshold=-18dB:ratio=3:attack=5:release=50');
  }

  return segments.length > 0 ? segments.join(',') : null;
}

function buildReverbFilter(reverb: VoiceEffectConfig['reverb']): string | null {
  const amount = reverb?.amount ?? 0;
  if (amount <= 0) return null;
  // Scale wet mix loosely — exact mapping tuned in dulcet-1.
  const wet = Math.min(0.5, amount * 0.4).toFixed(2);
  return `aecho=0.8:0.9:40|80:${wet}`;
}

/**
 * Builds the FFmpeg `-af` graph for export transcode.
 * Returns null when voice effects are off or all segments are no-op.
 */
export function buildFfmpegAudioFilter(config: VoiceEffectConfig): FfmpegAudioFilterResult {
  if (!voiceEffectIsActive(config)) {
    return { filter: null, stage: 'transcoding' };
  }

  const segments: string[] = [];

  const pitch = buildPitchFilter(
    effectiveSemitones(config),
    config.pitchShift?.preserveDuration !== false,
  );
  if (pitch) segments.push(pitch);

  const eq = buildEqFilter(config.eq);
  if (eq) segments.push(eq);

  const dynamics = buildDynamicsFilter(config.dynamics);
  if (dynamics) segments.push(dynamics);

  const reverb = buildReverbFilter(config.reverb);
  if (reverb) segments.push(reverb);

  if (segments.length === 0) {
    return { filter: null, stage: 'transcoding' };
  }

  return {
    filter: segments.join(','),
    stage: 'transcoding-voice-af',
  };
}

/**
 * Web Audio preview chain sketch (dulcet-2 Design Studio only — not export path).
 *
 * Pitch: AudioBufferSource → BiquadFilter (optional EQ) → GainNode → destination.
 * Duration-preserving pitch preview uses playbackRate on source * compensating
 * buffer duration display, or OfflineAudioContext + resampling — choice deferred to dulcet-2.
 */
export const WEB_AUDIO_PREVIEW_NOTES = {
  pitchPreview:
    'PlaybackRate on AudioBufferSourceNode for coarse preview; export uses FFmpeg atempo.',
  debounceMs: 150,
  demoBufferSource: 'Bundled short WAV or last recording snapshot (dulcet-2 scope).',
} as const;