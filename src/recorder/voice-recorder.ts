import {
  MAX_RECORDING_SECONDS,
  WAVEFORM_TARGET_FPS,
} from '@/src/utils/constants';
import { friendlyRecorderError, type RecorderErrorCode } from '@/src/utils/errors';
import { buildVoiceNoteFilename, downloadBlob } from '@/src/utils/download';
import { transcodeWebmToMp4 } from '@/src/ffmpeg';
import { RECORDING_CRITICAL_SECONDS, RECORDING_WARNING_SECONDS } from '@/src/ui/tokens';
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
  nearLimit: boolean;
  criticalLimit: boolean;
  stoppedAtCap: boolean;
  errorCode?: RecorderErrorCode;
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

function recordingLimitFlags(elapsedSeconds: number): Pick<RecorderState, 'nearLimit' | 'criticalLimit'> {
  const remaining = MAX_RECORDING_SECONDS - elapsedSeconds;
  return {
    nearLimit: remaining <= RECORDING_WARNING_SECONDS && remaining > 0,
    criticalLimit: remaining <= RECORDING_CRITICAL_SECONDS && remaining > 0,
  };
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
  private nearLimit = false;
  private criticalLimit = false;
  private stoppedAtCap = false;
  private phase: RecorderPhase = 'idle';
  private errorCode?: RecorderErrorCode;
  private errorMessage?: string;
  private webmBlob?: Blob;
  private mp4Blob?: Blob;
  private readonly listeners = new Set<StateListener>();
  private disposed = false;
  private transcodeGeneration = 0;
  private capTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private stopInFlight = false;

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
      nearLimit: this.nearLimit,
      criticalLimit: this.criticalLimit,
      stoppedAtCap: this.stoppedAtCap,
      errorCode: this.errorCode,
      errorMessage: this.errorMessage,
      webmBlob: this.webmBlob,
      mp4Blob: this.mp4Blob,
    };
  }

  private setPhase(phase: RecorderPhase, extra?: Partial<RecorderState>): void {
    if (this.disposed) return;

    this.phase = phase;
    if (extra?.errorMessage !== undefined) this.errorMessage = extra.errorMessage;
    if (extra?.errorCode !== undefined) this.errorCode = extra.errorCode;
    if (extra?.webmBlob !== undefined) this.webmBlob = extra.webmBlob;
    if (extra?.mp4Blob !== undefined) this.mp4Blob = extra.mp4Blob;
    if (extra?.elapsedSeconds !== undefined) this.elapsedSeconds = extra.elapsedSeconds;
    if (extra?.processingProgress !== undefined) {
      this.processingProgress = extra.processingProgress;
    }
    if (extra?.nearLimit !== undefined) this.nearLimit = extra.nearLimit;
    if (extra?.criticalLimit !== undefined) this.criticalLimit = extra.criticalLimit;
    if (extra?.stoppedAtCap !== undefined) this.stoppedAtCap = extra.stoppedAtCap;

    for (const listener of this.listeners) {
      listener(this.snapshot());
    }
  }

  private setError(error: unknown): void {
    const friendly = friendlyRecorderError(error);
    this.setPhase('error', {
      errorCode: friendly.code,
      errorMessage: friendly.message,
    });
  }

  async prepare(): Promise<void> {
    if (this.phase === 'ready' || this.phase === 'recording' || this.phase === 'processing') {
      return;
    }

    try {
      this.setPhase('idle', {
        elapsedSeconds: 0,
        processingProgress: 0,
        nearLimit: false,
        criticalLimit: false,
        stoppedAtCap: false,
        errorCode: undefined,
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
      this.setError(error);
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
    this.stoppedAtCap = false;

    this.mediaRecorder = createMediaRecorder(this.combinedStream, mimeType);

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };

    this.mediaRecorder.start(RECORDER_TIMESLICE_MS);
    this.startedAt = Date.now();
    this.elapsedSeconds = 0;
    this.setPhase('recording', {
      elapsedSeconds: 0,
      processingProgress: 0,
      nearLimit: false,
      criticalLimit: false,
      stoppedAtCap: false,
    });

    this.capTimeoutId = setTimeout(() => {
      this.stoppedAtCap = true;
      void this.stopRecording({ stoppedAtCap: true });
    }, MAX_RECORDING_SECONDS * 1000);

    this.timerId = setInterval(() => {
      const elapsed = Math.min(
        MAX_RECORDING_SECONDS,
        Math.floor((Date.now() - this.startedAt) / 1000),
      );
      this.elapsedSeconds = elapsed;
      const limits = recordingLimitFlags(elapsed);
      this.setPhase('recording', { elapsedSeconds: elapsed, ...limits });
    }, 250);
  }

  async stopRecording(options?: { stoppedAtCap?: boolean }): Promise<void> {
    if (this.stopInFlight || this.phase !== 'recording' || !this.mediaRecorder) return;

    this.stopInFlight = true;

    if (options?.stoppedAtCap) {
      this.stoppedAtCap = true;
      this.elapsedSeconds = MAX_RECORDING_SECONDS;
    }

    if (this.timerId) clearInterval(this.timerId);
    this.timerId = null;
    if (this.capTimeoutId) clearTimeout(this.capTimeoutId);
    this.capTimeoutId = null;

    const recorder = this.mediaRecorder;
    this.mediaRecorder = null;

    try {
      const chunks = await this.finalizeMediaRecorder(recorder, this.stoppedAtCap);

      this.releaseCaptureTracks();

      const type = recorder.mimeType || 'video/webm';
      this.webmBlob = new Blob(chunks, { type });
      this.chunks = [];

      if (this.webmBlob.size < MIN_RECORDING_BYTES) {
        this.setPhase('error', {
          errorCode: 'empty-recording',
          errorMessage: 'Recording was empty or too short. Hold Record for at least one second.',
        });
        return;
      }

      await this.transcodeToMp4();
    } finally {
      this.stopInFlight = false;
    }
  }

  private async transcodeToMp4(): Promise<void> {
    if (!this.webmBlob) return;

    const generation = ++this.transcodeGeneration;
    this.setPhase('processing', { processingProgress: 0 });

    try {
      this.mp4Blob = await transcodeWebmToMp4(this.webmBlob, (ratio) => {
        if (this.disposed || generation !== this.transcodeGeneration) return;
        this.setPhase('processing', { processingProgress: Math.round(ratio * 100) });
      });

      if (this.disposed || generation !== this.transcodeGeneration) return;

      this.setPhase('stopped', {
        processingProgress: 100,
        stoppedAtCap: this.stoppedAtCap,
      });
    } catch (error) {
      if (this.disposed || generation !== this.transcodeGeneration) return;
      this.setError(error);
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
    this.disposed = false;
    this.transcodeGeneration += 1;
    this.disposeMediaPipeline();
    await this.prepare();
  }

  cancel(): void {
    this.transcodeGeneration += 1;
    this.disposeMediaPipeline();
    this.setPhase('idle', {
      elapsedSeconds: 0,
      processingProgress: 0,
      nearLimit: false,
      criticalLimit: false,
      stoppedAtCap: false,
      webmBlob: undefined,
      mp4Blob: undefined,
      errorCode: undefined,
      errorMessage: undefined,
    });
  }

  dispose(): void {
    this.disposed = true;
    this.transcodeGeneration += 1;
    this.disposeMediaPipeline();
  }

  /**
   * Drain MediaRecorder chunks — handlers must be attached immediately before stop().
   * BUG FIX: 3-minute cap auto-stop hung FFmpeg / timed out
   * Fix: Cap uses dedicated timeout (not interval race); flush final timeslice before stop.
   */
  private async finalizeMediaRecorder(
    recorder: MediaRecorder,
    flushCapStop = false,
  ): Promise<Blob[]> {
    const chunks = [...this.chunks];

    if (recorder.state === 'recording') {
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };

      recorder.requestData();

      // BUG FIX: 3-minute cap auto-stop hung FFmpeg / timed out
      // Fix: Wait for the in-flight 1s timeslice to land before the final stop().
      if (flushCapStop) {
        await new Promise((resolve) => setTimeout(resolve, RECORDER_TIMESLICE_MS + 100));
        if (recorder.state === 'recording') {
          recorder.requestData();
        }
      }

      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        if (recorder.state === 'recording') {
          recorder.stop();
          return;
        }
        resolve();
      });
    }

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
    if (this.capTimeoutId) clearTimeout(this.capTimeoutId);
    this.capTimeoutId = null;
    this.stopInFlight = false;

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