import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const targetDir = join(root, 'public', 'vosk');
const targetFile = join(targetDir, 'model.tar.gz');

const MODEL_URL = 'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.tar.gz';
const MIN_BYTES = 40_000_000;

if (process.env.SKIP_VOSK_MODEL === '1') {
  console.log('SKIP_VOSK_MODEL=1 — skipping Vosk model download');
  process.exit(0);
}

if (existsSync(targetFile)) {
  const size = statSync(targetFile).size;
  if (size >= MIN_BYTES) {
    console.log(`Vosk model already present (${Math.round(size / 1_000_000)} MB) at public/vosk/model.tar.gz`);
    process.exit(0);
  }
  console.warn('Existing Vosk model file looks truncated — re-downloading…');
}

mkdirSync(targetDir, { recursive: true });

console.log('Downloading Vosk small English model (~40 MB)…');
console.log(MODEL_URL);

const response = await fetch(MODEL_URL);
if (!response.ok || !response.body) {
  throw new Error(`Vosk model download failed: HTTP ${response.status}`);
}

await pipeline(response.body, createWriteStream(targetFile));

const size = statSync(targetFile).size;
if (size < MIN_BYTES) {
  throw new Error(`Downloaded Vosk model looks too small (${size} bytes)`);
}

console.log(`Saved Vosk model to public/vosk/model.tar.gz (${Math.round(size / 1_000_000)} MB)`);