import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const voskBundle = join(root, 'node_modules', 'vosk-browser', 'dist', 'vosk.js');
const outfile = join(root, 'public', 'vosk-emscripten-worker.js');

const source = readFileSync(voskBundle, 'utf8');
const match = source.match(/createBase64WorkerFactory\('([^']+)'/);
if (!match) {
  throw new Error('Could not find vosk-browser embedded worker payload');
}

const decoded = Buffer.from(match[1], 'base64').toString('utf8');
// Match vosk-browser createURL(): skip rollup banner line, ship worker body as classic script.
const start = decoded.indexOf('\n', 10) + 1;
const body = decoded.slice(start);

writeFileSync(outfile, body, 'utf8');
console.log(`Extracted public/vosk-emscripten-worker.js (${(body.length / 1_048_576).toFixed(1)} MB)`);