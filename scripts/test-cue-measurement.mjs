// Bake-frame cue fit classification (Phase 1).
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
  bakeSafeInkMaxWidth,
  classifyBackdropFrameFit,
  buildCueRenderedSizeResult,
  BAKE_FRAME_SAFE_PADDING_PX,
  BAKE_COMFORT_MARGIN_PX,
  CUE_BACKDROP_BOX_BORDER_W,
  subtitlePreviewBlockTopY,
  subtitlePreviewSafeBandNormalized,
} = await bundle('src/transcription/subtitle-cue-measurement.ts', 'measure');

const { buildCaptionMetricsContext } = await bundle(
  'src/transcription/subtitle-caption-fit.ts',
  'fit',
);

const { smartSplitCaptionMaxWidth } = await bundle('src/utils/text-metrics.ts', 'metrics');

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

const BAKE_W = 640;

console.log('bakeSafeInkMaxWidth\n');

check('640px bake allows ~608px ink before backdrop hits safe edge', () => {
  const max = bakeSafeInkMaxWidth(BAKE_W, CUE_BACKDROP_BOX_BORDER_W, BAKE_FRAME_SAFE_PADDING_PX);
  assert.equal(max, 640 - 8 - 24);
});

console.log('\nclassifyBackdropFrameFit\n');

check('wide backdrop inside frame → comfortable', () => {
  const fit = classifyBackdropFrameFit(80, 560, BAKE_W);
  assert.equal(fit.overflows, false);
  assert.equal(fit.fitStatus, 'comfortable');
});

check('backdrop past right edge → overflow', () => {
  const fit = classifyBackdropFrameFit(20, BAKE_W + 10, BAKE_W);
  assert.equal(fit.overflows, true);
  assert.ok(fit.overflowPx > 0);
});

check('fits but tight margin → marginal', () => {
  const right = BAKE_W - 6;
  const left = right - 200;
  const fit = classifyBackdropFrameFit(left, right, BAKE_W);
  assert.equal(fit.overflows, false);
  assert.equal(fit.fitStatus, 'marginal');
  assert.ok(fit.comfortMarginPx < BAKE_COMFORT_MARGIN_PX);
});

console.log('\nbuildCueRenderedSizeResult\n');

check('assembles bake overflow fields', () => {
  const fit = classifyBackdropFrameFit(0, BAKE_W + 20, BAKE_W);
  const result = buildCueRenderedSizeResult(fit, BAKE_W);
  assert.equal(result.overflows, true);
  assert.equal(result.bakeWidth, BAKE_W);
});

console.log('\nsubtitle preview safe band\n');

check('safe-band geometry shares top/center/bottom preview placement', () => {
  assert.equal(subtitlePreviewBlockTopY('top', 360, 76), 29);
  assert.equal(subtitlePreviewBlockTopY('center', 360, 76), 142);
  assert.equal(subtitlePreviewBlockTopY('bottom', 360, 76), 255);
  const band = subtitlePreviewSafeBandNormalized('bottom', 22, 360, 2);
  assert.ok(Math.abs(band.start - 255 / 360) < 1e-9);
  assert.ok(Math.abs(band.end - 331 / 360) < 1e-9);
});

console.log('\nbuildCaptionMetricsContext — Smart Split word budget\n');

check('splitBudget uses bake ink max, not preview-scale heuristic', () => {
  const charMeasure = (text) => text.length;
  const metrics = buildCaptionMetricsContext(undefined, charMeasure);
  const bakeInk = bakeSafeInkMaxWidth(BAKE_W, CUE_BACKDROP_BOX_BORDER_W, BAKE_FRAME_SAFE_PADDING_PX);
  assert.equal(metrics.splitBudget, bakeInk);
  const previewBudget = smartSplitCaptionMaxWidth(undefined, 36);
  assert.ok(metrics.splitBudget > previewBudget, 'large-font preview budget was over-splitting');
});

rmSync(outdir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
