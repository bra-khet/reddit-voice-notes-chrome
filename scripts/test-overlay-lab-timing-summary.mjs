// Overlay Lab timing summary builder tests (v5.3.5).
//
//   Run:  node scripts/test-overlay-lab-timing-summary.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-lab-summary-'));
const outfile = join(outdir, 'bundle.mjs');

await build({
  entryPoints: [join(root, 'src/ui/design-studio/overlay-lab-timing-summary.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { '@': root },
  logLevel: 'silent',
});

const {
  OVERLAY_LAB_TIMING_LOG_VERSION,
  computeOverlayLabStageDurations,
  buildOverlayLabTimingSummary,
} = await import(pathToFileURL(outfile).href);

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log('overlay lab timing summary\n');

check('schema version is 2', () => {
  assert.equal(OVERLAY_LAB_TIMING_LOG_VERSION, 2);
});

check('stage breakdown extracts render and normalize', () => {
  const entries = [
    { stage: 'bake-start', elapsedMs: 0 },
    { stage: 'canvas-overlay-render', elapsedMs: 10 },
    { stage: 'canvas-overlay-render', elapsedMs: 76000 },
    { stage: 'canvas-overlay-alpha-normalize', elapsedMs: 76100 },
    { stage: 'canvas-overlay-alpha-normalize', elapsedMs: 176000 },
    { stage: 'burnin-done', elapsedMs: 285000 },
  ];
  const stages = computeOverlayLabStageDurations(entries);
  assert.equal(stages.renderMs, 75990);
  assert.equal(stages.normalizeMs, 99900);
  assert.equal(stages.compositeMs, null);
});

check('summary includes cache stats from render metrics', () => {
  const summary = buildOverlayLabTimingSummary({
    totalMs: 80000,
    durationSeconds: 70,
    cueCount: 23,
    entries: [
      { stage: 'render-start', elapsedMs: 0 },
      { stage: 'render-complete', elapsedMs: 75000 },
    ],
    renderMetrics: {
      totalFrames: 2100,
      fps: 30,
      renderWallMs: 74800,
      msPerFrame: 35.6,
      realtimeFactor: 1.068,
      cueCache: {
        enabled: true,
        phaseBuckets: 32,
        maxEntries: 64,
        hits: 1800,
        misses: 300,
        lookups: 2100,
        creates: 280,
        evictions: 0,
        uniqueKeys: 280,
        hitRate: 1800 / 2100,
      },
    },
  });
  assert.equal(summary.cueCache?.hits, 1800);
  assert.equal(summary.cueCache?.phaseBuckets, 32);
  assert.ok(summary.render.realtimeFactor > 1);
  assert.equal(summary.cueCount, 23);
});

rmSync(outdir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);