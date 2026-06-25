/**
 * Dulcet II (v5) — Design Studio preview player.
 *
 * Branch 4 (4.3): the legacy Web-Audio effect chain (real-time pitch/EQ/dynamics
 * on the flat config) is gone — every voice is now a StylizedGraph that can only
 * be reproduced by the FFmpeg graph renderer. So this is a *dry* player: the
 * Studio renders the active graph once through ffmpeg.wasm and hands the finished
 * clip to `playProcessed`, which plays it back untouched. What you hear is the
 * bake.
 */

export interface VoicePreviewHandle {
  /** Track that a recording is loaded (gates the Test button); no decode/effects. */
  setSource(blob: Blob | null): Promise<void>;
  /**
   * Play an already-rendered clip dry — no effect chain. The blob has passed
   * through the full graph in ffmpeg.wasm, so it is authoritative and must NOT
   * be re-processed.
   */
  playProcessed(blob: Blob): Promise<void>;
  stop(): void;
  dispose(): void;
  isPlaying(): boolean;
  hasSource(): boolean;
}

export function createVoicePreviewPlayer(): VoicePreviewHandle {
  let hasBlob = false;
  let mediaElement: HTMLAudioElement | null = null;
  let processedUrl: string | null = null;
  let playing = false;

  const teardown = (): void => {
    playing = false;
    if (mediaElement) {
      mediaElement.pause();
      mediaElement.removeAttribute('src');
      mediaElement.load();
      mediaElement = null;
    }
    if (processedUrl) {
      URL.revokeObjectURL(processedUrl);
      processedUrl = null;
    }
  };

  return {
    async setSource(blob) {
      this.stop();
      hasBlob = Boolean(blob);
    },

    async playProcessed(blob) {
      this.stop();
      processedUrl = URL.createObjectURL(blob);
      const audio = new Audio(processedUrl);
      mediaElement = audio;
      audio.onended = () => {
        playing = false;
        teardown();
      };
      playing = true;
      await audio.play();
    },

    stop() {
      teardown();
    },

    dispose() {
      this.stop();
      hasBlob = false;
    },

    isPlaying() {
      return playing;
    },

    hasSource() {
      return hasBlob;
    },
  };
}
