import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = join(root, 'public', 'vosk-sandbox.js');
const watch = process.argv.includes('--watch');

mkdirSync(dirname(outfile), { recursive: true });

// BUG FIX: vosk blob workers cannot use IndexedDB (BUG-011).
// Fix: extract Emscripten worker to public/vosk-emscripten-worker.js; patch Model to spawn 'self' worker.
await import('./extract-vosk-worker.mjs');

function voskBrowserToEsm(contents) {
  // BUG FIX: vosk-browser is UMD-only — esbuild ESM named imports become undefined (BUG-012).
  const unwrapped = contents.replace(
    /\(function \(global, factory\) \{[\s\S]*?\}\)\(this, \(function \(exports\) \{/,
    'const __voskExports = {};\n(function (exports) {',
  );
  if (unwrapped === contents) {
    throw new Error('vosk-browser UMD wrapper not recognized — update voskBrowserToEsm()');
  }

  return unwrapped
    .replace(
      'this.worker = new WorkerFactory();',
      // BUG-011: chrome-extension:// worker origin gets IndexedDB; blob:null workers do not.
      'this.worker = new Worker(new URL("vosk-emscripten-worker.js", import.meta.url), { type: "classic" });',
    )
    .replace(
      /\}\)\);\s*$/,
      '})(__voskExports);\nexport const Model = __voskExports.Model;\nexport const createModel = __voskExports.createModel;\n',
    );
}

const voskBrowserPlugin = {
  name: 'vosk-browser-esm',
  setup(build) {
    build.onLoad({ filter: /vosk-browser[/\\]dist[/\\]vosk\.js$/ }, async (args) => {
      const contents = voskBrowserToEsm(readFileSync(args.path, 'utf8'));
      return { contents, loader: 'js' };
    });
  },
};

const buildOptions = {
  entryPoints: [join(root, 'src/transcription/vosk-sandbox-entry.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome120',
  sourcemap: true,
  logLevel: 'info',
  plugins: [voskBrowserPlugin],
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