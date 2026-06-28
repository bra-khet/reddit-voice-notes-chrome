/**
 * Static Voice Studio — audition (Phase 3).
 *
 * Mirrors the extension Voice panel's audition flow: render the ACTIVE graph
 * through ffmpeg.wasm and play it back, with a shared Stop + a single player.
 * Inputs here are a live mic One-Time Test (transient, never persisted — uses the
 * verbatim-ported mic-test-capture.ts) and an upload-your-own-clip fallback.
 * Bundled sample clips are deferred to Phase 7 (they need real audio assets).
 *
 * The ffmpeg render glue is lazy-imported on first use so the ~30 MB engine stays
 * out of the studio's initial bundle.
 */
import { resolveVoiceGraph, stylizedGraphIsActive } from '@/src/voice/dsp';
import {
  startMicTestCapture,
  MicTestCaptureError,
  MIC_TEST_DEFAULT_MAX_MS,
  type MicTestCaptureController,
  type MicTestCaptureErrorCode,
} from '@/src/voice/mic-test-capture';
import { showToast } from './toast';
import type { VoicePanelHandle } from './voice-panel';

/** Cap the rendered preview so long uploads audition fast (same idea as the bake's preview cap). */
const PREVIEW_MAX_SECONDS = 30;

export interface AuditionHandle {
  dispose(): void;
}

function captureErrorMessage(code: MicTestCaptureErrorCode): string {
  const messages: Record<MicTestCaptureErrorCode, string> = {
    'permission-denied':
      'Microphone blocked. Allow mic access for this site, then try again.',
    unsupported: 'Live mic test isn’t supported in this browser.',
    'no-audio': 'No audio captured — check your microphone and try again.',
    'aborted-empty': 'Mic test cancelled.',
    'capture-failed': 'Could not capture audio — please try again.',
  };
  return messages[code];
}

