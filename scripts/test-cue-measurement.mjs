// Pure cue fit classification for real-canvas measurement (Phase 1).
//
//   Run:  node scripts/test-cue-measurement.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-cue-measure-'));

async function bundle(entry, name) {
  const outfile = join(outdir, `${name}.mjs`);
  await build({
    entryPoints: [join(root, entry)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    alias: { '@': root },
    logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href);
}

const {
  classifyCueFitStatus,
  buildCueRenderedSizeResult,
  heuristicTierNeedsRealCanvas,
} = await bundle('src/transcription/subtitle-cue-measurement.ts', 'measure');

const {
  classifyHeuristicMeasureTier,
  heuristicSkipsRealCanvasMeasure,
  heuristicNeedsRealCanvasMeasure,
  SMART_SPLIT_HEURISTIC_COMFORT_RATIO,
} = await bundle('src/utils/text-metrics.ts', 'metrics');

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

const BUDGET = 381;

console.log('classifyHeuristicMeasureTier (two-tier pre-filter)\n');

check('well under budget → comfortable (skip real canvas)', () => {
  const width = BUDGET * 0.5;
  assert.equal(classifyHeuristicMeasureTier(width, BUDGET), 'comfortable');
  assert.equal(heuristicSkipsRealCanvasMeasure(width, BUDGET), true);
  assert.equal(heuristicNeedsRealCanvasMeasure(width, BUDGET), false);
});

check('marginal band → needs real canvas', () => {
  const width = BUDGET * 0.9;
  assert.equal(classifyHeuristicMeasureTier(width, BUDGET), 'marginal');
  assert.equal(heuristicTierNeedsRealCanvas('marginal'), true);
  assert.equal(heuristicNeedsRealCanvasMeasure(width, BUDGET), true);
});

check('heuristic overflow → needs real canvas', () => {
  const width = BUDGET * 1.2;
  assert.equal(classifyHeuristicMeasureTier(width, BUDGET), 'overflow');
});

console.log('\nclassifyCueFitStatus (post real-canvas)\n');

check('under comfort ratio → comfortable', () => {
  const width = BUDGET * (SMART_SPLIT_HEURISTIC_COMFORT_RATIO - 0.05);
  assert.equal(classifyCueFitStatus(width, BUDGET, false), 'comfortable');
});

check('between comfort and budget → marginal', () => {
  const width = BUDGET * 0.95;
  assert.equal(classifyCueFitStatus(width, BUDGET, false), 'marginal');
});

check('over budget or frame clip → overflow', () => {
  assert.equal(classifyCueFitStatus(BUDGET + 1, BUDGET, false), 'overflow');
  assert.equal(classifyCueFitStatus(BUDGET - 10, BUDGET, true), 'overflow');
});

console.log('\nbuildCueRenderedSizeResult\n');

check('assembles overflowPx and fitStatus', () => {
  const result = buildCueRenderedSizeResult({
    renderedWidthPx: 400,
    renderedHeightPx: 48,
    maxWidthPx: BUDGET,
    frameClipped: false,
  });
  assert.equal(result.overflows, true);
  assert.equal(result.overflowPx, 400 - BUDGET);
  assert.equal(result.fitStatus, 'overflow');
});

rmSync(outdir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);