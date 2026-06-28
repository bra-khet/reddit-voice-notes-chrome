/**
 * v5.3.1 — Live-mic voice preview: transient capture utility.
 *
 * Isolated, FFmpeg-free, **storage-free** wrapper around `getUserMedia` +
 * `MediaRecorder` that grabs a short, throwaway audio sample so the Design Studio
 * Voice panel can audition the active voice character on the user's own voice.
 *
 * HARD CONSTRAINT (design doc §3): this module must NEVER persist the capture.
 * It deliberately imports no storage module — in particular not
 * `@/src/storage/last-recording-db` — so it cannot overwrite the last Reddit
 * recording held in browser memory. The capture lives only as the returned Blob.
 *
 * The output is `audio/webm;codecs=opus`, which carries the EBML magic that the
 * voice renderer's `isValidWebm()` check requires; the renderer drops absent video
 * with `-vn` / pad mapping, so an audio-only capture is a valid render input with
 * no changes to `process-audio.ts`.
 *
 * See: docs/v5.3.1-voice-live-mic-preview-design-document.md
 */

export type MicTestCaptureErrorCode =
  | 'unsupported' // getUserMedia / MediaRecorder / audio-webm not available here
  | 'permission-denied' // user denied the mic prompt
  | 'no-audio' // stream had no audio track, or capture was empty/too short
  | 'aborted-empty' // cancelled, or stopped before recording began
  | 'capture-failed'; // MediaRecorder/getUserMedia threw for another reason

export class MicTestCaptureError extends Error {
  readonly code: MicTestCaptureErrorCode;
  constructor(code: MicTestCaptureErrorCode, message: string) {
    super(message);
    this.name = 'MicTestCaptureError';
    this.code = code;
  }
}

export interface MicTestCaptureOptions {
  /** Hard cap; auto-stop (graceful) after this many ms. Default {@link MIC_TEST_DEFAULT_MAX_MS}. */
  maxDurationMs?: number;
  /**
   * Inject the stream acquisition so the caller can honor user mic prefs (e.g.
   * `acquireMicStream(prefs.audio)` — same constraints + fallback ladder as the real
   * recorder). Keeps this module a pure leaf with no prefs/storage import. Defaults to
   * a plain audio `getUserMedia` with browser DSP on. Must reject with a DOMException
   * (e.g. `NotAllowedError`) on denial so error classification works.
   */
  acquireStream?: () => Promise<MediaStream>;
  /** Fires once the stream is live and recording has started — UI flips to "Recording". */
  onStart?: () => void;
  /** Fires when the {@link maxDurationMs} cap triggers the auto-stop. */
  onAutoStop?: () => void;
  /**
   * Phase 1 (user contribution): live input level 0..1 for a meter. The hook is
   * wired through the options but is not yet driven — see the TODO in
   * {@link startMicTestCapture}.
   */
  onLevel?: (level: number) => void;
}

export interface MicTestCaptureController {
  /** Graceful finish: flush the recorder and resolve `done` with the captured Blob. */
  stop(): void;
  /** Discard: stop capture and reject `done` with an `aborted-empty` error. */
  cancel(): void;
  /** Resolves with the captured `audio/webm` Blob; rejects with {@link MicTestCaptureError}. */
  readonly done: Promise<Blob>;
}

/** Short by design — a quick audition, well under the 30s preview render cap. */
export const MIC_TEST_DEFAULT_MAX_MS = 10_000;
/** Below this the capture is treated as empty (mirrors the renderer's MIN_INPUT_BYTES). */
const MIC_TEST_MIN_BYTES = 256;

