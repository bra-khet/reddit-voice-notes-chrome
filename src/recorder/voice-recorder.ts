import {
  MAX_RECORDING_SECONDS,
  WAVEFORM_TARGET_FPS,
} from '@/src/utils/constants';
import { buildVoiceNoteFilename, downloadBlob } from '@/src/utils/download';
import { WaveformRenderer } from './waveform';

const RECORDER_TIMESLICE_MS = 1000;

export type RecorderPhase = 'idle' | 'ready' | 'recording' | 'stopped' | 'error';

export interface RecorderState {
  phase: RecorderPhase;
  elapsedSeconds: number;
  errorMessage?: string;
  blob?: Blob;
}

type StateListener = (state: RecorderState) => void;

function pickMimeType(): string | undefined {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
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
  private phase: RecorderPhase = 'idle';
  private errorMessage?: string;
  private resultBlob?: Blob;
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
      errorMessage: this.errorMessage,
      blob: this.resultBlob,
    };
  }

  private setPhase(phase: RecorderPhase, extra?: Partial<RecorderState>): void {
    this.phase = phase;
    if (extra?.errorMessage !== undefined) this.errorMessage = extra.errorMessage;
    if (extra?.blob !== undefined) this.resultBlob = extra.blob;
    if (extra?.elapsedSeconds !== undefined) this.elapsedSeconds = extra.elapsedSeconds;
    for (const listener of this.listeners) {
      listener(this.snapshot());
    }
  }

  async prepare(): Promise<void> {
    if (this.phase === 'ready' || this.phase === 'recording') return;
    if (this.phase === 'stopped' && this.micStream && this.waveform) {
      this.resultBlob = undefined;
      this.errorMessage = undefined;
      this.elapsedSeconds = 0;
      this.setPhase('ready');
      return;
    }

    try {
      this.setPhase('idle');
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

      this.audioContext = new AudioContext();
      const source = this.audioContext.createMediaStreamSource(this.micStream);
      const analyser = this.audioContext.createAnalyser();

      source.connect(analyser);

      this.waveform = new WaveformRenderer(analyser);
      this.waveform.start();

      this.setPhase('ready', { elapsedSeconds: 0, errorMessage: undefined, blob: undefined });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setPhase('error', { errorMessage: message });
      throw error;
    }
  }

  startRecording(): void {
    if (this.phase !== 'ready' || !this.micStream || !this.waveform) return;

    const mimeType = pickMimeType();
    const videoStream = this.waveform.canvas.captureStream(WAVEFORM_TARGET_FPS);
    this.combinedStream = new MediaStream([
      ...videoStream.getVideoTracks(),
      ...this.micStream.getAudioTracks(),
    ]);

    this.chunks = [];
    this.mediaRecorder = mimeType
      ? new MediaRecorder(this.combinedStream, { mimeType })
      : new MediaRecorder(this.combinedStream);

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };

    this.mediaRecorder.onstop = () => {
      const type = this.mediaRecorder?.mimeType || 'video/webm';
      this.resultBlob = new Blob(this.chunks, { type });
      this.setPhase('stopped', { blob: this.resultBlob });
    };

    this.mediaRecorder.start(RECORDER_TIMESLICE_MS);
    this.startedAt = Date.now();
    this.elapsedSeconds = 0;
    this.setPhase('recording', { elapsedSeconds: 0 });

    this.timerId = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.startedAt) / 1000);
      this.elapsedSeconds = elapsed;
      this.setPhase('recording', { elapsedSeconds: elapsed });

      if (elapsed >= MAX_RECORDING_SECONDS) {
        this.stopRecording();
      }
    }, 250);
  }

  stopRecording(): void {
    if (this.phase !== 'recording' || !this.mediaRecorder) return;
    if (this.timerId) clearInterval(this.timerId);
    this.timerId = null;

    if (this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
  }

  downloadRecording(): void {
    if (!this.resultBlob) return;
    downloadBlob(this.resultBlob, buildVoiceNoteFilename('webm'));
  }

  async resetForNewRecording(): Promise<void> {
    this.disposeRecorderOnly();
    this.resultBlob = undefined;
    this.errorMessage = undefined;
    this.elapsedSeconds = 0;
    await this.prepare();
  }

  cancel(): void {
    this.dispose();
    this.setPhase('idle', { elapsedSeconds: 0, blob: undefined, errorMessage: undefined });
  }

  dispose(): void {
    this.disposeRecorderOnly();
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

  private disposeRecorderOnly(): void {
    if (this.timerId) clearInterval(this.timerId);
    this.timerId = null;

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.onstop = null;
      this.mediaRecorder.stop();
    }
    this.mediaRecorder = null;
    this.chunks = [];

    for (const track of this.combinedStream?.getTracks() ?? []) {
      track.stop();
    }
    this.combinedStream = null;
  }
}