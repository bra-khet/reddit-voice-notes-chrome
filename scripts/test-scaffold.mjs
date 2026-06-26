// Standalone unit check for generateTranscriptScaffold (v5.3 subtitle QoL).
// This repo has no test framework; following the project precedent
// (claude-progress.md: "bundle the pure module with esbuild, run under node"),
// we bundle the pure util — resolving the @/ alias — then assert invariants.
//
//   Run:  node scripts/test-scaffold.mjs
//
// The assertions encode the CONTRACT (invariants true for ANY spacing strategy),
// not one specific implementation, so they stay valid whichever strategy lands.

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-scaffold-'));
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

const {
  generateTranscriptScaffold,
  buildScaffoldTranscriptResult,
  normalizeEditedTranscriptResult,
  cueTextIsBlank,
  SCAFFOLD_SOFT_HYPHEN,
} = await import(pathToFileURL(outfile).href);

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓', name);
  } catch (err) {
    failed++;
    console.error('  ✗', name, '\n      ', err.message);
  }
}

const EPS = 1e-6;

/** Assert the universal scaffold contract for one (duration, min) pair. */
function assertContract(duration, min, placeholder = '') {
  const segs = generateTranscriptScaffold(duration, min, placeholder);
  assert.ok(Array.isArray(segs), 'returns an array');
  assert.ok(segs.length >= 1, `at least one slot (got ${segs.length})`);
  assert.equal(segs[0].start, 0, 'first slot starts at 0');
  for (let i = 0; i < segs.length; i++) {
    assert.ok(segs[i].end > segs[i].start, `slot ${i} has positive length`);
    assert.equal(segs[i].text, placeholder, `slot ${i} carries placeholder`);
    if (i > 0) {
      assert.ok(
        Math.abs(segs[i].start - segs[i - 1].end) < EPS,
        `slot ${i} is contiguous with ${i - 1} (no gap/overlap)`,
      );
    }
  }
  assert.ok(
    Math.abs(segs[segs.length - 1].end - duration) < EPS,
    `last slot ends exactly at clip end (${segs[segs.length - 1].end} vs ${duration})`,
  );
  return segs;
}

console.log('generateTranscriptScaffold — contract invariants\n');

check('30s / 5s — clean multiple covers full clip', () => {
  const segs = assertContract(30, 5);
  assert.ok(segs.length >= 1);
});

check('32s / 5s — non-multiple still covers exactly to clip end', () => {
  assertContract(32, 5);
});

check('12.5s / 5s — float duration covered with no drift', () => {
  assertContract(12.5, 5);
});

check('3s / 5s — clip shorter than min → single slot [0,3]', () => {
  const segs = generateTranscriptScaffold(3, 5);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].start, 0);
  assert.equal(segs[0].end, 3);
});

check('exact multiple 10s / 5s — boundaries land cleanly', () => {
  assertContract(10, 5);
});

check('soft-hyphen placeholder is carried verbatim', () => {
  const segs = generateTranscriptScaffold(10, 5, SCAFFOLD_SOFT_HYPHEN);
  assert.ok(segs.every((s) => s.text === SCAFFOLD_SOFT_HYPHEN));
});

check('default min (no arg) still satisfies contract', () => {
  assertContract(23, undefined);
});

check('default min is 3s — 9s clip → 3 slots of 3s', () => {
  const segs = generateTranscriptScaffold(9);
  assert.equal(segs.length, 3);
  assert.deepEqual([segs[0].end, segs[1].end, segs[2].end], [3, 6, 9]);
});

// ── Strategy C specifics: runt tail (< ½·min) merges into predecessor ───────
console.log('\nStrategy C — runt-tail merge\n');

check('32s / 5s — 2s runt merges → 6 slots, last is 25→32', () => {
  const segs = generateTranscriptScaffold(32, 5);
  assert.equal(segs.length, 6);
  assert.deepEqual([segs[5].start, segs[5].end], [25, 32]);
});

check('12s / 5s — 2s runt merges → 2 slots, last is 5→12', () => {
  const segs = generateTranscriptScaffold(12, 5);
  assert.equal(segs.length, 2);
  assert.deepEqual([segs[1].start, segs[1].end], [5, 12]);
});

