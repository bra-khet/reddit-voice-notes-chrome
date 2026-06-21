import { processAudio } from '@/src/voice/process-audio';
import { VOICE_EFFECT_PRESETS, voiceConfigFromPreset } from '@/src/voice/presets';
import { DEFAULT_VOICE_EFFECT_CONFIG, type VoiceEffectPresetId } from '@/src/voice/types';

const app = document.querySelector('#app');
if (!app) throw new Error('Voice harness root missing');

app.innerHTML = `
  <main class="harness">
    <h1>Voice processor harness</h1>
    <p class="hint">dulcet-1 manual QA — open via <code>voice-harness.html</code> on the extension origin.</p>
    <label class="field">
      <span>Recording (WebM)</span>
      <input type="file" id="file" accept="video/webm,audio/webm,.webm" />
    </label>
    <label class="field">
      <span>Preset</span>
      <select id="preset"></select>
    </label>
    <label class="field">
      <span>Pitch (semitones)</span>
      <input type="range" id="pitch" min="-12" max="12" step="1" value="0" />
      <output id="pitch-val">0</output>
    </label>
    <div class="actions">
      <button type="button" id="process" disabled>Process audio</button>
      <button type="button" id="noop" disabled>Run disabled (no-op)</button>
    </div>
    <p id="status" class="status">Pick a WebM recording to begin.</p>
    <section class="players">
      <div>
        <h2>Input</h2>
        <audio id="input-audio" controls></audio>
      </div>
      <div>
        <h2>Output</h2>
        <audio id="output-audio" controls></audio>
      </div>
    </section>
  </main>
`;

const style = document.createElement('style');
style.textContent = `
  body { font-family: system-ui, sans-serif; margin: 0; padding: 1.25rem; background: #0f1115; color: #e8eaed; }
  .harness { max-width: 40rem; }
  h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
  .hint { color: #9aa0a6; font-size: 0.875rem; margin: 0 0 1rem; }
  .field { display: flex; flex-direction: column; gap: 0.35rem; margin-bottom: 0.75rem; font-size: 0.875rem; }
  .actions { display: flex; gap: 0.5rem; flex-wrap: wrap; margin: 1rem 0; }
  button { padding: 0.5rem 0.85rem; border-radius: 6px; border: 1px solid #3c4043; background: #1a73e8; color: #fff; cursor: pointer; }
  button:disabled { opacity: 0.45; cursor: not-allowed; }
  button#noop { background: #3c4043; }
  .status { font-size: 0.875rem; min-height: 1.25rem; }
  .players { display: grid; gap: 1rem; margin-top: 1rem; }
  audio { width: 100%; }
  code { font-size: 0.8em; }
`;
document.head.appendChild(style);

const fileInput = document.querySelector<HTMLInputElement>('#file')!;
const presetSelect = document.querySelector<HTMLSelectElement>('#preset')!;
const pitchInput = document.querySelector<HTMLInputElement>('#pitch')!;
const pitchVal = document.querySelector<HTMLOutputElement>('#pitch-val')!;
const processBtn = document.querySelector<HTMLButtonElement>('#process')!;
const noopBtn = document.querySelector<HTMLButtonElement>('#noop')!;
const statusEl = document.querySelector<HTMLParagraphElement>('#status')!;
const inputAudio = document.querySelector<HTMLAudioElement>('#input-audio')!;
const outputAudio = document.querySelector<HTMLAudioElement>('#output-audio')!;

let inputBlob: Blob | null = null;
let inputUrl: string | null = null;
let outputUrl: string | null = null;

for (const preset of VOICE_EFFECT_PRESETS) {
  const option = document.createElement('option');
  option.value = preset.id;
  option.textContent = `${preset.label} — ${preset.description}`;
  presetSelect.appendChild(option);
}

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function revokeOutputUrl(): void {
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  outputUrl = null;
}

function buildConfig() {
  const presetId = presetSelect.value as VoiceEffectPresetId;
  const config = voiceConfigFromPreset(presetId);
  const semitones = Number.parseInt(pitchInput.value, 10);
  return {
    ...config,
    presetId: 'custom' as const,
    pitchShift: {
      semitones,
      preserveDuration: true,
      exaggerateNatural: config.pitchShift?.exaggerateNatural ?? false,
    },
  };
}

presetSelect.addEventListener('change', () => {
  const preset = VOICE_EFFECT_PRESETS.find((p) => p.id === presetSelect.value);
  const semitones = preset?.config.pitchShift?.semitones ?? 0;
  pitchInput.value = String(semitones);
  pitchVal.textContent = String(semitones);
});

pitchInput.addEventListener('input', () => {
  pitchVal.textContent = pitchInput.value;
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  inputBlob = file;
  if (inputUrl) URL.revokeObjectURL(inputUrl);
  inputUrl = URL.createObjectURL(file);
  inputAudio.src = inputUrl;
  revokeOutputUrl();
  outputAudio.removeAttribute('src');
  processBtn.disabled = false;
  noopBtn.disabled = false;
  setStatus(`Loaded ${file.name} (${Math.round(file.size / 1024)} KB).`);
});

async function runProcess(useNoop: boolean): Promise<void> {
  if (!inputBlob) return;

  processBtn.disabled = true;
  noopBtn.disabled = true;
  revokeOutputUrl();
  outputAudio.removeAttribute('src');

  const config = useNoop ? DEFAULT_VOICE_EFFECT_CONFIG : buildConfig();
  const label = useNoop ? 'disabled' : presetSelect.value;
  setStatus(`Processing (${label})… first run loads FFmpeg WASM.`);

  const started = performance.now();
  try {
    const result = await processAudio(inputBlob, config, (ratio, stage) => {
      setStatus(`Processing (${label}) — ${stage} ${Math.round(ratio * 100)}%`);
    });

    outputUrl = URL.createObjectURL(result.blob);
    outputAudio.src = outputUrl;

    const elapsed = Math.round(performance.now() - started);
    if (result.fallback) {
      setStatus(`Fallback to raw input after ${elapsed} ms (${result.stage}).`);
    } else if (result.applied) {
      setStatus(`Applied ${result.stage} in ${result.elapsedMs} ms (UI ${elapsed} ms).`);
    } else {
      setStatus(`No-op (${result.stage}) — blob unchanged, ${elapsed} ms.`);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    setStatus(`Error: ${detail}`);
  } finally {
    processBtn.disabled = false;
    noopBtn.disabled = false;
  }
}

processBtn.addEventListener('click', () => void runProcess(false));
noopBtn.addEventListener('click', () => void runProcess(true));