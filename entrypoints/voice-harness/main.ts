import { processAudio, processAudioWithGraph } from '@/src/voice/process-audio';
import { VOICE_EFFECT_PRESETS, voiceConfigFromPreset } from '@/src/voice/presets';
import { DEFAULT_VOICE_EFFECT_CONFIG, type VoiceEffectPresetId } from '@/src/voice/types';
import {
  createFragment,
  orderFragmentsCanonically,
  FRAGMENT_DEFS,
  FRAGMENT_KINDS,
  STYLIZED_GRAPH_VERSION,
  type AnyFragment,
  type StylizedGraph,
} from '@/src/voice/dsp';

const app = document.querySelector('#app');
if (!app) throw new Error('Voice harness root missing');

app.innerHTML = `
  <main class="harness">
    <h1>Voice processor harness</h1>
    <p class="hint">Dulcet II (v5) manual QA — open via <code>voice-harness.html</code> on the extension origin.</p>
    <label class="field">
      <span>Recording (WebM)</span>
      <input type="file" id="file" accept="video/webm,audio/webm,.webm" />
    </label>
    <fieldset class="field">
      <span>Pipeline</span>
      <label class="radio"><input type="radio" name="pipeline" value="graph" checked /> Graph (v5 fragments)</label>
      <label class="radio"><input type="radio" name="pipeline" value="legacy" /> Legacy (v3 config)</label>
    </fieldset>
    <label class="field" id="preset-field">
      <span>Preset (legacy)</span>
      <select id="preset"></select>
    </label>
    <label class="field">
      <span>Pitch (semitones) — drives pitchFormant in graph mode</span>
      <input type="range" id="pitch" min="-12" max="12" step="1" value="0" />
      <output id="pitch-val">0</output>
    </label>
    <fieldset class="field" id="fragments-field">
      <span>Fragments (v5) — toggle stylized building blocks (default params)</span>
      <div id="fragments"></div>
    </fieldset>
    <div class="actions">
      <button type="button" id="process" disabled>Process audio</button>
      <button type="button" id="noop" disabled>Run disabled (no-op)</button>
    </div>
    <p id="status" class="status">Pick a WebM recording to begin.</p>
    <p id="graph-summary" class="hint"></p>
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
  .harness { max-width: 44rem; }
  h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
  .hint { color: #9aa0a6; font-size: 0.875rem; margin: 0 0 1rem; }
  .field { display: flex; flex-direction: column; gap: 0.35rem; margin-bottom: 0.75rem; font-size: 0.875rem; border: none; padding: 0; }
  fieldset.field > span { font-weight: 600; }
  .radio { display: inline-flex; gap: 0.3rem; align-items: center; font-weight: 400; }
  .actions { display: flex; gap: 0.5rem; flex-wrap: wrap; margin: 1rem 0; }
  button { padding: 0.5rem 0.85rem; border-radius: 6px; border: 1px solid #3c4043; background: #1a73e8; color: #fff; cursor: pointer; }
  button:disabled { opacity: 0.45; cursor: not-allowed; }
  button#noop { background: #3c4043; }
  .status { font-size: 0.875rem; min-height: 1.25rem; }
  .players { display: grid; gap: 1rem; margin-top: 1rem; }
  audio { width: 100%; }
  code { font-size: 0.8em; }
  #fragments { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.25rem 1rem; }
  #fragments .cat { grid-column: 1 / -1; color: #9aa0a6; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; margin-top: 0.4rem; }
  #fragments label { display: inline-flex; gap: 0.4rem; align-items: center; font-weight: 400; }
`;
document.head.appendChild(style);

