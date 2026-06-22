import {
  DISPLAY_MAX_RECORDING_SECONDS,
  MAX_RECORDING_SECONDS,
  WAVEFORM_TARGET_FPS,
} from '@/src/utils/constants';
import { friendlyRecorderError, type RecorderErrorCode } from '@/src/utils/errors';
import { buildVoiceNoteFilename, downloadBlob } from '@/src/utils/download';
import { transcodeWebmToMp4 } from '@/src/ffmpeg';
import { relaySaveLastBaseMp4 } from '@/src/storage/last-base-mp4-relay';
import { validateWebmRecording } from '@/src/ffmpeg/webm-preflight';
import { RECORDING_CRITICAL_SECONDS, RECORDING_WARNING_SECONDS } from '@/src/ui/tokens';
import { resolveAppearanceTheme, userBackgroundLayoutFromAppearance } from '@/src/theme';
import {
  loadUserPreferences,
  onUserPreferencesChanged,
  shouldReduceMotion,
} from '@/src/settings/user-preferences';
import { relaySaveLastRecording } from '@/src/storage/last-recording-relay';
import { forkTranscribeWebm } from '@/src/transcription/transcribe-client';

import { relaySaveSessionTranscript } from '@/src/storage/session-transcript-relay';
import { clearSessionTranscript, setSessionTranscript } from '@/src/transcription/session-transcript';
import { EXTENSION_LOG_PREFIX } from '@/src/utils/constants';
import { acquireMicStream } from './mic-constraints';
import { WaveformRenderer } from './waveform';

