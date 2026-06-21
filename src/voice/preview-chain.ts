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

type SourceMode = 'buffer' | 'element' | null;

interface BiquadOptions {
  type: BiquadFilterType;
  frequency: number;
  gain: number;
  Q?: number;
}

function pitchRatioForConfig(config: VoiceEffectConfig): number {
  if (!voiceEffectIsActive(config)) return 1;
  const semitones = config.pitchShift?.semitones ?? 0;
  if (semitones === 0) return 1;
  return semitonesToPitchRatio(semitones);
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

/**
 * Preview effect chain — order mirrors FFmpeg export: pitch (on source) → EQ → dynamics → out.
 */
function wireEffectChain(
  ctx: AudioContext,
  head: AudioNode,
  config: VoiceEffectConfig,
): AudioNode {
  let node: AudioNode = head;

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
  return node;
}

function wirePreviewOutput(
  ctx: AudioContext,
  head: AudioNode,
  config: VoiceEffectConfig,
): void {
  if (voiceEffectIsActive(config)) {
    wireEffectChain(ctx, head, config);
    return;
  }
  head.connect(ctx.destination);
}

// BUG FIX: Design Studio voice preview pitch on decoded buffer
// Fix: AudioBufferSourceNode.playbackRate is an AudioParam — assign .value, not the property itself.
function setBufferSourcePitch(source: AudioBufferSourceNode, ratio: number): void {
  source.playbackRate.value = ratio;
}

function setMediaElementPitch(audio: HTMLAudioElement, ratio: number): void {
  audio.playbackRate = ratio;
}

/**
 * Web Audio preview for Design Studio (dulcet-2).
 * Tries AudioBuffer decode first; falls back to HTMLMediaElement for muxed WebM.
 */
export function createVoicePreviewPlayer(): VoicePreviewHandle {
  let audioBuffer: AudioBuffer | null = null;
  let sourceMode: SourceMode = null;
  let objectUrl: string | null = null;
  let audioContext: AudioContext | null = null;
  let activeSource: AudioBufferSourceNode | null = null;
  let mediaElement: HTMLAudioElement | null = null;
  let playing = false;

  const revokeUrl = (): void => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  };

  const teardownGraph = (): void => {
    playing = false;

    if (activeSource) {
      try {
        activeSource.stop();
        activeSource.disconnect();
      } catch {
        // ignore
      }
      activeSource = null;
    }

    if (mediaElement) {
      mediaElement.pause();
      mediaElement.removeAttribute('src');
      mediaElement.load();
      mediaElement = null;
    }

    if (audioContext && audioContext.state !== 'closed') {
      void audioContext.close();
    }
    audioContext = null;
  };

  const playViaBuffer = async (config: VoiceEffectConfig): Promise<void> => {
    if (!audioBuffer) throw new Error('No decoded audio buffer.');

    audioContext = new AudioContext();
    await audioContext.resume();

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    setBufferSourcePitch(source, pitchRatioForConfig(config));
    wirePreviewOutput(audioContext, source, config);

    source.onended = () => {
      playing = false;
      teardownGraph();
    };

    activeSource = source;
    playing = true;
    source.start(0);
  };

  const playViaMediaElement = async (config: VoiceEffectConfig): Promise<void> => {
    if (!objectUrl) throw new Error('No media URL for preview.');

    const audio = new Audio(objectUrl);
    mediaElement = audio;
    setMediaElementPitch(audio, pitchRatioForConfig(config));

    audioContext = new AudioContext();
    await audioContext.resume();

    const source = audioContext.createMediaElementSource(audio);
    wirePreviewOutput(audioContext, source, config);

    audio.onended = () => {
      playing = false;
      teardownGraph();
    };

    playing = true;
    await audio.play();
  };

  return {
    async setSource(blob) {
      this.stop();
      audioBuffer = null;
      sourceMode = null;
      revokeUrl();

      if (!blob) return;

      try {
        const decodeContext = new AudioContext();
        try {
          const bytes = await blob.arrayBuffer();
          audioBuffer = await decodeContext.decodeAudioData(bytes.slice(0));
          sourceMode = 'buffer';
        } finally {
          await decodeContext.close();
        }
      } catch {
        objectUrl = URL.createObjectURL(blob);
        sourceMode = 'element';
      }
    },

    async play(config) {
      this.stop();
      if (!sourceMode) {
        throw new Error('No recording loaded for voice preview.');
      }

      const normalized = normalizeVoiceEffectConfig(config);

      if (sourceMode === 'buffer') {
        await playViaBuffer(normalized);
        return;
      }

      await playViaMediaElement(normalized);
    },

    stop() {
      teardownGraph();
    },

    dispose() {
      this.stop();
      audioBuffer = null;
      sourceMode = null;
      revokeUrl();
    },

    isPlaying() {
      return playing;
    },

    hasSource() {
      return sourceMode !== null;
    },
  };
}