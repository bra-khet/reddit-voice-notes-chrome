// v6.0 — long-capture visual size contract + production cap synchronization.
//
//   Run: node scripts/test-visual-size-qa.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import {
  VISUAL_SIZE_QA_BASE_MAX_BYTES,
  VISUAL_SIZE_QA_BAKED_MAX_BYTES,
  VISUAL_SIZE_QA_EXPECTED_DURATION_SECONDS,
  evaluateVisualSizeQa,
  formatVisualSizeQaReport,
} from './visual-size-qa-core.mjs';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-visual-size-qa-'));
const outfile = join(outdir, 'artifact-limits.mjs');

await build({
  stdin: {
    contents: `
      export { MAX_RECORDING_SECONDS } from './src/utils/constants.ts';
      export { LAST_BASE_MP4_MAX_BYTES } from './src/storage/last-base-mp4-db.ts';
      export { LAST_BAKED_MP4_MAX_BYTES } from './src/storage/last-baked-mp4-db.ts';
    `,
    resolveDir: root,
    sourcefile: 'visual-size-qa-limits.ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { '@': root },
  logLevel: 'silent',
});

const {
  LAST_BASE_MP4_MAX_BYTES,
  LAST_BAKED_MP4_MAX_BYTES,
  MAX_RECORDING_SECONDS,
} = await import(pathToFileURL(outfile).href);

const passingInput = {
  preset: 'classic-neon',
  base: { path: 'base.mp4', sizeBytes: 18 * 1024 * 1024, durationSeconds: 119.72 },
  baked: { path: 'baked.mp4', sizeBytes: 22 * 1024 * 1024, durationSeconds: 119.75 },
};

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

console.log('Visual size QA');

check('harness limits stay synchronized with enforced stores and recording cap', () => {
  assert.equal(VISUAL_SIZE_QA_EXPECTED_DURATION_SECONDS, MAX_RECORDING_SECONDS);
  assert.equal(VISUAL_SIZE_QA_BASE_MAX_BYTES, LAST_BASE_MP4_MAX_BYTES);
  assert.equal(VISUAL_SIZE_QA_BAKED_MAX_BYTES, LAST_BAKED_MP4_MAX_BYTES);
});

check('full-length artifacts with size headroom pass', () => {
  const report = evaluateVisualSizeQa(passingInput);
  assert.equal(report.passed, true);
  assert.equal(report.failures.length, 0);
  // 40 MiB caps (QA-6.0.0 Pass A §8-12) minus the 18/22 MiB fixture artifacts.
  assert.equal(report.artifacts.base.headroomMiB, 22);
  assert.equal(report.artifacts.baked.headroomMiB, 18);
  assert.match(formatVisualSizeQaReport(report), /Classic|classic-neon/i);
});

check('short smoke clips cannot masquerade as the 120-second gate', () => {
  const report = evaluateVisualSizeQa({
    ...passingInput,
    base: { ...passingInput.base, durationSeconds: 60 },
    baked: { ...passingInput.baked, durationSeconds: 60 },
  });
  assert.equal(report.passed, false);
  assert.equal(report.failures.filter((failure) => /long-capture gate/.test(failure)).length, 2);
});

check('base and baked ceilings fail independently', () => {
  const baseFailure = evaluateVisualSizeQa({
    ...passingInput,
    base: { ...passingInput.base, sizeBytes: VISUAL_SIZE_QA_BASE_MAX_BYTES + 1 },
  });
  assert.equal(baseFailure.passed, false);
  assert.match(baseFailure.failures.join(' '), /Base artifact/);

  const bakedFailure = evaluateVisualSizeQa({
    ...passingInput,
    baked: { ...passingInput.baked, sizeBytes: VISUAL_SIZE_QA_BAKED_MAX_BYTES + 1 },
  });
  assert.equal(bakedFailure.passed, false);
  assert.match(bakedFailure.failures.join(' '), /Baked artifact/);
});

check('duration drift and missing preset identity are explicit failures', () => {
  const report = evaluateVisualSizeQa({
    ...passingInput,
    preset: '',
    baked: { ...passingInput.baked, durationSeconds: 119.9 },
  });
  assert.equal(report.passed, false);
  assert.match(report.failures.join(' '), /duration drift/i);
  assert.match(report.failures.join(' '), /Preset label\/id/);
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-visual-size-qa: ${checks} checks passed`);
