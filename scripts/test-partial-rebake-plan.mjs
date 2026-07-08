// v5.6.0 — Partial re-bake planner tests: keyframe-grid snapping, span merge,
// coverage-based strategy choice, and the honest degenerate cases.
//
//   Run:  node scripts/test-partial-rebake-plan.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-partial-rebake-'));
const outfile = join(outdir, 'bundle.mjs');

await build({
  entryPoints: [join(root, 'src/editing/partial-rebake-coordinator.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { '@': root },
  logLevel: 'silent',
});

const {
  PARTIAL_REBAKE_MAX_COVERAGE,
  PARTIAL_REBAKE_PLAN_STAGE,
  coordinateRebake,
  planPartialRebake,
} = await import(pathToFileURL(outfile).href);

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}
async function checkAsync(name, fn) {
  await fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

const BASE = { durationSeconds: 60, fps: 24, keyframeIntervalSeconds: 2 };

console.log('planPartialRebake');

check('stage label is plan-only and distinct from execution stages', () => {
  assert.equal(PARTIAL_REBAKE_PLAN_STAGE, 'partial-rebake-plan');
});

check('no windows → none', () => {
  const plan = planPartialRebake({ ...BASE, windows: [] });
  assert.equal(plan.strategy, 'none');
  assert.equal(plan.coverageRatio, 0);
});

check('one small window snaps outward to the keyframe grid', () => {
  const plan = planPartialRebake({
    ...BASE,
    windows: [{ startSeconds: 5.2, endSeconds: 6.1 }],
  });
  assert.equal(plan.strategy, 'partial');
  assert.equal(plan.spans.length, 1);
  assert.equal(plan.spans[0].startSeconds, 4); // floor to 2s grid
  assert.equal(plan.spans[0].endSeconds, 8); // ceil to 2s grid
  assert.equal(plan.spans[0].startFrame, 96);
  assert.equal(plan.spans[0].frameCount, 96);
});

check('adjacent grid spans merge into one splice span', () => {
  const plan = planPartialRebake({
    ...BASE,
    windows: [
      { startSeconds: 5, endSeconds: 6.5 }, // grid 4–8
      { startSeconds: 8.5, endSeconds: 9 }, // grid 8–10, touches 4–8 at 8
    ],
  });
  assert.equal(plan.strategy, 'partial');
  assert.equal(plan.spans.length, 1);
  assert.equal(plan.spans[0].startSeconds, 4);
  assert.equal(plan.spans[0].endSeconds, 10);
});

check('separated windows keep separate spans', () => {
  const plan = planPartialRebake({
    ...BASE,
    windows: [
      { startSeconds: 5, endSeconds: 6 },
      { startSeconds: 40, endSeconds: 41 },
    ],
  });
  assert.equal(plan.spans.length, 2);
});

check('high coverage falls back to full with an honest reason', () => {
  const plan = planPartialRebake({
    ...BASE,
    windows: [{ startSeconds: 0, endSeconds: BASE.durationSeconds * PARTIAL_REBAKE_MAX_COVERAGE + 5 }],
  });
  assert.equal(plan.strategy, 'full');
  assert.equal(plan.spans.length, 0);
  assert.match(plan.reason, /full composite/i);
});

check('span end clamps to clip end; degenerate timeline → full', () => {
  const clamped = planPartialRebake({
    ...BASE,
    windows: [{ startSeconds: 59, endSeconds: 59.9 }],
  });
  assert.equal(clamped.spans[0].endSeconds, 60);

  const invalid = planPartialRebake({ ...BASE, durationSeconds: 0, windows: [] });
  assert.equal(invalid.strategy, 'full');
});

console.log('coordinateRebake (scaffold seam)');

await checkAsync('none short-circuits without executing', async () => {
  let ran = false;
  const result = await coordinateRebake(
    planPartialRebake({ ...BASE, windows: [] }),
    async () => {
      ran = true;
      return new Blob(['x']);
    },
  );
  assert.equal(result.executed, 'none');
  assert.equal(result.blob, null);
  assert.equal(ran, false);
});

await checkAsync('partial plan executes FULL composite (honest scaffold) with plan attached', async () => {
  const plan = planPartialRebake({
    ...BASE,
    windows: [{ startSeconds: 5, endSeconds: 6 }],
  });
  const marker = new Blob(['full-output']);
  const result = await coordinateRebake(plan, async () => marker);
  assert.equal(result.executed, 'full');
  assert.equal(result.blob, marker);
  assert.equal(result.plan.strategy, 'partial');
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-partial-rebake-plan: ${checks} checks passed`);
