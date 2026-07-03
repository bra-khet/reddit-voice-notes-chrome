// Canvas render perf guard budget checks (v5.3.4 Phase 5.3).
//
//   Run:  node scripts/test-canvas-render-perf-guard.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-perf-guard-'));
const outfile = join(outdir, 'bundle.mjs');

await build({
  entryPoints: [join(root, 'src/transcription/canvas-render-perf-guard.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { '@': root },
  logLevel: 'silent',
});

const {
  canvasRenderPerfBudgetMs,
  CANVAS_RENDER_PERF_MIN_MS,
  CANVAS_RENDER_PERF_MAX_MS,
  isCanvasRenderPerfExceeded,
  CanvasRenderPerfExceededError,
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

console.log('canvas render perf guard\n');

check('budget respects minimum floor', () => {
  assert.equal(canvasRenderPerfBudgetMs(0.5), CANVAS_RENDER_PERF_MIN_MS);
});

check('budget scales with clip duration (floored to minimum)', () => {
  assert.equal(canvasRenderPerfBudgetMs(8), CANVAS_RENDER_PERF_MIN_MS);
});

check('budget respects maximum cap', () => {
  assert.equal(canvasRenderPerfBudgetMs(60), CANVAS_RENDER_PERF_MAX_MS);
});

check('isCanvasRenderPerfExceeded type guard', () => {
  const err = new CanvasRenderPerfExceededError(30_000, 31_000);
  assert.equal(isCanvasRenderPerfExceeded(err), true);
  assert.equal(isCanvasRenderPerfExceeded(new Error('nope')), false);
});

rmSync(outdir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);