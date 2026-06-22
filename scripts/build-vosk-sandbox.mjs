import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = join(root, 'public', 'vosk-sandbox.js');
const watch = process.argv.includes('--watch');

mkdirSync(dirname(outfile), { recursive: true });

const IDBFS_SYNC_REJECT =
  'if(err){reject("Failed to sync file system: "+err);}';
const IDBFS_SYNC_SKIP =
  'if(err){log("File system sync skipped: "+err,1);resolve();}';
const MODEL_URL_RESOLVE_OLD =
  'const fullModelUrl = new URL(modelUrl, location.href.replace(/^blob:/, ""));';
// BUG-014: blob:null worker location → invalid base "null/<uuid>" after stripping blob: prefix.
const MODEL_URL_RESOLVE_NEW =
  'const fullModelUrl = (modelUrl.includes("://") ? new URL(modelUrl) : new URL(modelUrl, "https://invalid.invalid/"));';

/** Patch embedded vosk-browser worker for manifest sandbox / blob:null constraints. */
function patchVoskEmbeddedWorker(contents) {
  const match = contents.match(/createBase64WorkerFactory\('([^']+)'/);
  if (!match) {
    throw new Error('Could not find vosk-browser embedded worker payload');
  }

  let decoded = Buffer.from(match[1], 'base64').toString('utf8');
  if (!decoded.includes(IDBFS_SYNC_REJECT)) {
    throw new Error('vosk-browser IDBFS syncFilesystem patch target missing — update patchVoskEmbeddedWorker()');
  }
  if (!decoded.includes(MODEL_URL_RESOLVE_OLD)) {
    throw new Error('vosk-browser model URL resolve patch target missing — update patchVoskEmbeddedWorker()');
  }

  decoded = decoded.replace(IDBFS_SYNC_REJECT, IDBFS_SYNC_SKIP);
  decoded = decoded.replace(MODEL_URL_RESOLVE_OLD, MODEL_URL_RESOLVE_NEW);
  const reb64 = Buffer.from(decoded, 'utf8').toString('base64');
  return contents.replace(match[1], reb64);
}

function voskBrowserToEsm(contents) {
  // BUG FIX: vosk-browser is UMD-only — esbuild ESM named imports become undefined (BUG-012).
  let next = patchVoskEmbeddedWorker(contents);
  const unwrapped = next.replace(
    /\(function \(global, factory\) \{[\s\S]*?\}\)\(this, \(function \(exports\) \{/,
    'const __voskExports = {};\n(function (exports) {',
  );
  if (unwrapped === next) {
    throw new Error('vosk-browser UMD wrapper not recognized — update voskBrowserToEsm()');
  }

  return unwrapped.replace(
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