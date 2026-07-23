/*
 * Shared Vosk sandbox builder. Bundles src/transcription/vosk-sandbox-entry.ts
 * into a self-contained ESM module and patches the embedded vosk-browser worker
 * for the two constraints that each cost a bug: BUG-013 (IDBFS syncFilesystem
 * rejects fatally in a null-origin worker) and BUG-014 (blob:null worker location
 * → invalid base "null/<uuid>" after stripping the blob: prefix).
 *
 * ONE copy of that base64 worker surgery, called by both:
 *   - scripts/build-vosk-sandbox.mjs        → public/vosk-sandbox.js       (the extension)
 *   - demo/scripts/build-vosk-sandbox.mjs   → demo/public/vosk-sandbox.js  (hosted Studio)
 *
 * Sharing rather than mirroring is deliberate here. Unlike the trivial ffmpeg
 * cpSync, this patch matches exact substrings inside a base64-encoded worker and
 * throws if vosk-browser moves them. Two hand-kept copies would drift silently the
 * next time vosk-browser is bumped — exactly the "works in the extension, dies on
 * Pages" class the host-neutrality guard's rule 8 exists to stop.
 *
 * esbuild is DEPENDENCY-INJECTED, not imported here: this file lives under the repo
 * root's scripts/, but the demo caller runs on the Pages CI runner where only
 * demo/node_modules exists. Each thin wrapper imports esbuild from its own tree and
 * passes it in, so bare-specifier resolution works from either cwd (mirrors the
 * host-neutrality guard's esbuild-from-demo trick).
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = join(repoRoot, 'src/transcription/vosk-sandbox-entry.ts');

const IDBFS_SYNC_REJECT = 'if(err){reject("Failed to sync file system: "+err);}';
const IDBFS_SYNC_SKIP = 'if(err){log("File system sync skipped: "+err,1);resolve();}';
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

/** esbuild options for the sandbox bundle. `nodePaths` lets the demo resolve
 *  vosk-browser out of demo/node_modules when the root tree is absent (CI). */
export function voskSandboxBuildOptions({ outfile, nodePaths }) {
  return {
    entryPoints: [ENTRY],
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
    ...(nodePaths ? { nodePaths } : {}),
  };
}

/**
 * Build (or watch) the sandbox bundle at `outfile`.
 * @param {object} args
 * @param {object} args.esbuild   The caller's own esbuild module (dependency-injected).
 * @param {string} args.outfile   Absolute path for the emitted vosk-sandbox.js.
 * @param {boolean} [args.watch]  Rebuild on change.
 * @param {string[]} [args.nodePaths]  Extra module-resolution roots (demo/node_modules).
 */
export async function buildVoskSandbox({ esbuild, outfile, watch = false, nodePaths } = {}) {
  if (!esbuild) throw new Error('buildVoskSandbox requires an injected esbuild module');
  mkdirSync(dirname(outfile), { recursive: true });
  const options = voskSandboxBuildOptions({ outfile, nodePaths });

  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log(`Watching ${outfile}…`);
    return;
  }

  await esbuild.build(options);
  console.log(`Built ${outfile}`);
}
