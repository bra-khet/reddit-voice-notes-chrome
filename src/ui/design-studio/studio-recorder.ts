/**
 * v5.4.0 Phase 2 — Studio-native recording transport (roadmap §4 Phase 2).
 *
 * Deck-embedded audition controls: Record / Stop / Discard, chronos timer +
 * cap track, processing progress. The live WYSIWYG canvas is handed to the
 * caller (mount-clip-studio) which swaps it into the main preview area — the
 * user records while watching the exact pixels being encoded, styled live by
 * the Studio controls around it.
 *
 * Capture engine + take lifecycle live in mountRecorder / VoiceRecorderSession;
 * this module is transport chrome only.
 */

import {
  DISPLAY_MAX_RECORDING_SECONDS,
  formatRecordingCapProse,
} from '@/src/utils/constants';
import { mountRecorder, type RecorderHostHandle } from '@/src/recorder/recorder-host';
import type { RecorderState } from '@/src/recorder/voice-recorder';
import {
  getTakeManager,
  isTransientTakeStatus,
  STALE_TRANSIENT_MS,
} from '@/src/session/take-manager';
import { setWorkflowPhase } from '@/src/workflow/workflow-state';

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function renderStudioAudition(): string {
  return `
    <div class="studio-v4__audition" data-take-audition hidden>
      <p class="studio-v4__audition-status" data-audition-status role="status" aria-live="polite">
        Initializing microphone…
      </p>
      <div class="studio-v4__audition-readout" aria-live="off">
        <span class="studio-v4__audition-timer" data-audition-timer>0:00</span>
        <span class="studio-v4__audition-cap">/ ${formatTime(DISPLAY_MAX_RECORDING_SECONDS)}</span>
      </div>
      <div class="studio-v4__audition-track" data-audition-track aria-hidden="true">
        <div class="studio-v4__audition-track-bar" data-audition-track-bar></div>
      </div>
      <div class="studio-v4__audition-progress" data-audition-progress hidden aria-hidden="true">
        <div class="studio-v4__audition-progress-bar" data-audition-progress-bar></div>
      </div>
      <div class="studio-v4__audition-actions">
        <button type="button" class="studio-v4__bake-btn studio-v4__bake-btn--unavailable studio-v4__audition-primary" data-audition-primary disabled>
          ● Record
        </button>
        <button type="button" class="popup__profile-btn popup__profile-btn--delete studio-v4__audition-cancel" data-audition-cancel>
          Cancel
        </button>
      </div>
    </div>
  `;
}

export interface StudioRecorderDeps {
  /** Live WYSIWYG canvas for the main preview area (null = restore normal preview). */
  onLiveCanvas: (canvas: HTMLCanvasElement | null) => void;
  /** Audition session opened/closed — caller toggles deck mode + preview loop. */
  onActiveChange: (active: boolean) => void;
}

export interface StudioRecorderHandle {
  /** Start an audition session (mic acquire → transport visible). */
  openAudition(): Promise<void>;
  isActive(): boolean;
  dispose(): void;
}

