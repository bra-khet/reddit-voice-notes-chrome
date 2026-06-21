import { WEB_AUDIO_PREVIEW_NOTES } from './filter-graphs';
import {
  normalizeVoiceEffectConfig,
  semitonesToPitchRatio,
  voiceEffectIsActive,
  type VoiceEffectConfig,
} from './types';

export const VOICE_PREVIEW_DEBOUNCE_MS = WEB_AUDIO_PREVIEW_NOTES.debounceMs;

export interface VoicePreviewHandle {
  setSource(blob: Blob | null): Promise<void>;
  play(config: VoiceEffectConfig): Promise<void>;
  stop(): void;
  dispose(): void;
  isPlaying(): boolean;
  hasSource(): boolean;
}

interface BiquadOptions {
  type: BiquadFilterType;
  frequency: number;
  gain: number;
  Q?: number;
}

function appendBiquad(ctx: AudioContext, input: AudioNode, options: BiquadOptions): AudioNode {
  const filter = ctx.createBiquadFilter();
  filter.type = options.type;
  filter.frequency.value = options.frequency;
  filter.gain.value = options.gain;
  if (options.Q !== undefined) filter.Q.value = options.Q;
  input.connect(filter);
  return filter;
}

function buildEffectChain(ctx: AudioContext, source: AudioBufferSourceNode, config: VoiceEffectConfig): void {
  let node: AudioNode = source;

  const eq = config.eq;
  if (eq?.lowGain) {
    node = appendBiquad(ctx, node, { type: 'lowshelf', frequency: 120, gain: eq.lowGain });
  }
  if (eq?.midGain) {
    node = appendBiquad(ctx, node, { type: 'peaking', frequency: 2500, gain: eq.midGain, Q: 1 });
  }
  if (eq?.highGain) {
    node = appendBiquad(ctx, node, { type: 'highshelf', frequency: 8000, gain: eq.highGain });
  }

  if (config.dynamics?.compressorEnabled) {
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.05;
    node.connect(compressor);
    node = compressor;
  }

  if (config.dynamics?.normalize) {
    const gain = ctx.createGain();
    gain.gain.value = 1.15;
    node.connect(gain);
    node = gain;
  }

  node.connect(ctx.destination);
}

/**
 * Web Audio preview for Design Studio (dulcet-2). Coarse match to FFmpeg export —
 * pitch uses playbackRate; duration may differ slightly from duration-preserving export.
 */
export function createVoicePreviewPlayer(): VoicePreviewHandle {
  let audioBuffer: AudioBuffer | null = null;
  let audioContext: AudioContext | null = null;
  let activeSource: AudioBufferSourceNode | null = null;
  let playing = false;

  const teardownGraph = (): void => {
    playing = false;
    if (activeSource) {
      try {
        activeSource.stop();
        activeSource.disconnect();
      } catch {
        // ignore — may already be stopped
      }
      activeSource = null;
    }

    if (audioContext && audioContext.state !== 'closed') {
      void audioContext.close();
    }
    audioContext = null;
  };

  return {
    async setSource(blob) {
      this.stop();
      audioBuffer = null;
      if (!blob) return;

      const decodeContext = new AudioContext();
      try {
        const bytes = await blob.arrayBuffer();
        audioBuffer = await decodeContext.decodeAudioData(bytes.slice(0));
      } finally {
        await decodeContext.close();
      }
    },

    async play(config) {
      this.stop();
      if (!audioBuffer) {
        throw new Error('No recording loaded for voice preview.');
      }

      const normalized = normalizeVoiceEffectConfig(config);
      const active = voiceEffectIsActive(normalized);

      audioContext = new AudioContext();
      await audioContext.resume();

      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;

      if (active) {
        const semitones = normalized.pitchShift?.semitones ?? 0;
        if (semitones !== 0) {
          source.playbackRate.value = semitonesToPitchRatio(semitones);
        }
        buildEffectChain(audioContext, source, normalized);
      } else {
        source.connect(audioContext.destination);
      }

      source.onended = () => {
        playing = false;
        teardownGraph();
      };

      activeSource = source;
      playing = true;
      source.start(0);
    },

    stop() {
      teardownGraph();
    },

    dispose() {
      this.stop();
      audioBuffer = null;
    },

    isPlaying() {
      return playing;
    },

    hasSource() {
      return audioBuffer !== null;
    },
  };
}