check('13s / 5s — 3s tail (≥ ½·min) is kept → 3 slots', () => {
  const segs = generateTranscriptScaffold(13, 5);
  assert.equal(segs.length, 3);
  assert.deepEqual([segs[2].start, segs[2].end], [10, 13]);
});

// ── Edge cases: empty/invalid input → [] ────────────────────────────────────
check('duration 0 → []', () => assert.deepEqual(generateTranscriptScaffold(0, 5), []));
check('negative duration → []', () => assert.deepEqual(generateTranscriptScaffold(-4, 5), []));
check('NaN duration → []', () => assert.deepEqual(generateTranscriptScaffold(NaN, 5), []));
check('Infinity duration → []', () =>
  assert.deepEqual(generateTranscriptScaffold(Infinity, 5), []));

check('invalid min (0) collapses to a single full-clip slot', () => {
  const segs = generateTranscriptScaffold(8, 0);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].end, 8);
});

// ── Wrapper: buildScaffoldTranscriptResult ──────────────────────────────────
console.log('\nbuildScaffoldTranscriptResult — wrapper\n');

check('wraps scaffold as source:manual with duration + empty text', () => {
  const res = buildScaffoldTranscriptResult(30, { minSegmentSec: 5 });
  assert.equal(res.source, 'manual');
  assert.equal(res.text, '');
  assert.equal(res.duration, 30);
  assert.ok(res.segments.length >= 1);
});

check('invalid duration → empty segments, undefined duration', () => {
  const res = buildScaffoldTranscriptResult(0);
  assert.deepEqual(res.segments, []);
  assert.equal(res.duration, undefined);
});

// ── Phase 4: scaffold survives editing (keepEmptyTimedSegments) ──────────────
console.log('\nnormalizeEditedTranscriptResult — scaffold preservation\n');

check('scaffold uses soft-hyphen placeholder so slots are intrinsically non-empty', () => {
  const base = buildScaffoldTranscriptResult(9);
  assert.ok(base.segments.every((s) => s.text === SCAFFOLD_SOFT_HYPHEN));
});

check('cueTextIsBlank treats soft-hyphen/whitespace as blank, real text as not', () => {
  assert.equal(cueTextIsBlank(SCAFFOLD_SOFT_HYPHEN), true);
  assert.equal(cueTextIsBlank(`  ${SCAFFOLD_SOFT_HYPHEN} `), true);
  assert.equal(cueTextIsBlank(''), true);
  assert.equal(cueTextIsBlank('hi'), false);
  assert.equal(cueTextIsBlank(`${SCAFFOLD_SOFT_HYPHEN}hi`), false);
});

check('default normalize KEEPS soft-hyphen slots (persist) but aggregate text is empty', () => {
  const base = buildScaffoldTranscriptResult(9); // soft-hyphen slots
  const edited = normalizeEditedTranscriptResult(base, base.segments);
  assert.equal(edited.segments.length, 3); // non-empty (soft hyphen) → survive
  assert.equal(edited.text, ''); // but read as blank in the aggregate
  assert.equal(edited.source, 'manual');
});

check('truly-empty ("") slots are still stripped by default', () => {
  const base = buildScaffoldTranscriptResult(9, { placeholder: '' });
  const edited = normalizeEditedTranscriptResult(base, base.segments);
  assert.equal(edited.segments.length, 0);
});

check('keepEmptyTimedSegments still drops zero-duration cues', () => {
  const base = buildScaffoldTranscriptResult(9);
  const segs = [...base.segments, { start: 5, end: 5, text: SCAFFOLD_SOFT_HYPHEN }];
  const edited = normalizeEditedTranscriptResult(base, segs, { keepEmptyTimedSegments: true });
  assert.equal(edited.segments.length, 3);
});

check('mixed fill: blank slots kept, aggregate text holds only the real cue', () => {
  const base = buildScaffoldTranscriptResult(9);
  const segs = base.segments.map((s, i) => (i === 1 ? { ...s, text: 'hello' } : s));
  const edited = normalizeEditedTranscriptResult(base, segs);
  assert.equal(edited.segments.length, 3);
  assert.equal(edited.text, 'hello');
});

rmSync(outdir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
