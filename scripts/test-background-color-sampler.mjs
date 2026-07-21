// v6.0 Track B Phase 5 — permission-free preview-canvas color sampling.
//
//   Run: node scripts/test-background-color-sampler.mjs
//
// CHANGED: cover CSS-to-bitmap coordinate mapping and guarded pixel reads.
// WHY: the in-surface eye-dropper must sample the rendered preview without browser permissions.

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-background-color-sampler-'));
const outfile = join(outdir, 'background-color-sampler.mjs');

await build({
  entryPoints: ['src/ui/design-studio/background-color-sampler.ts'],
  absWorkingDir: root,
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'silent',
});

const { canvasSamplePointFromClient, sampleCanvasColorAtClient } =
  await import(pathToFileURL(outfile).href);

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

function canvasFixture(pixel = [12, 34, 56, 255]) {
  return {
    width: 200,
    height: 100,
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 50 }),
    getContext: () => ({
      getImageData: (x, y) => ({ data: new Uint8ClampedArray(pixel), x, y }),
    }),
  };
}

console.log('Background color sampler');

check('maps CSS coordinates into bitmap coordinates', () => {
  assert.deepEqual(canvasSamplePointFromClient(canvasFixture(), 60, 45), { x: 100, y: 50 });
});

check('clamps pointer coordinates to the canvas pixel bounds', () => {
  const canvas = canvasFixture();
  assert.deepEqual(canvasSamplePointFromClient(canvas, -100, -100), { x: 0, y: 0 });
  assert.deepEqual(canvasSamplePointFromClient(canvas, 500, 500), { x: 199, y: 99 });
});

check('returns the sampled rendered pixel as a normalized hex color', () => {
  assert.equal(sampleCanvasColorAtClient(canvasFixture(), 60, 45), '#0c2238');
});

check('rejects fully transparent pixels', () => {
  assert.equal(sampleCanvasColorAtClient(canvasFixture([255, 0, 0, 0]), 60, 45), null);
});

check('fails closed for unavailable geometry, contexts, and pixel reads', () => {
  const zeroSize = { ...canvasFixture(), width: 0 };
  const noContext = { ...canvasFixture(), getContext: () => null };
  const readFailure = {
    ...canvasFixture(),
    getContext: () => ({ getImageData: () => { throw new Error('tainted'); } }),
  };
  assert.equal(canvasSamplePointFromClient(zeroSize, 60, 45), null);
  assert.equal(sampleCanvasColorAtClient(noContext, 60, 45), null);
  assert.equal(sampleCanvasColorAtClient(readFailure, 60, 45), null);
});

console.log(`\n${checks}/${checks} background color sampler checks passed.`);
rmSync(outdir, { recursive: true, force: true });
