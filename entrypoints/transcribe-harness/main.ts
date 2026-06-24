import { buildSrtFromSegments } from '@/src/transcription/srt-builder';
import { resolveVoskModelUrl } from '@/src/transcription/constants';
import { resetVoskForHarness, transcribeWebmBlob } from '@/src/transcription/transcribe-audio';

const app = document.querySelector('#app');
if (!app) throw new Error('Transcribe harness root missing');

app.innerHTML = `
  <main class="harness">
    <h1>Transcription harness</h1>
    <p class="hint">eloquent-0 manual QA — open via <code>transcribe-harness.html</code> on the extension origin.</p>
    <p class="hint">First run downloads/loads the Vosk model (~40 MB). Run <code>npm install</code> if the model is missing.</p>
    <p class="hint">Use a <strong>WebM</strong> from the recorder — MP4 and other formats are not supported in this harness.</p>
    <p class="hint">Vosk runs in a manifest <strong>sandbox</strong> iframe (<code>public/vosk-sandbox.js</code>). After host changes: <code>npm run build:vosk-sandbox</code> + reload extension.</p>
    <label class="field">
      <span>Recording (WebM)</span>
      <input type="file" id="file" accept="video/webm,audio/webm,.webm" />
    </label>
    <label class="field">
      <span>Model URL</span>
      <input type="text" id="model-url" />
    </label>
    <div class="actions">
      <button type="button" id="transcribe" disabled>Transcribe</button>
      <button type="button" id="reset-model" disabled>Unload model</button>
    </div>
    <p id="status" class="status">Pick a WebM recording to begin.</p>
    <section class="output">
      <h2>Transcript JSON</h2>
      <pre id="json"></pre>
      <h2>SRT preview</h2>
      <pre id="srt"></pre>
    </section>
  </main>
`;

const style = document.createElement('style');
style.textContent = `
  body { font-family: system-ui, sans-serif; margin: 0; padding: 1.25rem; background: #0f1115; color: #e8eaed; }
  .harness { max-width: 48rem; }
  h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
  h2 { font-size: 1rem; margin: 1.25rem 0 0.5rem; }
  .hint { color: #9aa0a6; font-size: 0.875rem; margin: 0 0 0.5rem; }
  .field { display: flex; flex-direction: column; gap: 0.35rem; margin-bottom: 0.75rem; font-size: 0.875rem; }
  .field input[type="text"] { padding: 0.45rem 0.55rem; border-radius: 6px; border: 1px solid #3c4043; background: #202124; color: inherit; }
  .actions { display: flex; gap: 0.5rem; flex-wrap: wrap; margin: 1rem 0; }
  button { padding: 0.5rem 0.85rem; border-radius: 6px; border: 1px solid #3c4043; background: #1a73e8; color: #fff; cursor: pointer; }
  button:disabled { opacity: 0.45; cursor: not-allowed; }
  button#reset-model { background: #3c4043; }
  .status { font-size: 0.875rem; min-height: 1.25rem; }
  pre { background: #202124; border: 1px solid #3c4043; border-radius: 8px; padding: 0.75rem; overflow: auto; font-size: 0.8rem; white-space: pre-wrap; word-break: break-word; }
  code { font-size: 0.8em; }
`;
document.head.appendChild(style);

const fileInput = document.querySelector<HTMLInputElement>('#file')!;
const modelUrlInput = document.querySelector<HTMLInputElement>('#model-url')!;
const transcribeBtn = document.querySelector<HTMLButtonElement>('#transcribe')!;
const resetBtn = document.querySelector<HTMLButtonElement>('#reset-model')!;
const statusEl = document.querySelector<HTMLParagraphElement>('#status')!;
const jsonEl = document.querySelector<HTMLPreElement>('#json')!;
const srtEl = document.querySelector<HTMLPreElement>('#srt')!;

modelUrlInput.value = resolveVoskModelUrl();

const WEBM_EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3] as const;

let inputBlob: Blob | null = null;

async function isWebmBlob(blob: Blob): Promise<boolean> {
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  return WEBM_EBML_MAGIC.every((byte, index) => head[index] === byte);
}

function setStatus(text: string): void {
  statusEl.textContent = text;
}

fileInput.addEventListener('change', () => {
  void (async () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    if (!(await isWebmBlob(file))) {
      inputBlob = null;
      transcribeBtn.disabled = true;
      setStatus('That file is not WebM. Use a recording from the Reddit voice recorder.');
      return;
    }

    inputBlob = file;
    transcribeBtn.disabled = false;
    resetBtn.disabled = false;
    jsonEl.textContent = '';
    srtEl.textContent = '';
    setStatus(`Loaded ${file.name} (${Math.round(file.size / 1024)} KB).`);
  })();
});

resetBtn.addEventListener('click', () => {
  void resetVoskForHarness().then(() => setStatus('Vosk model unloaded.'));
});

transcribeBtn.addEventListener('click', () => {
  void runTranscribe();
});

async function runTranscribe(): Promise<void> {
  if (!inputBlob) return;

  transcribeBtn.disabled = true;
  resetBtn.disabled = true;
  jsonEl.textContent = '';
  srtEl.textContent = '';

  const modelUrl = modelUrlInput.value.trim() || resolveVoskModelUrl();
  setStatus('Transcribing… first run loads Vosk WASM + model.');

  const started = performance.now();
  try {
    const outcome = await transcribeWebmBlob(inputBlob, {
      modelUrl,
      language: 'en-us',
      onProgress: (ratio, stage) => {
        setStatus(`${stage} — ${Math.round(ratio * 100)}%`);
      },
    });

    jsonEl.textContent = JSON.stringify(outcome.result, null, 2);
    srtEl.textContent = buildSrtFromSegments(outcome.result.segments) || '(no segments)';

    const elapsed = Math.round(performance.now() - started);
    if (outcome.fallback) {
      setStatus(`Fallback (${outcome.stage}) after ${elapsed} ms.`);
    } else {
      setStatus(
        `Done — ${outcome.result.segments.length} segment(s), ${outcome.result.text.length} chars in ${outcome.elapsedMs} ms (UI ${elapsed} ms).`,
      );
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    setStatus(`Error: ${detail}`);
  } finally {
    transcribeBtn.disabled = false;
    resetBtn.disabled = false;
  }
}