export function mountAudition(slot: HTMLElement, panel: VoicePanelHandle): AuditionHandle {
  slot.classList.add('audition');
  slot.innerHTML = `
    <h3 class="audition__title">Audition</h3>
    <p class="audition__hint">Hear the active voice. The first render downloads the ~30&nbsp;MB engine, then it’s cached.</p>
    <div class="audition__tests">
      <button type="button" class="audition__btn audition__btn--primary" data-mic>🎙 Test with my mic</button>
      <label class="audition__btn">
        Upload a clip
        <input type="file" accept="audio/*" data-upload hidden />
      </label>
    </div>
    <p class="audition__note">Bundled sample clips are coming in a later phase — for now use your mic or upload a short clip.</p>
    <div class="audition__meter-wrap" data-meter-wrap hidden>
      <div class="audition__meter" role="meter" aria-label="Microphone input level"
        aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" data-meter>
        <span class="audition__meter-fill" data-meter-fill></span>
      </div>
    </div>
    <div class="audition__stoprow">
      <button type="button" class="audition__stop" data-stop hidden>Stop</button>
    </div>
    <audio class="audition__player" data-player controls hidden></audio>
    <p class="audition__status" data-status aria-live="polite"></p>
  `;

  const micBtn = slot.querySelector<HTMLButtonElement>('[data-mic]')!;
  const uploadInput = slot.querySelector<HTMLInputElement>('[data-upload]')!;
  const meterWrap = slot.querySelector<HTMLElement>('[data-meter-wrap]')!;
  const meterEl = slot.querySelector<HTMLElement>('[data-meter]')!;
  const meterFill = slot.querySelector<HTMLElement>('[data-meter-fill]')!;
  const stopBtn = slot.querySelector<HTMLButtonElement>('[data-stop]')!;
  const player = slot.querySelector<HTMLAudioElement>('[data-player]')!;
  const statusEl = slot.querySelector<HTMLElement>('[data-status]')!;

  let rendering = false;
  let capturing = false;
  let capture: MicTestCaptureController | null = null;
  let objectUrl: string | null = null;

  const setStatus = (message: string): void => {
    statusEl.textContent = message;
  };

  const setMeter = (level: number): void => {
    const pct = Math.round(Math.min(1, Math.max(0, level)) * 100);
    meterFill.style.width = `${pct}%`;
    meterEl.setAttribute('aria-valuenow', String(pct));
  };

  const refreshStop = (): void => {
    if (capturing) {
      stopBtn.hidden = false;
      stopBtn.textContent = 'Stop & render';
    } else if (!player.paused && !player.ended) {
      stopBtn.hidden = false;
      stopBtn.textContent = 'Stop';
    } else {
      stopBtn.hidden = true;
    }
  };

  const setRendering = (active: boolean): void => {
    rendering = active;
    micBtn.disabled = active || capturing;
    uploadInput.disabled = active || capturing;
    micBtn.textContent = active ? 'Rendering…' : '🎙 Test with my mic';
  };

  const setCapturing = (active: boolean): void => {
    capturing = active;
    meterWrap.hidden = !active;
    micBtn.classList.toggle('is-capturing', active);
    micBtn.disabled = active;
    uploadInput.disabled = active;
    if (!active) setMeter(0);
    refreshStop();
  };

  const revokeUrl = (): void => {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  };

  function playBlob(blob: Blob): void {
    revokeUrl();
    objectUrl = URL.createObjectURL(blob);
    player.src = objectUrl;
    player.hidden = false;
    void player.play().catch(() => {
      /* autoplay may be blocked — the visible controls let the user press play */
    });
    refreshStop();
  }

  async function renderAndPlay(blob: Blob): Promise<void> {
    const graph = resolveVoiceGraph(panel.getConfig());
    if (!stylizedGraphIsActive(graph)) {
      setStatus('No active effect to test — enable voice effects or pick a character voice.');
      return;
    }
    setRendering(true);
    setStatus('Rendering… (first run downloads the engine)');
    try {
      const { processAudioWithGraph } = await import('./audio-render');
      const result = await processAudioWithGraph(
        blob,
        graph,
        (ratio) => setStatus(`Rendering… ${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`),
        { maxDurationSeconds: PREVIEW_MAX_SECONDS },
      );
      playBlob(result.blob);
      setStatus(
        result.applied
          ? 'Playing the rendered voice — this is what bakes.'
          : 'Played unprocessed (the render fell back — see console).',
      );
    } catch (error) {
      setStatus(`Render failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRendering(false);
    }
  }

  micBtn.addEventListener('click', () => {
    if (rendering || capturing) return;
    const graph = resolveVoiceGraph(panel.getConfig());
    if (!stylizedGraphIsActive(graph)) {
      setStatus('No active effect to test — enable voice effects or pick a character voice.');
      return;
    }
    player.pause();
    setCapturing(true);
    setStatus('Requesting microphone…');
    const session = startMicTestCapture({
      maxDurationMs: MIC_TEST_DEFAULT_MAX_MS,
      onStart: () => setStatus('Recording… speak now, then “Stop & render”.'),
      onAutoStop: () => setStatus('Reached the time limit — rendering…'),
      onLevel: (level) => setMeter(level),
    });
    capture = session;
    session.done.then(
      (blob) => {
        if (capture === session) capture = null;
        setCapturing(false);
        void renderAndPlay(blob);
      },
      (error: unknown) => {
        if (capture === session) capture = null;
        setCapturing(false);
        const code = error instanceof MicTestCaptureError ? error.code : 'capture-failed';
        const message = captureErrorMessage(code);
        setStatus(message);
        if (code !== 'aborted-empty') showToast(message, code === 'permission-denied' ? 'error' : 'info');
      },
    );
  });

  uploadInput.addEventListener('change', () => {
    const file = uploadInput.files?.[0];
    if (!file) return;
    player.pause();
    void renderAndPlay(file);
    uploadInput.value = ''; // allow re-selecting the same file
  });

  stopBtn.addEventListener('click', () => {
    if (capturing) {
      capture?.stop();
      return;
    }
    player.pause();
    setStatus('Stopped.');
    refreshStop();
  });

  player.addEventListener('play', refreshStop);
  player.addEventListener('pause', refreshStop);
  player.addEventListener('ended', refreshStop);

  return {
    dispose() {
      capture?.cancel();
      capture = null;
      player.pause();
      revokeUrl();
      slot.innerHTML = '';
      slot.classList.remove('audition');
    },
  };
}