/** Timeslice emits chunks during recording — required for reliable WebM assembly (spec). */
const RECORDER_TIMESLICE_MS = 1000;
/** Brief settle after MediaRecorder stop before building the WebM blob. */
const POST_STOP_SETTLE_MS = 80;
/** Stop slightly before nominal cap so MediaRecorder isn't mid-timeslice (same as manual pre-cap stop). */
const CAP_STOP_LEAD_MS = 300;
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
  /** dulcet-3: voice -af failed; MP4 exported with raw audio. */
  voiceEffectFallback?: boolean;
  /** eloquent-3: subtitle burn-in failed; MP4 delivered without hard subs. */
  subtitleBurnInFallback?: boolean;
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
  private voiceEffectFallback = false;
  private subtitleBurnInFallback = false;
  private phase: RecorderPhase = 'idle';
  private errorCode?: RecorderErrorCode;
  private errorMessage?: string;
  private webmBlob?: Blob;
  private mp4Blob?: Blob;
  private readonly listeners = new Set<StateListener>();
  private disposed = false;
  private sessionEpoch = 0;
  private transcodeGeneration = 0;
  private transcribeGeneration = 0;
  private transcodeAbort: AbortController | null = null;
  private transcribeAbort: AbortController | null = null;
  private processingAbort: AbortController | null = null;
  private capTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private stopInFlight = false;
  private prefsUnsubscribe: (() => void) | null = null;

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
      voiceEffectFallback: this.voiceEffectFallback,
      subtitleBurnInFallback: this.subtitleBurnInFallback,
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
    if (extra?.voiceEffectFallback !== undefined) {
      this.voiceEffectFallback = extra.voiceEffectFallback;
    }
    if (extra?.subtitleBurnInFallback !== undefined) {
      this.subtitleBurnInFallback = extra.subtitleBurnInFallback;
    }

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
        voiceEffectFallback: false,
        subtitleBurnInFallback: false,
        errorCode: undefined,
        errorMessage: undefined,
        webmBlob: undefined,
        mp4Blob: undefined,
      });

      const prefs = await loadUserPreferences();
      // Default prefs → economy path (`{ audio: true }`). See mic-constraints.ts + pretty-3 toggles.
      this.micStream = await acquireMicStream(prefs.audio);

      this.audioContext = new AudioContext();
      await this.audioContext.resume();

      const source = this.audioContext.createMediaStreamSource(this.micStream);
      const analyser = this.audioContext.createAnalyser();
      source.connect(analyser);

      const theme = resolveAppearanceTheme(prefs.appearance);
      this.waveform = new WaveformRenderer(analyser, theme);
      this.waveform.setCustomBackgroundId(prefs.appearance.customBackgroundId ?? null);
      this.waveform.setUserBackgroundLayout(userBackgroundLayoutFromAppearance(prefs.appearance));
      this.waveform.setBarAlignment(prefs.appearance.barAlignment ?? 'center');
      this.waveform.setFullSpectrumViz(prefs.audio.fullSpectrumViz ?? false);
      this.waveform.setReduceMotion(shouldReduceMotion(prefs));
      await this.waveform.whenReady();
      this.waveform.start();

      // Live theme/alignment hot-swap: safe during recording (canvas captureStream = WYSIWYG).
      // Popup settings can change style mid-take; comment panel hides picker as UX guard only.
      // See claude-progress.md "mid-recording theme changes" and pretty-branch.md pretty-7 notes.
      this.prefsUnsubscribe?.();
      this.prefsUnsubscribe = onUserPreferencesChanged((next) => {
        if (!this.waveform) return;
        this.waveform.setTheme(resolveAppearanceTheme(next.appearance));
        this.waveform.setCustomBackgroundId(next.appearance.customBackgroundId ?? null);
        this.waveform.setUserBackgroundLayout(userBackgroundLayoutFromAppearance(next.appearance));
        this.waveform.setBarAlignment(next.appearance.barAlignment ?? 'center');
        this.waveform.setFullSpectrumViz(next.audio.fullSpectrumViz ?? false);
        this.waveform.setReduceMotion(shouldReduceMotion(next));
        void this.waveform.whenReady();
      });

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
    }, Math.max(RECORDER_TIMESLICE_MS, MAX_RECORDING_SECONDS * 1000 - CAP_STOP_LEAD_MS));

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

  private abortTranscode(): void {
    this.transcodeAbort?.abort();
    this.transcodeAbort = null;
  }

  private abortTranscribe(): void {
    this.transcribeAbort?.abort();
    this.transcribeAbort = null;
  }

  private bumpSession(): void {
    this.sessionEpoch += 1;
    this.transcodeGeneration += 1;
    this.transcribeGeneration += 1;
    this.abortTranscode();
    this.abortTranscribe();
    clearSessionTranscript();
  }

  private isSuperseded(stopEpoch: number): boolean {
    return this.disposed || stopEpoch !== this.sessionEpoch;
  }

  async stopRecording(options?: { stoppedAtCap?: boolean }): Promise<void> {
    if (this.stopInFlight || this.phase !== 'recording' || !this.mediaRecorder) return;

    const stopEpoch = this.sessionEpoch;
    this.stopInFlight = true;

    if (options?.stoppedAtCap) {
      this.stoppedAtCap = true;
      this.elapsedSeconds = DISPLAY_MAX_RECORDING_SECONDS;
    }

    if (this.timerId) clearInterval(this.timerId);
    this.timerId = null;
    if (this.capTimeoutId) clearTimeout(this.capTimeoutId);
    this.capTimeoutId = null;

    const recorder = this.mediaRecorder;
    this.mediaRecorder = null;

    try {
      const chunks = await this.finalizeMediaRecorder(recorder);
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, POST_STOP_SETTLE_MS);
      });

      // BUG FIX: Transcode stalls when mic/canvas keep running after Stop
      // Fix: Cut mic, canvas capture, and AudioContext before building the WebM blob / FFmpeg.
      this.releaseAfterRecordingStop();

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

      // CHANGED: persist last take for Design Studio voice preview (dulcet-2).
      // WHY: Studio runs on extension origin; IDB write is async and must not block transcode.
      void relaySaveLastRecording(this.webmBlob, this.elapsedSeconds);

      if (this.isSuperseded(stopEpoch)) return;

      // Enter processing before preflight so UI cannot re-trigger stop / reopen races.
      this.setPhase('processing', { processingProgress: 0 });

      try {
        await validateWebmRecording(this.webmBlob);
        if (this.isSuperseded(stopEpoch)) return;

        const prefs = await loadUserPreferences();
        const subtitlesEnabled = prefs.transcriptConfig.transcriptionEnabled;

        // CHANGED: parallel transcription only — burn-in deferred to Design Studio (eloquent-4).
        // WHY: users review and edit segment JSON before confirming subtitle bake.
        const webmClone = this.webmBlob.slice(0, this.webmBlob.size, this.webmBlob.type);
        if (subtitlesEnabled) {
          // CHANGED: transcribe is background-only for Studio — no recorder progress bar (eloquent-4).
          // WHY: STT can outlast transcode; mapping it to 56–80% left the panel stuck at 80%.
          void this.forkTranscribe(webmClone, stopEpoch, false);
        }

        const transcodeOutcome = await this.transcodeToMp4(stopEpoch);
        if (this.isSuperseded(stopEpoch) || this.phase === 'error') return;

        this.setPhase('stopped', {
          processingProgress: 100,
          stoppedAtCap: this.stoppedAtCap,
          voiceEffectFallback: transcodeOutcome.voiceEffectFallback === true,
          subtitleBurnInFallback: false,
        });
        this.processingAbort = null;

        // BUG FIX: recorder stuck at processing 80% (BUG-026)
        // Fix: reach stopped before async base-MP4 relay — large single-message relay must not gate UI.
        if (this.mp4Blob) {
          void relaySaveLastBaseMp4(this.mp4Blob, this.elapsedSeconds).catch((error: unknown) => {
            console.warn(`${EXTENSION_LOG_PREFIX} Base MP4 relay for subtitle bake failed`, error);
          });
        }
      } catch (error) {
        if (this.isSuperseded(stopEpoch)) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        this.setError(error);
      }
    } finally {
      this.stopInFlight = false;
    }
  }

  private forkTranscribe(
    webm: Blob,
    stopEpoch: number,
    reportProgress: boolean,
  ): Promise<Awaited<ReturnType<typeof forkTranscribeWebm>>> {
    const generation = this.transcribeGeneration;
    this.abortTranscribe();
    const controller = new AbortController();
    this.transcribeAbort = controller;

    return forkTranscribeWebm(webm, {
      signal: controller.signal,
      onProgress: (ratio, stage) => {
        if (this.isSuperseded(stopEpoch) || generation !== this.transcribeGeneration) return;
        // BUG FIX: recorder stuck at "Transcribing… 80%" after MP4 ready (eloquent-4a)
        // Fix: late transcribe progress must not regress phase from stopped → processing.
        if (this.phase !== 'processing') return;
        if (reportProgress) {
          const pct = 56 + Math.round(ratio * 24);
          this.setPhase('processing', { processingProgress: Math.min(80, pct) });
        }
        console.log(`${EXTENSION_LOG_PREFIX} Transcribe progress`, {
          ratio: Math.round(ratio * 100),
          stage,
        });
      },
    })
      .then((outcome) => {
        if (this.isSuperseded(stopEpoch) || generation !== this.transcribeGeneration) return null;
        if (!outcome) return null;

        if (outcome.applied) {
          setSessionTranscript(outcome.result, outcome.jobId);
          void relaySaveSessionTranscript(outcome.result, outcome.jobId);
        }

        console.log(`${EXTENSION_LOG_PREFIX} Transcribe complete`, {
          jobId: outcome.jobId,
          segments: outcome.result.segments.length,
          chars: outcome.result.text.length,
          applied: outcome.applied,
          fallback: outcome.fallback,
          stage: outcome.stage,
          elapsedMs: outcome.elapsedMs,
        });
        return outcome;
      })
      .catch((error: unknown) => {
        if (this.isSuperseded(stopEpoch) || generation !== this.transcribeGeneration) return null;
        if (error instanceof DOMException && error.name === 'AbortError') return null;
        console.warn(`${EXTENSION_LOG_PREFIX} Transcribe fork failed (non-blocking):`, error);
        return null;
      })
      .finally(() => {
        if (this.transcribeAbort === controller) {
          this.transcribeAbort = null;
        }
      });
  }

  /** Apply MP4 with burned subtitles after Design Studio bake (eloquent-4). */
  applyBakedMp4(blob: Blob): void {
    if (this.disposed) return;
    const canApply =
      this.phase === 'stopped' || (this.phase === 'processing' && Boolean(this.mp4Blob));
    if (!canApply) return;
    this.mp4Blob = blob;
    this.setPhase('stopped', {
      processingProgress: 100,
      subtitleBurnInFallback: false,
    });
  }

  private async transcodeToMp4(stopEpoch: number): Promise<{ voiceEffectFallback?: boolean }> {
    if (!this.webmBlob || this.isSuperseded(stopEpoch)) {
      return {};
    }

    const generation = this.transcodeGeneration;
    this.abortTranscode();
    const controller = new AbortController();
    this.transcodeAbort = controller;
    this.processingAbort = controller;

    let lastProgress = 0;

    try {
      const prefs = await loadUserPreferences();
      const transcodeResult = await transcodeWebmToMp4(
        this.webmBlob,
        (ratio) => {
          if (this.isSuperseded(stopEpoch) || generation !== this.transcodeGeneration) return;
          const pct = Math.max(lastProgress, Math.round(ratio * 55));
          lastProgress = pct;
          this.setPhase('processing', { processingProgress: pct });
        },
        controller.signal,
        prefs.voiceEffect,
      );

      if (this.isSuperseded(stopEpoch) || generation !== this.transcodeGeneration) {
        return {};
      }

      this.mp4Blob = transcodeResult.mp4;
      return { voiceEffectFallback: transcodeResult.voiceEffectFallback };
    } catch (error) {
      if (this.isSuperseded(stopEpoch) || generation !== this.transcodeGeneration) {
        return {};
      }
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      this.setError(error);
      return {};
    } finally {
      if (this.transcodeAbort === controller) {
        this.transcodeAbort = null;
      }
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
    this.bumpSession();
    this.disposeMediaPipeline();
    await this.prepare();
  }

  cancel(): void {
    this.bumpSession();
    this.disposeMediaPipeline();
    this.setPhase('idle', {
      elapsedSeconds: 0,
      processingProgress: 0,
      nearLimit: false,
      criticalLimit: false,
      stoppedAtCap: false,
      voiceEffectFallback: false,
      subtitleBurnInFallback: false,
      webmBlob: undefined,
      mp4Blob: undefined,
      errorCode: undefined,
      errorMessage: undefined,
    });
    this.processingAbort = null;
  }

  dispose(): void {
    this.disposed = true;
    this.bumpSession();
    this.disposeMediaPipeline();
  }

  /**
   * Drain MediaRecorder chunks — handlers must be attached immediately before stop().
   * BUG FIX: Cap auto-stop hung FFmpeg at ~20% transcoding
   * Fix: Cap stop uses the same immediate requestData+stop path as manual stop (no wait-while-recording flush).
   * Sync: cap timeout uses CAP_STOP_LEAD_MS; do not re-add async flush only for cap stops.
   */
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

  /**
   * Stop all live capture after MediaRecorder has flushed its final chunk.
   * Waveform canvas is left mounted (frozen on last frame) for preview during transcode.
   */
  private releaseAfterRecordingStop(): void {
    for (const track of this.combinedStream?.getVideoTracks() ?? []) {
      track.stop();
    }
    for (const track of this.combinedStream?.getAudioTracks() ?? []) {
      track.stop();
    }
    this.combinedStream = null;

    for (const track of this.micStream?.getTracks() ?? []) {
      track.stop();
    }
    this.micStream = null;

    this.waveform?.stop();

    if (this.audioContext && this.audioContext.state !== 'closed') {
      void this.audioContext.close();
    }
    this.audioContext = null;
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

    this.releaseAfterRecordingStop();

    this.prefsUnsubscribe?.();
    this.prefsUnsubscribe = null;

    this.waveform = null;
  }
}