const fileInput = document.querySelector<HTMLInputElement>('#file')!;
const presetSelect = document.querySelector<HTMLSelectElement>('#preset')!;
const presetField = document.querySelector<HTMLLabelElement>('#preset-field')!;
const fragmentsField = document.querySelector<HTMLFieldSetElement>('#fragments-field')!;
const fragmentsBox = document.querySelector<HTMLDivElement>('#fragments')!;
const pitchInput = document.querySelector<HTMLInputElement>('#pitch')!;
const pitchVal = document.querySelector<HTMLOutputElement>('#pitch-val')!;
const processBtn = document.querySelector<HTMLButtonElement>('#process')!;
const noopBtn = document.querySelector<HTMLButtonElement>('#noop')!;
const statusEl = document.querySelector<HTMLParagraphElement>('#status')!;
const graphSummary = document.querySelector<HTMLParagraphElement>('#graph-summary')!;
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

// Build a checkbox per fragment kind (grouped by category), pitchFormant excluded
// because the pitch slider drives it.
let lastCategory = '';
for (const kind of FRAGMENT_KINDS) {
  if (kind === 'pitchFormant') continue;
  const def = FRAGMENT_DEFS[kind];
  if (def.category !== lastCategory) {
    lastCategory = def.category;
    const head = document.createElement('div');
    head.className = 'cat';
    head.textContent = def.category;
    fragmentsBox.appendChild(head);
  }
  const label = document.createElement('label');
  label.title = def.blurb;
  label.innerHTML = `<input type="checkbox" id="frag-${kind}" value="${kind}" /> ${def.label}`;
  fragmentsBox.appendChild(label);
}

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function revokeOutputUrl(): void {
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  outputUrl = null;
}

function usingGraph(): boolean {
  return (document.querySelector<HTMLInputElement>('input[name="pipeline"]:checked')?.value ?? 'graph') === 'graph';
}

function syncPipelineUi(): void {
  const graph = usingGraph();
  presetField.style.display = graph ? 'none' : 'flex';
  fragmentsField.style.display = graph ? 'flex' : 'none';
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

function buildGraph(): StylizedGraph {
  const fragments: AnyFragment[] = [];
  const semitones = Number.parseInt(pitchInput.value, 10);
  if (semitones !== 0) fragments.push(createFragment('pitchFormant', { semitones }));
  for (const kind of FRAGMENT_KINDS) {
    if (kind === 'pitchFormant') continue;
    const cb = document.querySelector<HTMLInputElement>(`#frag-${kind}`);
    if (cb?.checked) fragments.push(createFragment(kind) as AnyFragment);
  }
  return {
    version: STYLIZED_GRAPH_VERSION,
    enabled: fragments.length > 0,
    intensity: 10,
    turbo: false,
    fragments: orderFragmentsCanonically(fragments),
  };
}

document.querySelectorAll('input[name="pipeline"]').forEach((el) => {
  el.addEventListener('change', syncPipelineUi);
});

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
  graphSummary.textContent = '';

  const onProgress = (ratio: number, stage: string) => {
    setStatus(`Processing — ${stage} ${Math.round(ratio * 100)}%`);
  };

  const started = performance.now();
  try {
    let result;
    if (useNoop) {
      setStatus('Processing (disabled / no-op)…');
      result = await processAudio(inputBlob, DEFAULT_VOICE_EFFECT_CONFIG, onProgress);
    } else if (usingGraph()) {
      const graph = buildGraph();
      graphSummary.textContent = `Graph: ${graph.fragments.map((f) => f.kind).join(' → ') || '(empty)'}`;
      setStatus('Processing (graph)… first run loads FFmpeg WASM.');
      result = await processAudioWithGraph(inputBlob, graph, onProgress);
    } else {
      setStatus(`Processing (${presetSelect.value})… first run loads FFmpeg WASM.`);
      result = await processAudio(inputBlob, buildConfig(), onProgress);
    }

    outputUrl = URL.createObjectURL(result.blob);
    outputAudio.src = outputUrl;

    const elapsed = Math.round(performance.now() - started);
    if (result.fallback) {
      setStatus(`Fallback to raw input after ${elapsed} ms (${result.stage}). Check console for the ffmpeg log.`);
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

syncPipelineUi();
processBtn.addEventListener('click', () => void runProcess(false));
noopBtn.addEventListener('click', () => void runProcess(true));
