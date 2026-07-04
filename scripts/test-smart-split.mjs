// Standalone unit check for Phase 6 Smart Split (v5.3 subtitle QoL).
// No test framework — bundle the pure modules with esbuild (resolving @/) and
// assert invariants under node, same precedent as test-scaffold.mjs.
//
//   Run:  node scripts/test-smart-split.mjs
//
// Two pure pieces are covered:
//   - text-metrics.groupWordsByWidth / textOverflowsWidth / estimateMaxWords
//     (measure fn injected, so no canvas needed)
//   - transcript-editing.splitSegmentIntoChunks (proportional char-length timing)

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-split-'));

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
  groupWordsByWidth,
  textOverflowsWidth,
  estimateMaxWords,
  previewCaptionMaxWidth,
  smartSplitCaptionMaxWidth,
  SMART_SPLIT_WIDTH_RELAXATION,
} = await bundle('src/utils/text-metrics.ts', 'metrics');
const { splitSegmentIntoChunks } = await bundle(
  'src/transcription/transcript-editing.ts',
  'editing',
);

// Fake measurer: width == character count (spaces included). maxWidth is in "chars".
const charMeasure = (text) => text.length;

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

// ── text-metrics: greedy width grouping ─────────────────────────────────────
console.log('groupWordsByWidth — greedy fit\n');

check('blank / whitespace → []', () => {
  assert.deepEqual(groupWordsByWidth('', 10, charMeasure), []);
  assert.deepEqual(groupWordsByWidth('   ', 10, charMeasure), []);
});

check('all fits on one line → single chunk', () => {
  assert.deepEqual(groupWordsByWidth('a b c', 10, charMeasure), ['a b c']);
});

check('greedy fill packs words up to the budget, then breaks', () => {
  // "a b" = 3 ok; "a b c" = 5 > 3 → break; "c d" = 3 ok.
  assert.deepEqual(groupWordsByWidth('a b c d', 3, charMeasure), ['a b', 'c d']);
});

check('a word wider than the budget becomes its own chunk', () => {
  assert.deepEqual(groupWordsByWidth('hi enormous yo', 3, charMeasure), ['hi', 'enormous', 'yo']);
});

check('collapses runs of whitespace between words', () => {
  assert.deepEqual(groupWordsByWidth('a   b', 10, charMeasure), ['a   b'.replace(/\s+/g, ' ')]);
});

console.log('\ntextOverflowsWidth + estimateMaxWords\n');

check('overflow true only when single-line width exceeds budget', () => {
  assert.equal(textOverflowsWidth('abcdef', 5, charMeasure), true);
  assert.equal(textOverflowsWidth('abc', 5, charMeasure), false);
  assert.equal(textOverflowsWidth('   ', 5, charMeasure), false);
});

check('estimateMaxWords returns largest leading word count that fits', () => {
  // "aa"=2, "aa bb"=5, "aa bb cc"=8; budget 5 → 2 words fit.
  assert.equal(estimateMaxWords('aa bb cc', 5, charMeasure), 2);
  assert.equal(estimateMaxWords('toolongword', 3, charMeasure), 0);
  assert.equal(estimateMaxWords('', 5, charMeasure), 0);
});

// ── v5.3.6 relaxed Smart Split width budget ───────────────────────────────────
console.log('\nv5.3.6 — relaxed caption max width\n');

check('smartSplitCaptionMaxWidth is ~1.5× previewCaptionMaxWidth', () => {
  assert.equal(SMART_SPLIT_WIDTH_RELAXATION, 1.5);
  const previewMax = previewCaptionMaxWidth();
  const relaxedMax = smartSplitCaptionMaxWidth();
  assert.equal(relaxedMax, Math.round(previewMax * SMART_SPLIT_WIDTH_RELAXATION));
});

check('borderline cue splits on old budget but stays single on relaxed budget', () => {
  const previewMax = previewCaptionMaxWidth();
  const relaxedMax = smartSplitCaptionMaxWidth();
  // ~1.3× preview width with spaced words (groupWordsByWidth is word-based).
  const unit = 'abcd ';
  const unitsNeeded = Math.ceil((previewMax * 1.3) / unit.length);
  const text = unit.repeat(unitsNeeded).trim();
  assert.ok(charMeasure(text) > previewMax && charMeasure(text) <= relaxedMax);
  assert.ok(groupWordsByWidth(text, previewMax, charMeasure).length > 1);
  assert.deepEqual(groupWordsByWidth(text, relaxedMax, charMeasure), [text]);
  assert.equal(textOverflowsWidth(text, previewMax, charMeasure), true);
  assert.equal(textOverflowsWidth(text, relaxedMax, charMeasure), false);
});

