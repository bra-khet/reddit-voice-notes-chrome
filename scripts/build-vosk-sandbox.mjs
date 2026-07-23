/*
 * Build the extension's manifest sandbox bundle → public/vosk-sandbox.js.
 *
 * The bundling + vosk-browser worker patch now live in scripts/vosk-sandbox-build.mjs
 * so the hosted Design Studio (demo/scripts/build-vosk-sandbox.mjs) produces the same
 * artifact from the same source. esbuild is imported HERE (root node_modules) and
 * injected, so the shared builder never resolves a bare specifier against a tree that
 * may be absent in CI.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { buildVoskSandbox } from './vosk-sandbox-build.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = join(root, 'public', 'vosk-sandbox.js');
const watch = process.argv.includes('--watch');

await buildVoskSandbox({ esbuild, outfile, watch });

if (!watch) console.log('Built public/vosk-sandbox.js');
