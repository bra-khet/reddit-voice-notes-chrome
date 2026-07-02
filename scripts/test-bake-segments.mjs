// Segment prep parity for drawtext + canvas overlay (v5.3.4 Phase 5.2).
//
//   Run:  node scripts/test-bake-segments.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-segments-'));
const outfile = join(outdir, 'bundle.mjs');

await build({
  entryPoints: [join(root, 'src/transcription/transcript-editing.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { '@': root },
  logLevel: 'silent',
});

const { prepareSegmentsForSubtitleBake, SCAFFOLD_SOFT_HYPHEN } = await import(
  pathToFileURL(outfile).href
);

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

console.log('subtitle bake segment prep\n');

check('drops soft-hyphen scaffold slots', () => {
  const out = prepareSegmentsForSubtitleBake(
    [
      { start: 0, end: 3, text: SCAFFOLD_SOFT_HYPHEN },
      { start: 3, end: 6, text: 'hello' },
    ],
    9,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].text, 'hello');
});

check('strips scaffold prefix from partial cue text', () => {
  const out = prepareSegmentsForSubtitleBake(
    [{ start: 0, end: 2, text: `${SCAFFOLD_SOFT_HYPHEN}world` }],
    5,
  );
  assert.equal(out[0].text, 'world');
});

check('spreads missing Vosk timings across clip', () => {
  const out = prepareSegmentsForSubtitleBake(
    [
      { start: 0, end: 0, text: 'one' },
      { start: 0, end: 0, text: 'two' },
    ],
    10,
  );
  assert.equal(out.length, 2);
  assert.equal(out[0].start, 0);
  assert.ok(out[0].end > out[0].start);
  assert.ok(out[1].start >= out[0].end - 0.1);
});

check('bumps very short cues to min bake duration', () => {
  const out = prepareSegmentsForSubtitleBake([{ start: 1, end: 1.05, text: 'hi' }], 10);
  assert.ok(out[0].end - out[0].start >= 0.35);
});

check('clamps cue end to clip duration', () => {
  const out = prepareSegmentsForSubtitleBake([{ start: 8, end: 20, text: 'tail' }], 10);
  assert.equal(out[0].end, 10);
});

check('drops cues entirely past clip end', () => {
  const out = prepareSegmentsForSubtitleBake([{ start: 12, end: 15, text: 'late' }], 10);
  assert.equal(out.length, 0);
});

rmSync(outdir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);