check('genuinely wide cue still overflows and splits under relaxed budget', () => {
  const relaxedMax = smartSplitCaptionMaxWidth();
  const text = 'word '.repeat(Math.ceil((relaxedMax * 1.4) / 5));
  assert.equal(textOverflowsWidth(text, relaxedMax, charMeasure), true);
  assert.ok(groupWordsByWidth(text, relaxedMax, charMeasure).length > 1);
});

// ── transcript-editing: proportional-timing split ───────────────────────────
console.log('\nsplitSegmentIntoChunks — proportional timing\n');

function assertContiguous(segs, seg) {
  assert.ok(segs.length >= 1, 'at least one cue');
  assert.equal(segs[0].start, seg.start, 'first cue starts at segment start');
  assert.ok(Math.abs(segs[segs.length - 1].end - seg.end) < EPS, 'last cue ends exactly at segment end');
  for (let i = 0; i < segs.length; i++) {
    assert.ok(segs[i].end >= segs[i].start, `cue ${i} non-negative length`);
    if (i > 0) {
      assert.ok(
        Math.abs(segs[i].start - segs[i - 1].end) < EPS,
        `cue ${i} contiguous with ${i - 1}`,
      );
    }
  }
}

check('chunks.length <= 1 → unchanged single cue', () => {
  const seg = { start: 0, end: 6, text: 'hello world' };
  assert.deepEqual(splitSegmentIntoChunks(seg, ['hello world']), [seg]);
  assert.deepEqual(splitSegmentIntoChunks(seg, []), [seg]);
});

check('equal-length chunks split the span 50/50', () => {
  const segs = splitSegmentIntoChunks({ start: 0, end: 6, text: 'ab cd' }, ['ab', 'cd']);
  assert.equal(segs.length, 2);
  assert.deepEqual([segs[0].start, segs[0].end], [0, 3]);
  assert.deepEqual([segs[1].start, segs[1].end], [3, 6]);
  assert.deepEqual([segs[0].text, segs[1].text], ['ab', 'cd']);
});

check('time is proportional to chunk char length (2:4 over 6s → 2s | 4s)', () => {
  const segs = splitSegmentIntoChunks({ start: 0, end: 6, text: 'ab cdef' }, ['ab', 'cdef']);
  assert.equal(segs.length, 2);
  assert.deepEqual([segs[0].start, segs[0].end], [0, 2]); // 6 * 2/6 = 2
  assert.deepEqual([segs[1].start, segs[1].end], [2, 6]);
});

check('3-way split is contiguous and ends exactly at clip end', () => {
  const seg = { start: 1, end: 10, text: 'aa bbbb cc' };
  const segs = splitSegmentIntoChunks(seg, ['aa', 'bbbb', 'cc']);
  assert.equal(segs.length, 3);
  assertContiguous(segs, seg);
});

check('non-integer span keeps last end exact (no float drift)', () => {
  const seg = { start: 0, end: 12.5, text: 'aaa bbb ccc' };
  const segs = splitSegmentIntoChunks(seg, ['aaa', 'bbb', 'ccc']);
  assertContiguous(segs, seg);
  assert.equal(segs[segs.length - 1].end, 12.5);
});

check('zero / negative span → single cue with text rejoined', () => {
  const segs = splitSegmentIntoChunks({ start: 4, end: 4, text: 'x y' }, ['x', 'y']);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].text, 'x y');
});

check('interior boundaries are rounded to 0.01s', () => {
  // span 10, weights 1:1:1 → boundaries 3.3333.., 6.6666.. → 3.33, 6.67
  const seg = { start: 0, end: 10, text: 'a b c' };
  const segs = splitSegmentIntoChunks(seg, ['a', 'b', 'c']);
  assert.deepEqual([segs[0].end, segs[1].end], [3.33, 6.67]);
  assert.equal(segs[2].end, 10);
});

check('end-to-end: group then split keeps each cue within budget', () => {
  const text = 'the quick brown fox jumps over the lazy dog again';
  const chunks = groupWordsByWidth(text, 12, charMeasure);
  assert.ok(chunks.length > 1, 'long text splits into multiple chunks');
  assert.ok(chunks.every((c) => charMeasure(c) <= 12), 'every chunk fits the budget');
  const seg = { start: 0, end: 9, text };
  const segs = splitSegmentIntoChunks(seg, chunks);
  assert.equal(segs.length, chunks.length);
  assertContiguous(segs, seg);
});

rmSync(outdir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
