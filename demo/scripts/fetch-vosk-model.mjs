/*
 * Vendor the Vosk small-English model → demo/public/vosk/model.tar.gz, so the
 * hosted Design Studio can transcribe captions on GitHub Pages exactly as the
 * extension does (src/transcription/constants.ts → browser.runtime.getURL(
 * 'vosk/model.tar.gz'), which the web shim resolves under the Pages base).
 *
 * Two sources, in order:
 *   1. The extension's own ../public/vosk/model.tar.gz, if a root `npm install`
 *      already fetched it. Instant, offline, and byte-identical to what ships.
 *   2. A fresh download from the upstream mirror. This is the CI path: the Pages
 *      runner only `npm ci`s demo/, so the root copy does not exist there.
 *
 * Deliberately mirrors ../scripts/fetch-vosk-model.mjs (same URL, same size floor,
 * same SKIP_VOSK_MODEL escape hatch). The vendored file is git-ignored and produced
 * on postinstall/prebuild — never committed (a 40 MB blob that silently goes stale).
 */
import { copyFileSync, createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const demoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(demoRoot, '..');
const targetDir = join(demoRoot, 'public', 'vosk');
const targetFile = join(targetDir, 'model.tar.gz');
const rootModel = join(repoRoot, 'public', 'vosk', 'model.tar.gz');

// Sync: ../scripts/fetch-vosk-model.mjs — same model, same floor.
const MODEL_URL = 'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.tar.gz';
const MIN_BYTES = 40_000_000;

if (process.env.SKIP_VOSK_MODEL === '1') {
  console.log('[vendor:vosk] SKIP_VOSK_MODEL=1 — skipping Vosk model');
  process.exit(0);
}

function looksComplete(file) {
  return existsSync(file) && statSync(file).size >= MIN_BYTES;
}

if (looksComplete(targetFile)) {
  const size = statSync(targetFile).size;
  console.log(`[vendor:vosk] model already present (${Math.round(size / 1_000_000)} MB) at demo/public/vosk/model.tar.gz`);
  process.exit(0);
}

mkdirSync(targetDir, { recursive: true });

if (looksComplete(rootModel)) {
  copyFileSync(rootModel, targetFile);
  const size = statSync(targetFile).size;
  console.log(`[vendor:vosk] copied model from ../public/vosk (${Math.round(size / 1_000_000)} MB) → demo/public/vosk/model.tar.gz`);
  process.exit(0);
}

console.log('[vendor:vosk] downloading Vosk small English model (~40 MB)…');
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

console.log(`[vendor:vosk] saved model to demo/public/vosk/model.tar.gz (${Math.round(size / 1_000_000)} MB)`);
