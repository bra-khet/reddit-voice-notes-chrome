import {
  MAX_RECORDING_SECONDS,
  WAVEFORM_TARGET_FPS,
} from '@/src/utils/constants';
import { buildVoiceNoteFilename, downloadBlob } from '@/src/utils/download';
import { transcodeWebmToMp4 } from '@/src/ffmpeg';
import { WaveformRenderer } from './waveform';

/** Timeslice emits chunks during recording — required for reliable WebM assembly (spec). */
const RECORDER_TIMESLICE_MS = 1000;
const RECORDER_VIDEO_BPS = 2_500_000;
const RECORDER_AUDIO_BPS = 128_000;
const MIN_RECORDING_BYTES = 256;

export type RecorderPhase =
  | 'idle'
  | 'ready'
  | 'recording'
  | 'processing'
  | 'stopped'
  | 'error';

export interface RecorderState {
  phase: RecorderPhase;
  elapsedSeconds: number;
  processingProgress: number;
  errorMessage?: string;
  webmBlob?: Blob;
  mp4Blob?: Blob;
}

type StateListener = (state: RecorderState) => void;

function pickMimeType(): string | undefined {
  // VP8 first — better ffmpeg.wasm compatibility than VP9 for short canvas captures.
  const candidates = [
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm',
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

function createMediaRecorder(stream: MediaStream, mimeType?: string): MediaRecorder {
  const options: MediaRecorderOptions = {
    videoBitsPerSecond: RECORDER_VIDEO_BPS,
    audioBitsPerSecond: RECORDER_AUDIO_BPS,
  };
  if (mimeType) options.mimeType = mimeType;
  return new MediaRecorder(stream, options);
}

export class VoiceRecorderSession {
  private audioContext: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private combinedStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private waveform: WaveformRenderer | null = null;
  private chunks: Blob[] = [];
  private timerId: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private elapsedSeconds = 0;
  private processingProgress = 0;
  private phase: RecorderPhase = 'idle';
  private errorMessage?: string;
  private webmBlob?: Blob;
  private mp4Blob?: Blob;
  private readonly listeners = new Set<StateListener>();

  get previewCanvas(): HTMLCanvasElement | null {
    return this.waveform?.canvas ?? null;
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  private snapshot(): RecorderState {
    return {
      phase: this.phase,
      elapsedSeconds: this.elapsedSeconds,
      processingProgress: this.processingProgress,
      errorMessage: this.errorMessage,
      webmBlob: this.webmBlob,
      mp4Blob: this.mp4Blob,
    };
  }

  private setPhase(phase: RecorderPhase, extra?: Partial<RecorderState>): void {
    this.phase = phase;
    if (extra?.errorMessage !== undefined) this.errorMessage = extra.errorMessage;
    if (extra?.webmBlob !== undefined) this.webmBlob = extra.webmBlob;
    if (extra?.mp4Blob !== undefined) this.mp4Blob = extra.mp4Blob;
    if (extra?.elapsedSeconds !== undefined) this.elapsedSeconds = extra.elapsedSeconds;
    if (extra?.processingProgress !== undefined) {
      this.processingProgress = extra.processingProgress;
    }
    for (const listener of this.listeners) {
      listener(this.snapshot());
    }
  }

  async prepare(): Promise<void> {
    if (this.phase === 'ready' || this.phase === 'recording' || this.phase === 'processing') {
      return;
    }

    try {
      this.setPhase('idle', {
        elapsedSeconds: 0,
        processingProgress: 0,
        errorMessage: undefined,
        webmBlob: undefined,
        mp4Blob: undefined,
      });

      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

      this.audioContext = new AudioContext();
      await this.audioContext.resume();

      const source = this.audioContext.createMediaStreamSource(this.micStream);
      const analyser = this.audioContext.createAnalyser();
      source.connect(analyser);

      this.waveform = new WaveformRenderer(analyser);
      this.waveform.start();

      this.setPhase('ready');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setPhase('error', { errorMessage: message });
      throw error;
    }
  }

  async startRecording(): Promise<void> {
    if (this.phase !== 'ready' || !this.micStream || !this.waveform || !this.audioContext) return;

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    const mimeType = pickMimeType();
    const videoStream = this.waveform.canvas.captureStream(WAVEFORM_TARGET_FPS);
    this.combinedStream = new MediaStream([
      ...videoStream.getVideoTracks(),
      ...this.micStream.getAudioTracks(),
    ]);

    this.chunks = [];
    this.webmBlob = undefined;
    this.mp4Blob = undefined;

    this.mediaRecorder = createMediaRecorder(this.combinedStream, mimeType);

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };

    this.mediaRecorder.start(RECORDER_TIMESLICE_MS);
    this.startedAt = Date.now();
    this.elapsedSeconds = 0;
    this.setPhase('recording', { elapsedSeconds: 0, processingProgress: 0 });

    this.timerId = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.startedAt) / 1000);
      this.elapsedSeconds = elapsed;
      this.setPhase('recording', { elapsedSeconds: elapsed });

      if (elapsed >= MAX_RECORDING_SECONDS) {
        void this.stopRecording();
      }
    }, 250);
  }

  async stopRecording(): Promise<void> {
    if (this.phase !== 'recording' || !this.mediaRecorder) return;

    if (this.timerId) clearInterval(this.timerId);
    this.timerId = null;

    const recorder = this.mediaRecorder;
    this.mediaRecorder = null;

    const chunks = await this.finalizeMediaRecorder(recorder);

    this.releaseCaptureTracks();

    const type = recorder.mimeType || 'video/webm';
    this.webmBlob = new Blob(chunks, { type });
    this.chunks = [];

    if (this.webmBlob.size < MIN_RECORDING_BYTES) {
      this.setPhase('error', {
        errorMessage: 'Recording was empty or too short. Hold Record for at least one second.',
      });
      return;
    }

    await this.transcodeToMp4();
  }

  private async transcodeToMp4(): Promise<void> {
    if (!this.webmBlob) return;

    this.setPhase('processing', { processingProgress: 0 });

    try {
      this.mp4Blob = await transcodeWebmToMp4(this.webmBlob, (ratio) => {
        this.setPhase('processing', { processingProgress: Math.round(ratio * 100) });
      });
      this.setPhase('stopped', { processingProgress: 100 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setPhase('error', { errorMessage: `MP4 conversion failed: ${message}` });
    }
  }

  downloadRecording(): void {
    if (this.mp4Blob) {
      downloadBlob(this.mp4Blob, buildVoiceNoteFilename('mp4'));
      return;
    }
    if (this.webmBlob) {
      downloadBlob(this.webmBlob, buildVoiceNoteFilename('webm'));
    }
  }

  async resetForNewRecording(): Promise<void> {
    this.disposeMediaPipeline();
    await this.prepare();
  }

  cancel(): void {
    this.disposeMediaPipeline();
    this.setPhase('idle', {
      elapsedSeconds: 0,
      processingProgress: 0,
      webmBlob: undefined,
      mp4Blob: undefined,
      errorMessage: undefined,
    });
  }

  dispose(): void {
    this.disposeMediaPipeline();
  }

  /** Drain MediaRecorder chunks — handlers must be attached immediately before stop(). */
  private async finalizeMediaRecorder(recorder: MediaRecorder): Promise<Blob[]> {
    const chunks = [...this.chunks];

    await new Promise<void>((resolve) => {
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => resolve();

      if (recorder.state === 'recording') {
        recorder.requestData();
        recorder.stop();
        return;
      }

      resolve();
    });

    return chunks;
  }

  // BUG FIX: Re-record corrupt WebM / silent second take
  // Fix: Only stop canvas video tracks after each take; fully rebuild mic + AudioContext on "Record again".
  private releaseCaptureTracks(): void {
    for (const track of this.combinedStream?.getVideoTracks() ?? []) {
      track.stop();
    }
    this.combinedStream = null;
  }

  private disposeMediaPipeline(): void {
    if (this.timerId) clearInterval(this.timerId);
    this.timerId = null;

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.onstop = null;
      try {
        this.mediaRecorder.stop();
      } catch {
        // Recorder may already be inactive after a completed take.
      }
    }
    this.mediaRecorder = null;
    this.chunks = [];

    this.releaseCaptureTracks();

    this.waveform?.stop();
    this.waveform = null;

    for (const track of this.micStream?.getTracks() ?? []) {
      track.stop();
    }
    this.micStream = null;

    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
    }
  }
}