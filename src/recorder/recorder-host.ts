/**
 * v5.4.0 Phase 2 — hostable recorder (roadmap §3.2).
 *
 * Headless host around VoiceRecorderSession: owns mic/session lifecycle, take
 * reconciliation (via the session's v5.4.0 wiring), and auto-draft on close —
 * with NO DOM opinion. Each surface renders its own transport chrome:
 *
 * - Studio: src/ui/design-studio/studio-recorder.ts (deck-embedded transport,
 *   live canvas swapped into the main preview area).
 * - Reddit: src/ui/recorder-panel.ts still drives the session directly
 *   (unchanged Phase 0 path); it can adopt this host when its UI is unified.
 *
 * Live preview contract: instead of per-frame callbacks, the host hands over
 * the WaveformRenderer canvas itself — the exact element captureStream()
 * feeds MediaRecorder. Zero copies, zero preview-vs-output drift.
 */

import { VoiceRecorderSession, type RecorderState } from './voice-recorder';

export type RecorderHostContext = 'studio' | 'reddit';

export interface MountRecorderOptions {
  hostContext: RecorderHostContext;
  onStateChange?: (state: RecorderState) => void;
  /**
   * The live WYSIWYG canvas (640×360) once the mic is ready; null when the
   * session tears down. Hosts insert it into their preview surface directly.
   */
  onLiveCanvas?: (canvas: HTMLCanvasElement | null) => void;
  /** Capture finished end-to-end — base MP4 in hand, take promoted to 'ready'. */
  onTakeComplete?: (state: RecorderState) => void;
}

export interface RecorderHostHandle {
  readonly session: VoiceRecorderSession;
  /** Acquire mic + start the live waveform (resolves at state 'ready'). */
  open(): Promise<void>;
  startRecording(): Promise<void>;
  stopRecording(): Promise<void>;
  /** Discard/cancel — take restore/draft happens inside the session. */
  cancel(): void;
  /** Auto-draft if mid-flight, then tear down mic, canvas, subscriptions. */
  close(): void;
}

export function mountRecorder(options: MountRecorderOptions): RecorderHostHandle {
  const session = new VoiceRecorderSession({
    takeSource: options.hostContext === 'reddit' ? 'reddit' : 'studio',
  });

  let liveCanvasSent = false;
  let closed = false;

  const unsubscribe = session.subscribe((state) => {
    if (closed) return;

    // Hand the live canvas over exactly once per prepared session; re-arm
    // after teardown states so retry/re-open pushes a fresh canvas.
    const canvas = session.previewCanvas;
    if (!liveCanvasSent && canvas && state.phase !== 'idle' && state.phase !== 'error') {
      liveCanvasSent = true;
      options.onLiveCanvas?.(canvas);
    }
    if (liveCanvasSent && (state.phase === 'idle' || state.phase === 'error')) {
      liveCanvasSent = false;
      options.onLiveCanvas?.(null);
    }

    options.onStateChange?.(state);

    if (state.phase === 'stopped') {
      options.onTakeComplete?.(state);
    }
  });

  return {
    session,

    async open(): Promise<void> {
      await session.prepare();
    },

    async startRecording(): Promise<void> {
      await session.startRecording();
    },

    async stopRecording(): Promise<void> {
      await session.stopRecording();
    },

    cancel(): void {
      session.cancel();
    },

    close(): void {
      if (closed) return;
      closed = true;
      session.persistTakeOnClose();
      if (liveCanvasSent) {
        options.onLiveCanvas?.(null);
      }
      unsubscribe();
      session.dispose();
    },
  };
}
