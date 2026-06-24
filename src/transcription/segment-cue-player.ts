import { resolveSegmentPlaybackWindow } from '@/src/transcription/segment-timing';

type SourceMode = 'buffer' | 'element' | null;

export interface SegmentCuePlayerHandle {
  setSource(blob: Blob | null): Promise<void>;
  getDecodedDuration(): number | null;
  playSegment(start: number, end: number, clipDurationSeconds?: number | null): Promise<void>;
  stop(): void;
  dispose(): void;
  isPlaying(): boolean;
  hasSource(): boolean;
}

/**
 * Raw-audio cue preview for subtitle timing QA (no voice effects).
 * Mirrors voice preview decode paths: AudioBuffer first, HTMLMediaElement fallback.
 */
export function createSegmentCuePlayer(): SegmentCuePlayerHandle {
  let audioBuffer: AudioBuffer | null = null;
  let sourceMode: SourceMode = null;
  let objectUrl: string | null = null;
  let audioContext: AudioContext | null = null;
  let activeSource: AudioBufferSourceNode | null = null;
  let mediaElement: HTMLAudioElement | null = null;
  let stopTimer = 0;
  let playing = false;

  const revokeUrl = (): void => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  };

  const clearStopTimer = (): void => {
    if (stopTimer) {
      window.clearTimeout(stopTimer);
      stopTimer = 0;
    }
  };

  const teardownGraph = (): void => {
    playing = false;
    clearStopTimer();

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

  const playViaBuffer = async (window: { start: number; end: number }): Promise<void> => {
    if (!audioBuffer) throw new Error('No decoded audio buffer.');

    audioContext = new AudioContext();
    await audioContext.resume();

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);

    const duration = window.end - window.start;
    source.onended = () => {
      playing = false;
      teardownGraph();
    };

    activeSource = source;
    playing = true;
    source.start(0, window.start, duration);
  };

  const playViaMediaElement = async (window: { start: number; end: number }): Promise<void> => {
    if (!objectUrl) throw new Error('No media URL for cue preview.');

    const audio = new Audio(objectUrl);
    mediaElement = audio;
    audio.currentTime = window.start;

    playing = true;
    await audio.play();

    const durationMs = Math.max(0, (window.end - window.start) * 1000);
    stopTimer = window.setTimeout(() => {
      audio.pause();
      playing = false;
      teardownGraph();
    }, durationMs);
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

    getDecodedDuration() {
      if (audioBuffer && Number.isFinite(audioBuffer.duration) && audioBuffer.duration > 0) {
        return audioBuffer.duration;
      }
      return null;
    },

    async playSegment(start, end, clipDurationSeconds) {
      this.stop();
      if (!sourceMode) {
        throw new Error('No recording loaded for cue preview.');
      }

      const window = resolveSegmentPlaybackWindow(start, end, clipDurationSeconds);
      if (!window) {
        throw new Error('Cue timing is outside the recording — adjust start/end.');
      }

      if (sourceMode === 'buffer') {
        await playViaBuffer(window);
        return;
      }

      await playViaMediaElement(window);
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