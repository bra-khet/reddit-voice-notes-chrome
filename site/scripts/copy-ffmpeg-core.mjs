/*
 * Vendor the SINGLE-THREADED @ffmpeg/core into public/assets/ffmpeg/ so the
 * studio self-hosts the ~30 MB wasm (required for byte-identical fidelity, and
 * the single-threaded core needs no SharedArrayBuffer → works on GitHub Pages,
 * which cannot set COOP/COEP headers).
 *
 * Idempotent + tolerant: runs on postinstall and prebuild. The vendored files
 * are git-ignored (see site/.gitignore) — they are produced from node_modules.
 */
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..'); // site/
const coreDir = join(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');
const target = join(root, 'public', 'assets', 'ffmpeg');
const files = ['ffmpeg-core.js', 'ffmpeg-core.wasm'];

if (!existsSync(join(coreDir, 'ffmpeg-core.wasm'))) {
  console.warn('[vendor:ffmpeg] @ffmpeg/core not installed yet — run `npm install`. Skipping.');
  process.exit(0);
}

mkdirSync(target, { recursive: true });
for (const file of files) cpSync(join(coreDir, file), join(target, file));
console.log('[vendor:ffmpeg] Copied ffmpeg-core.{js,wasm} → public/assets/ffmpeg/');