function pickAudioMimeType(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

/**
 * Browser DSP on by default (echo/noise/AGC) — the speech-friendly economy path.
 * Phase 4 will swap this for `acquireMicStream(prefs.audio)` so the test honors the
 * user's raw/enhanced capture prefs and matches the real recorder.
 */
function defaultAudioConstraints(): MediaTrackConstraints {
  return { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
}

/**
 * Start a transient mic capture. Returns immediately with a controller; the actual
 * permission prompt + recording happen asynchronously. Resolve/reject is delivered
 * through `controller.done`.
 */
export function startMicTestCapture(options: MicTestCaptureOptions = {}): MicTestCaptureController {
  const maxDurationMs = options.maxDurationMs ?? MIC_TEST_DEFAULT_MAX_MS;

  let resolveDone!: (blob: Blob) => void;
  let rejectDone!: (error: unknown) => void;
  const done = new Promise<Blob>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  let settled = false;
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let autoStopTimer = 0;
  let audioContext: AudioContext | null = null;
  let levelRaf = 0;
  const chunks: Blob[] = [];

  const clearTimer = (): void => {
    if (autoStopTimer) {
      window.clearTimeout(autoStopTimer);
      autoStopTimer = 0;
    }
  };

  /** Best-effort teardown of the level-meter AudioContext + rAF (never leaks). */
  const stopMeter = (): void => {
    if (levelRaf) {
      window.cancelAnimationFrame(levelRaf);
      levelRaf = 0;
    }
    if (audioContext) {
      void audioContext.close().catch(() => {
        /* already closed */
      });
      audioContext = null;
    }
  };

  const stopTracks = (): void => {
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
  };

  const fail = (error: unknown): void => {
    if (settled) return;
    settled = true;
    clearTimer();
    stopMeter();
    try {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    } catch {
      // Recorder may already be torn down — ignore.
    }
    recorder = null;
    stopTracks();
    rejectDone(error);
  };

  /** Invoked from `recorder.onstop` after a graceful {@link MicTestCaptureController.stop}. */
  const finish = (): void => {
    if (settled) return;
    settled = true;
    clearTimer();
    stopMeter();
    stopTracks();
    const type = recorder?.mimeType || 'audio/webm';
    recorder = null;
    const blob = new Blob(chunks, { type });
    if (blob.size < MIC_TEST_MIN_BYTES) {
      rejectDone(new MicTestCaptureError('no-audio', 'Capture was too short — nothing recorded.'));
      return;
    }
    resolveDone(blob);
  };

  const controller: MicTestCaptureController = {
    stop() {
      if (settled) return;
      clearTimer();
      if (recorder && recorder.state !== 'inactive') {
        // Graceful: MediaRecorder flushes a final dataavailable, then onstop → finish().
        recorder.stop();
      } else if (!recorder) {
        // stop() before recording actually began (still in the permission prompt).
        fail(new MicTestCaptureError('aborted-empty', 'Stopped before recording began.'));
      }
    },
    cancel() {
      fail(new MicTestCaptureError('aborted-empty', 'Mic test cancelled.'));
    },
    done,
  };

  void (async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      fail(new MicTestCaptureError('unsupported', 'Microphone capture is not supported here.'));
      return;
    }

    const mimeType = pickAudioMimeType();
    if (!mimeType) {
      fail(new MicTestCaptureError('unsupported', 'No supported audio recording format (audio/webm).'));
      return;
    }

    try {
      const acquire =
        options.acquireStream ??
        (() => navigator.mediaDevices.getUserMedia({ audio: defaultAudioConstraints() }));
      stream = await acquire();
    } catch (error) {
      const denied =
        error instanceof DOMException &&
        (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError');
      fail(
        new MicTestCaptureError(
          denied ? 'permission-denied' : 'capture-failed',
          error instanceof Error ? error.message : String(error),
        ),
      );
      return;
    }

    // Cancelled during the permission prompt — drop the stream we just acquired.
    if (settled) {
      stopTracks();
      return;
    }

    if (stream.getAudioTracks().length === 0) {
      fail(new MicTestCaptureError('no-audio', 'No microphone audio track available.'));
      return;
    }

    try {
      recorder = new MediaRecorder(stream, { mimeType });
    } catch (error) {
      fail(
        new MicTestCaptureError(
          'capture-failed',
          error instanceof Error ? error.message : String(error),
        ),
      );
      return;
    }

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => finish();
    recorder.onerror = () =>
      fail(new MicTestCaptureError('capture-failed', 'MediaRecorder error during capture.'));

    recorder.start();
    options.onStart?.();
    autoStopTimer = window.setTimeout(() => {
      options.onAutoStop?.();
      controller.stop();
    }, maxDurationMs);

    // Phase 1 — live RMS level meter (0..1) for the UI. Best-effort: a meter failure
    // must never break the capture itself. Torn down in fail()/finish() via stopMeter().
    if (options.onLevel && stream) {
      try {
        audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        const tick = (): void => {
          if (settled || !audioContext) return;
          analyser.getFloatTimeDomainData(samples);
          let sumSquares = 0;
          for (let i = 0; i < samples.length; i++) sumSquares += samples[i] * samples[i];
          const rms = Math.sqrt(sumSquares / samples.length);
          // Speech RMS sits well below 1.0; scale with headroom and clamp.
          options.onLevel?.(Math.min(1, rms * 2.5));
          levelRaf = window.requestAnimationFrame(tick);
        };
        levelRaf = window.requestAnimationFrame(tick);
      } catch {
        stopMeter();
      }
    }
  })();

  return controller;
}
