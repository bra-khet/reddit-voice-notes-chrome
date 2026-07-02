// Pure-function checks for subtitle bake chronos helpers (v5.3.4 Phase 5.1).
//
//   Run:  node scripts/test-bake-chronos.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-chronos-'));
const outfile = join(outdir, 'bundle.mjs');

await build({
  entryPoints: [join(root, 'src/ui/design-studio/bake-chronos.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { '@': root },
  logLevel: 'silent',
});

const {
  formatChronosSeconds,
  estimateRemainingMs,
  formatBakeChronosLine,
} = await import(pathToFileURL(outfile).href);

let passed = 0;
let failed = 0;

function test(name, fn) {
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

console.log('bake chronos helpers\n');

test('formatChronosSeconds — zero-pads seconds', () => {
  assert.equal(formatChronosSeconds(0), '0:00');
  assert.equal(formatChronosSeconds(12), '0:12');
  assert.equal(formatChronosSeconds(72), '1:12');
});

test('estimateRemainingMs — null when ratio too small', () => {
  assert.equal(estimateRemainingMs(10_000, 0.01), null);
});

test('estimateRemainingMs — linear ETA at 50%', () => {
  assert.equal(estimateRemainingMs(10_000, 0.5), 10_000);
});

test('formatBakeChronosLine — elapsed only when ETA unknown', () => {
  assert.equal(
    formatBakeChronosLine({ elapsedMs: 12_000, estimatedRemainingMs: null }),
    '0:12 elapsed',
  );
});

test('formatBakeChronosLine — elapsed + remaining', () => {
  assert.equal(
    formatBakeChronosLine({ elapsedMs: 12_000, estimatedRemainingMs: 18_000 }),
    '0:12 elapsed · ~0:18 remaining',
  );
});

rmSync(outdir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);