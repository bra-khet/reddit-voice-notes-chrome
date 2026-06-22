import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = join(root, 'public', 'vosk-sandbox.js');
const watch = process.argv.includes('--watch');

mkdirSync(dirname(outfile), { recursive: true });

const buildOptions = {
  entryPoints: [join(root, 'src/transcription/vosk-sandbox-entry.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome120',
  sourcemap: true,
  logLevel: 'info',
  // CHANGED: self-contained sandbox bundle — must not depend on WXT/Vite dev server (null-origin CORS).
  // WHY: manifest sandbox pages cannot load localhost HMR scripts in npm run dev.
};

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log('Watching vosk-sandbox.js…');
} else {
  await esbuild.build(buildOptions);
  console.log('Built public/vosk-sandbox.js');
}