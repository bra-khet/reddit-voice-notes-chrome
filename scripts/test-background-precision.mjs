// v6.0 Track B Phase 2 — precision background nudge math.
//
//   Run: node scripts/test-background-precision.mjs
//
// CHANGED: pin coarse/fine axis nudges and canonical [0,1] clamping.
// WHY: the mini widget and persisted layout must never disagree at numeric boundaries.

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-background-precision-'));
const outfile = join(outdir, 'background-precision.mjs');

await build({
  entryPoints: ['src/ui/design-studio/background-precision.ts'],
  absWorkingDir: root,
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'silent',
});

const {
  BACKGROUND_POSITION_COARSE_STEP,
  BACKGROUND_POSITION_FINE_STEP,
  nudgeBackgroundPosition,
} = await import(pathToFileURL(outfile).href);

const baseLayout = {
  scaleMode: 'fill',
  position: 'center',
  customPosition: { x: 0.5, y: 0.5 },
  manualScale: 1.25,
  dim: 0.42,
  blur: 3,
  blendMode: 'multiply',
  blendPlateSource: 'custom',
  blendPlateColor: '#456789',
  holo: true,
  gifSpeed: 1.5,
  gifReactToAudio: true,
  lockToSafeText: false,
};

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

console.log('Background precision');

check('exports the specified fine and coarse increments', () => {
  assert.equal(BACKGROUND_POSITION_FINE_STEP, 0.01);
  assert.equal(BACKGROUND_POSITION_COARSE_STEP, 0.05);
});

check('fine horizontal nudge changes x only', () => {
  const next = nudgeBackgroundPosition(baseLayout, 'x', BACKGROUND_POSITION_FINE_STEP);
  assert.deepEqual(next.customPosition, { x: 0.51, y: 0.5 });
});

check('coarse vertical nudge changes y only', () => {
  const next = nudgeBackgroundPosition(baseLayout, 'y', -BACKGROUND_POSITION_COARSE_STEP);
  assert.deepEqual(next.customPosition, { x: 0.5, y: 0.45 });
});

check('nudges clamp at both normalized edges', () => {
  const low = nudgeBackgroundPosition(
    { ...baseLayout, customPosition: { x: 0.001, y: 0.999 } },
    'x',
    -BACKGROUND_POSITION_FINE_STEP,
  );
  const high = nudgeBackgroundPosition(low, 'y', BACKGROUND_POSITION_FINE_STEP);
  assert.deepEqual(high.customPosition, { x: 0, y: 1 });
});

check('position nudges preserve every non-position layout field', () => {
  const next = nudgeBackgroundPosition(baseLayout, 'x', BACKGROUND_POSITION_COARSE_STEP);
  assert.deepEqual(
    { ...next, customPosition: baseLayout.customPosition },
    baseLayout,
  );
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-background-precision: ${checks} checks passed`);
