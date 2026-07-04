// Overlay MediaRecorder frame pacing helpers (v5.3.5 drift fix).
//
//   Run:  node scripts/test-overlay-frame-pacing.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-frame-pacing-'));
const outfile = join(outdir, 'bundle.mjs');

await build({
  entryPoints: [join(root, 'src/transcription/subtitle-overlay-renderer.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { '@': root },
  logLevel: 'silent',
});

const { frameCaptureIntervalMs, compensatedCaptureWaitMs } = await import(
  pathToFileURL(outfile).href
);

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  ✓', name);
  } catch (err) {
    failed += 1;
    console.error('  ✗', name, '\n      ', err.message);
  }
}

console.log('frameCaptureIntervalMs\n');

check('24 fps → 42 ms interval', () => {
  assert.equal(frameCaptureIntervalMs(24), 42);
});

check('30 fps → 34 ms interval', () => {
  assert.equal(frameCaptureIntervalMs(30), 34);
});

console.log('\ncompensatedCaptureWaitMs\n');

check('fast paint keeps full interval', () => {
  assert.equal(compensatedCaptureWaitMs(24, 2), 40);
});

check('slow paint subtracts elapsed time', () => {
  assert.equal(compensatedCaptureWaitMs(24, 30), 12);
});

check('paint longer than interval → zero wait (no negative)', () => {
  assert.equal(compensatedCaptureWaitMs(24, 90), 0);
});

rmSync(outdir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);