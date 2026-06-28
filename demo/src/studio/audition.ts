/**
 * Static Voice Studio — audition (Phase 3).
 *
 * Mirrors the extension Voice panel's audition flow: render the ACTIVE graph
 * through ffmpeg.wasm and play it back, with a shared Stop + a single player.
 * Inputs here are: bundled sample voice notes (Phase 7 — "Tina" reading a few
 * famous passages), a live mic One-Time Test (transient, never persisted — uses
 * the verbatim-ported mic-test-capture.ts), and an upload-your-own-clip fallback.
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

/**
 * Bundled sample voice notes (Phase 7). The clips are the voice of
 * 인카니예지 예시타투 (a.k.a. "Tina") reading well-known passages; the chip label is
 * the source (see public/assets/samples/README.md). Clicking a chip renders the
 * clip through the ACTIVE voice graph so you can hear your character on real
 * speech — or, when no effect is active, plays the original clip as a reference.
 */
interface SampleClip {
  file: string;
  label: string;
  aria: string;
}
const SAMPLES: readonly SampleClip[] = [
  { file: 'tina-clip1-hamlet.mp3', label: 'Hamlet', aria: 'Tina reads Hamlet' },
  { file: 'tina-clip2-laotzu.mp3', label: 'Lao Tzu', aria: 'Tina reads Lao Tzu' },
  { file: 'tina-clip3-einstein.mp3', label: 'Einstein', aria: 'Tina reads Einstein' },
  {
    file: 'tina-clip4-emeraldtab.mp3',
    label: 'Hermes Trismegistus',
    aria: 'Tina reads Hermes Trismegistus, the Emerald Tablet',
  },
  { file: 'tina-clip5-lumicopypasta.mp3', label: 'Lumi', aria: 'Tina reads Lumi' },
];
/** Base-aware public-asset URLs (resolve both in dev and under the Pages base). */
const sampleUrl = (file: string): string => `${import.meta.env.BASE_URL}assets/samples/${file}`;
/** The 9-slice chip frame (same vector asset as the nav banner), applied as a base-aware border-image. */
const CHIP_FRAME_URL = `${import.meta.env.BASE_URL}assets/design-studio-v4/panels/nav-chip-9slice.svg`;

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

    <div class="audition__samples">
      <p class="audition__samples-caption">Try a sample — <strong>Tina</strong> reads:</p>
      <div class="audition__samples-row" role="group" aria-label="Sample voice notes">
        ${SAMPLES.map(
          (sample) => `
        <button type="button" class="sample-chip" data-sample="${sample.file}" aria-label="Play sample — ${sample.aria}">
          <span class="sample-chip__label">${sample.label}</span>
        </button>`,
        ).join('')}
      </div>
    </div>

    <p class="audition__note">…or test with your own audio:</p>
    <div class="audition__tests">
      <button type="button" class="audition__btn audition__btn--primary" data-mic>🎙 Test with my mic</button>
      <label class="audition__btn">
        Upload a clip
        <input type="file" accept="audio/*" data-upload hidden />
      </label>
    </div>
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
  const sampleChips = Array.from(slot.querySelectorAll<HTMLButtonElement>('.sample-chip'));

  // Apply the 9-slice chip frame as a base-aware border-image (same vector asset
  // as the nav banner; slice + width live in CSS). See audition.css .sample-chip.
  for (const chip of sampleChips) {
    chip.style.borderImageSource = `url("${CHIP_FRAME_URL}")`;
  }

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

  const setSamplesDisabled = (disabled: boolean): void => {
    for (const chip of sampleChips) chip.disabled = disabled;
  };

  const setRendering = (active: boolean): void => {
    rendering = active;
    micBtn.disabled = active || capturing;
    uploadInput.disabled = active || capturing;
    setSamplesDisabled(active || capturing);
    micBtn.textContent = active ? 'Rendering…' : '🎙 Test with my mic';
  };

  const setCapturing = (active: boolean): void => {
    capturing = active;
    meterWrap.hidden = !active;
    micBtn.classList.toggle('is-capturing', active);
    micBtn.disabled = active;
    uploadInput.disabled = active;
    setSamplesDisabled(active || rendering);
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

  async function playSampleClip(sample: SampleClip): Promise<void> {
    if (rendering || capturing) return;
    player.pause();
    setStatus(`Loading “${sample.label}”…`);
    let blob: Blob;
    try {
      const response = await fetch(sampleUrl(sample.file));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      blob = await response.blob();
    } catch (error) {
      setStatus(`Couldn’t load “${sample.label}” — ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    // With an active voice, render the clip so you hear your character on real
    // speech; with no effect active, play the original as a reference (graceful,
    // rather than refusing — these chips are also a "what does Tina sound like?" demo).
    const graph = resolveVoiceGraph(panel.getConfig());
    if (stylizedGraphIsActive(graph)) {
      await renderAndPlay(blob);
    } else {
      playBlob(blob);
      setStatus(`Playing “${sample.label}” (original) — enable a voice to hear it transformed.`);
    }
  }

  for (const chip of sampleChips) {
    const file = chip.dataset.sample;
    const sample = SAMPLES.find((s) => s.file === file);
    if (sample) chip.addEventListener('click', () => void playSampleClip(sample));
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
