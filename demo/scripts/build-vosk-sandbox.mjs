/*
 * Vendor the Vosk sandbox page into demo/public/ so the hosted Design Studio's
 * transcription iframe (src/transcription/vosk-sandbox-client.ts → getURL(
 * 'vosk-sandbox.html')) resolves on GitHub Pages:
 *
 *   demo/public/vosk-sandbox.js    ← built from src/transcription/vosk-sandbox-entry.ts
 *   demo/public/vosk-sandbox.html  ← copied from ../public/vosk-sandbox.html (committed)
 *
 * The .js is ALWAYS rebuilt from source (never copied from the extension's git-
 * ignored ../public/vosk-sandbox.js, which does not exist on the Pages runner). The
 * bundling + worker patch are shared with the extension via ../scripts/vosk-sandbox-
 * build.mjs, so the two artifacts cannot drift. esbuild and vosk-browser both resolve
 * out of demo/node_modules — the only tree `npm ci` installs in CI — with nodePaths
 * pointing the shared builder's bare `vosk-browser` import at it (the entry lives
 * under the repo root, so esbuild would otherwise search root/node_modules, absent
 * in CI).
 *
 * Idempotent + tolerant, like ./copy-ffmpeg-core.mjs. Git-ignored, produced on
 * postinstall/prebuild.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { buildVoskSandbox } from '../../scripts/vosk-sandbox-build.mjs';

const demoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(demoRoot, '..');
const publicDir = join(demoRoot, 'public');
const outfile = join(publicDir, 'vosk-sandbox.js');
const htmlSource = join(repoRoot, 'public', 'vosk-sandbox.html');
const htmlTarget = join(publicDir, 'vosk-sandbox.html');
const watch = process.argv.includes('--watch');

if (!existsSync(join(demoRoot, 'node_modules', 'vosk-browser'))) {
  console.warn('[vendor:vosk] vosk-browser not installed yet — run `npm install`. Skipping sandbox build.');
  process.exit(0);
}

mkdirSync(publicDir, { recursive: true });

// vosk-browser is resolved bare inside the shared builder, whose file lives under the
// repo root; point esbuild at demo/node_modules so CI (demo-only deps) resolves it.
await buildVoskSandbox({
  esbuild,
  outfile,
  watch,
  nodePaths: [join(demoRoot, 'node_modules')],
});

if (existsSync(htmlSource)) {
  copyFileSync(htmlSource, htmlTarget);
  console.log('[vendor:vosk] copied vosk-sandbox.html → demo/public/');
} else {
  throw new Error(`[vendor:vosk] ../public/vosk-sandbox.html missing at ${htmlSource}`);
}
