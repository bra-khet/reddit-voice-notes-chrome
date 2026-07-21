// v6.0 Track B Phase 3 — domain-neutral background interaction math.
//
//   Run: node scripts/test-interaction-utils.mjs
//
// CHANGED: pin log zoom mapping, sticky per-axis magnetism, and caption-band constraints.
// WHY: DOM wiring should stay a thin adapter around deterministic gesture behavior.

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-interaction-utils-'));
const outfile = join(outdir, 'interaction-utils.mjs');

await build({
  entryPoints: ['src/ui/design-studio/interaction-utils.ts'],
  absWorkingDir: root,
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'silent',
});

const {
  clamp01,
  constrainPointOutsideBand,
  resolveStickySnap1D,
  scaleToSlider,
  sliderToScale,
  snapPosition,
} = await import(pathToFileURL(outfile).href);

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

const near = (actual, expected) => {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`);
};

console.log('Interaction utilities');

check('clamp01 guards finite bounds and malformed values', () => {
  assert.equal(clamp01(-4), 0);
  assert.equal(clamp01(0.4), 0.4);
  assert.equal(clamp01(9), 1);
  assert.equal(clamp01(Number.NaN), 0);
});

check('scale slider maps both bounds and round-trips logarithmically', () => {
  assert.equal(sliderToScale(0, 0.5, 3), 0.5);
  near(sliderToScale(1, 0.5, 3), 3);
  for (const scale of [0.5, 0.75, 1, 1.5, 2.25, 3]) {
    near(sliderToScale(scaleToSlider(scale, 0.5, 3), 0.5, 3), scale);
  }
});

check('sticky snap acquires inside the enter threshold', () => {
  assert.deepEqual(
    resolveStickySnap1D(0.49, [0, 0.5, 1], 0.02, { snappedTo: null }),
    { value: 0.5, snappedTo: 0.5 },
  );
});

check('sticky snap holds past enter and releases past hysteresis', () => {
  assert.deepEqual(
    resolveStickySnap1D(0.53, [0, 0.5, 1], 0.02, { snappedTo: 0.5 }),
    { value: 0.5, snappedTo: 0.5 },
  );
  assert.deepEqual(
    resolveStickySnap1D(0.54, [0, 0.5, 1], 0.02, { snappedTo: 0.5 }),
    { value: 0.54, snappedTo: null },
  );
});

check('snapPosition resolves x and y independently', () => {
  assert.deepEqual(
    snapPosition(
      { x: 0.49, y: 0.34 },
      { x: [0.5], y: [1 / 3] },
      { x: 0.02, y: 0.01 },
      { x: { snappedTo: null }, y: { snappedTo: null } },
    ),
    { x: 0.5, y: 1 / 3, snapped: { x: 0.5, y: 1 / 3 } },
  );
});

check('caption-safe constraint chooses the nearest exterior edge', () => {
  near(constrainPointOutsideBand(0.75, { start: 0.7, end: 0.9 }, 0.02), 0.68);
  near(constrainPointOutsideBand(0.88, { start: 0.7, end: 0.9 }, 0.02), 0.92);
  assert.equal(constrainPointOutsideBand(0.4, { start: 0.7, end: 0.9 }, 0.02), 0.4);
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-interaction-utils: ${checks} checks passed`);