export function mountStudioRecorder(
  root: HTMLElement,
  deps: StudioRecorderDeps,
): StudioRecorderHandle {
  const el = root.querySelector<HTMLElement>('[data-take-audition]')!;
  const statusEl = el.querySelector<HTMLElement>('[data-audition-status]')!;
  const timerEl = el.querySelector<HTMLElement>('[data-audition-timer]')!;
  const trackEl = el.querySelector<HTMLElement>('[data-audition-track]')!;
  const trackBarEl = el.querySelector<HTMLElement>('[data-audition-track-bar]')!;
  const progressEl = el.querySelector<HTMLElement>('[data-audition-progress]')!;
  const progressBarEl = el.querySelector<HTMLElement>('[data-audition-progress-bar]')!;
  const primaryBtn = el.querySelector<HTMLButtonElement>('[data-audition-primary]')!;
  const cancelBtn = el.querySelector<HTMLButtonElement>('[data-audition-cancel]')!;

  let host: RecorderHostHandle | null = null;
  let active = false;
  let currentState: RecorderState | null = null;
  let disposed = false;

  function setPrimary(label: string, mode: 'idle' | 'armed' | 'live' | 'done'): void {
    primaryBtn.textContent = label;
    primaryBtn.disabled = mode === 'idle';
    primaryBtn.classList.toggle('studio-v4__bake-btn--unavailable', mode === 'idle');
    primaryBtn.classList.toggle('studio-v4__bake-btn--ready', mode === 'armed');
    primaryBtn.classList.toggle('studio-v4__bake-btn--baking', mode === 'live');
    primaryBtn.classList.toggle('studio-v4__bake-btn--complete', mode === 'done');
  }

  function setActive(next: boolean): void {
    if (active === next) return;
    active = next;
    el.hidden = !next;
    deps.onActiveChange(next);
  }

  function closeAudition(): void {
    host?.close();
    host = null;
    currentState = null;
    setActive(false);
  }

  /** Hide transport + restore preview without tearing down the capture session. */
  function finishAuditionUi(): void {
    deps.onLiveCanvas(null);
    setActive(false);
  }

  function render(state: RecorderState): void {
    currentState = state;

    timerEl.textContent = formatTime(state.elapsedSeconds);
    timerEl.classList.toggle(
      'studio-v4__audition-timer--warning',
      state.phase === 'recording' && state.nearLimit && !state.criticalLimit,
    );
    timerEl.classList.toggle(
      'studio-v4__audition-timer--critical',
      state.phase === 'recording' && state.criticalLimit,
    );

    const elapsedRatio = Math.min(1, state.elapsedSeconds / DISPLAY_MAX_RECORDING_SECONDS);
    trackEl.hidden = state.phase !== 'recording';
    trackBarEl.style.width = `${elapsedRatio * 100}%`;
    trackBarEl.classList.toggle(
      'studio-v4__audition-track-bar--warning',
      state.nearLimit && !state.criticalLimit,
    );
    trackBarEl.classList.toggle('studio-v4__audition-track-bar--critical', state.criticalLimit);

    progressEl.hidden = state.phase !== 'processing';
    progressBarEl.style.width = `${state.processingProgress}%`;

    statusEl.classList.remove(
      'studio-v4__audition-status--error',
      'studio-v4__audition-status--warning',
    );

    switch (state.phase) {
      case 'idle':
        statusEl.textContent = 'Initializing microphone…';
        setPrimary('● Record', 'idle');
        cancelBtn.textContent = 'Cancel';
        break;
      case 'ready':
        statusEl.textContent = 'Mic live — the preview shows exactly what you will record.';
        setPrimary('● Record', 'armed');
        cancelBtn.textContent = 'Cancel';
        break;
      case 'recording':
        if (state.criticalLimit) {
          statusEl.textContent = `${formatTime(DISPLAY_MAX_RECORDING_SECONDS - state.elapsedSeconds)} left — wrapping up soon.`;
          statusEl.classList.add('studio-v4__audition-status--warning');
        } else if (state.nearLimit) {
          statusEl.textContent = `Almost at the ${formatRecordingCapProse()} limit.`;
          statusEl.classList.add('studio-v4__audition-status--warning');
        } else {
          statusEl.textContent = 'Recording… speak clearly into your microphone.';
        }
        setPrimary('■ Stop', 'live');
        cancelBtn.textContent = 'Discard';
        break;
      case 'processing':
        statusEl.textContent =
          state.processingProgress <= 5
            ? `Loading FFmpeg WASM… ${state.processingProgress}%`
            : `Converting to MP4… ${state.processingProgress}%`;
        setPrimary('Processing…', 'idle');
        cancelBtn.textContent = 'Cancel';
        break;
      case 'stopped':
        // Take is promoted to 'ready' by the session; the deck takes over.
        void setWorkflowPhase('polish');
        // BUG FIX: Studio subtitle relay aborted on stop
        // Fix: closeAudition() called session.dispose() which bumpSession() aborts the
        //      parallel transcribe fork and drops relaySaveSessionTranscript — Reddit panel
        //      keeps the session alive on 'stopped'; hide audition UI only.
        finishAuditionUi();
        break;
      case 'error':
        statusEl.textContent = state.errorMessage ?? 'Something went wrong.';
        statusEl.classList.add('studio-v4__audition-status--error');
        setPrimary('Retry', 'armed');
        cancelBtn.textContent = 'Close';
        break;
    }
  }

  primaryBtn.addEventListener('click', () => {
    if (!host || !currentState) return;
    switch (currentState.phase) {
      case 'ready':
        // Same 3-phase workflow signal the Reddit panel sends — cross-tab
        // banners stay coherent regardless of where capture happens.
        void setWorkflowPhase('capture');
        void host.startRecording();
        break;
      case 'recording':
        void host.stopRecording();
        break;
      case 'error':
        void host.open().catch(() => {
          /* rendered via state subscription */
        });
        break;
    }
  });

  cancelBtn.addEventListener('click', () => {
    if (!host || !currentState) {
      closeAudition();
      return;
    }
    if (currentState.phase === 'recording' && currentState.elapsedSeconds > 0) {
      if (!window.confirm('Discard this recording?')) return;
    }
    host.cancel();
    closeAudition();
  });

  // Studio tab teardown mid-session → same auto-draft semantics as the panel.
  const pageHideHandler = (): void => {
    host?.close();
    host = null;
  };
  window.addEventListener('pagehide', pageHideHandler);

  return {
    async openAudition(): Promise<void> {
      if (disposed || active) return;

      // Another context (Reddit panel) may have a live session — warn instead
      // of silently replacing its 'recording' snapshot.
      const take = await getTakeManager().getCurrentTake();
      if (
        take &&
        isTransientTakeStatus(take.status) &&
        take.source === 'reddit' &&
        Date.now() - take.lastUpdated < STALE_TRANSIENT_MS
      ) {
        const proceed = window.confirm(
          'A recording session looks active on Reddit. Start a new one here anyway?',
        );
        if (!proceed) return;
      }

      host?.close();
      host = mountRecorder({
        hostContext: 'studio',
        onLiveCanvas: deps.onLiveCanvas,
        onStateChange: (state) => {
          if (!disposed && active) render(state);
        },
      });

      setActive(true);
      render({
        phase: 'idle',
        elapsedSeconds: 0,
        processingProgress: 0,
        nearLimit: false,
        criticalLimit: false,
        stoppedAtCap: false,
      });

      try {
        await host.open();
      } catch {
        // Session surfaces the friendly error through the state subscription
        // (mic denied on the extension origin is the common case here).
      }
    },

    isActive(): boolean {
      return active;
    },

    dispose(): void {
      disposed = true;
      window.removeEventListener('pagehide', pageHideHandler);
      closeAudition();
    },
  };
}
