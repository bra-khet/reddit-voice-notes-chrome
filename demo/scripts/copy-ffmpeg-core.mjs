/*
 * Vendor the SINGLE-THREADED @ffmpeg/core into public/ffmpeg/ so the studio
 * self-hosts the ~30 MB wasm (required for byte-identical fidelity, and the
 * single-threaded core needs no SharedArrayBuffer → works on GitHub Pages,
 * which cannot set COOP/COEP headers).
 *
 * CHANGED: target moved public/assets/ffmpeg/ → public/ffmpeg/ (v6.0 Track D).
 * WHY: the hosted Design Studio runs the extension's own src/ffmpeg/ffmpeg-runner.ts,
 *      which resolves the core with browser.runtime.getURL('ffmpeg/ffmpeg-core.js').
 *      The extension serves that from its public/ffmpeg/, so mirroring the same
 *      layout here makes getURL correct on both hosts with no branch. Holding two
 *      copies to satisfy two paths would put 31 MB twice into the deploy artifact.
 *      The Voice Lab's own loader (src/studio/audio-render.ts) moved with it.
 *
 * Idempotent + tolerant: runs on postinstall and prebuild. The vendored files
 * are git-ignored (see demo/.gitignore) — they are produced from node_modules.
 *
 * Deliberately mirrors ../scripts/copy-ffmpeg-core.mjs (the extension's), because
 * the hosted Studio now loads FFmpeg through the extension's own runner and both
 * hosts must present an identical /ffmpeg/ tree.
 */
import { cpSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..'); // demo/
const coreDir = join(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');
const ffmpegEsmDir = join(root, 'node_modules', '@ffmpeg', 'ffmpeg', 'dist', 'esm');
const target = join(root, 'public', 'ffmpeg');
const files = ['ffmpeg-core.js', 'ffmpeg-core.wasm'];

if (!existsSync(join(coreDir, 'ffmpeg-core.wasm'))) {
  console.warn('[vendor:ffmpeg] @ffmpeg/core not installed yet — run `npm install`. Skipping.');
  process.exit(0);
}

function copyDirRecursive(source, destination) {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) copyDirRecursive(from, to);
    else if (entry.isFile() && !entry.name.endsWith('.ts')) cpSync(from, to);
  }
}

mkdirSync(target, { recursive: true });
for (const file of files) cpSync(join(coreDir, file), join(target, file));

// BUG FIX: hosted Studio transcode died during 'loading-wasm'
// Fix: ffmpeg-runner.ts loads esm/worker.js as a MODULE worker, and that worker
//      imports ./const.js, ./classes.js, ./errors.js and friends at runtime.
//      Vendoring the two core files alone left every sibling missing. Copy the
//      whole @ffmpeg/ffmpeg dist/esm tree, exactly as the extension's script does.
//      Under `vite preview` the absence was INVISIBLE: missing files come back
//      200 text/html, so ffmpeg-runner's own assertAssetReachable() saw a healthy
//      response and the failure only surfaced as the worker choking on HTML.
// Sync: ../scripts/copy-ffmpeg-core.mjs (same tree for the extension).
copyDirRecursive(ffmpegEsmDir, join(target, 'esm'));

console.log('[vendor:ffmpeg] Copied ffmpeg-core.{js,wasm} + @ffmpeg/ffmpeg esm/ → public/ffmpeg/');
