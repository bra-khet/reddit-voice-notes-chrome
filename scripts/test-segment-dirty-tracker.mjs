// v5.6.0 — Segment dirty-tracker tests: cue-diff windows, padding + merge,
// segment mapping (half-open semantics), and the global style-dirty gate.
//
//   Run:  node scripts/test-segment-dirty-tracker.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-dirty-tracker-'));
const outfile = join(outdir, 'bundle.mjs');

await build({
  entryPoints: [join(root, 'src/editing/segment-dirty-tracker.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { '@': root },
  logLevel: 'silent',
});

const {
  DIRTY_WINDOW_MERGE_GAP_SECONDS,
  DIRTY_WINDOW_PADDING_SECONDS,
  computeDirtySegments,
  diffCueWindows,
  mapWindowsToSegments,
  mergeDirtyWindows,
} = await import(pathToFileURL(outfile).href);

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

const DURATION = 60;
const cue = (start, end, text) => ({ start, end, text });

/** Four 15 s segments over the minute. */
const SEGMENTS = [0, 1, 2, 3].map((i) => ({
  index: i,
  startSeconds: i * 15,
  durationSeconds: 15,
}));

console.log('diffCueWindows');

check('identical lists are clean', () => {
  const cues = [cue(1, 3, 'hello'), cue(5, 8, 'world')];
  assert.deepEqual(diffCueWindows(cues, [...cues], DURATION), []);
});

check('an edited cue dirties BOTH its old and new windows', () => {
  const before = [cue(1, 3, 'hello'), cue(40, 42, 'tail')];
  const after = [cue(1, 3, 'hello!'), cue(40, 42, 'tail')]; // text edit only
  const windows = diffCueWindows(before, after, DURATION);
  assert.equal(windows.length, 1); // old + new share the padded span → merged
  assert.ok(windows[0].startSeconds <= 1 - DIRTY_WINDOW_PADDING_SECONDS + 1e-9);
  assert.ok(windows[0].endSeconds >= 3 + DIRTY_WINDOW_PADDING_SECONDS - 1e-9);

  const moved = diffCueWindows(before, [cue(30, 32, 'hello'), cue(40, 42, 'tail')], DURATION);
  // Timing move: old window (1–3) and new window (30–32) both dirty.
  assert.equal(moved.length, 2);
});

check('added and removed cues dirty their spans; padding clamps to clip', () => {
  const added = diffCueWindows([], [cue(0.1, 2, 'new')], DURATION);
  assert.equal(added.length, 1);
  assert.equal(added[0].startSeconds, 0); // clamped, not negative
  const removed = diffCueWindows([cue(58.5, 59.9, 'bye')], [], DURATION);
  assert.equal(removed[0].endSeconds, DURATION); // clamped at clip end
});

check('duplicate cue content is multiset-counted, not set-collapsed', () => {
  const twice = [cue(1, 2, 'echo'), cue(1, 2, 'echo')];
  const once = [cue(1, 2, 'echo')];
  // Removing ONE of two identical cues is still an edit.
  assert.equal(diffCueWindows(twice, once, DURATION).length, 1);
  assert.deepEqual(diffCueWindows(twice, [...twice], DURATION), []);
});

console.log('mergeDirtyWindows');

check('near-adjacent windows merge; distant ones stay separate', () => {
  const merged = mergeDirtyWindows([
    { startSeconds: 10, endSeconds: 12 },
    { startSeconds: 12 + DIRTY_WINDOW_MERGE_GAP_SECONDS - 0.1, endSeconds: 15 },
    { startSeconds: 40, endSeconds: 41 },
  ]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0], { startSeconds: 10, endSeconds: 15 });
});

check('unsorted input is handled', () => {
  const merged = mergeDirtyWindows([
    { startSeconds: 30, endSeconds: 31 },
    { startSeconds: 1, endSeconds: 2 },
  ]);
  assert.equal(merged[0].startSeconds, 1);
});

console.log('mapWindowsToSegments (half-open)');

check('a window ending exactly at a segment start does not dirty it', () => {
  const windows = [{ startSeconds: 10, endSeconds: 15 }];
  assert.deepEqual(mapWindowsToSegments(windows, SEGMENTS), [0]);
});

check('a window spanning a boundary dirties both segments', () => {
  const windows = [{ startSeconds: 14, endSeconds: 16 }];
  assert.deepEqual(mapWindowsToSegments(windows, SEGMENTS), [0, 1]);
});

console.log('computeDirtySegments');

check('style change is an honest global invalidation', () => {
  const result = computeDirtySegments(
    { before: [cue(1, 2, 'x')], after: [cue(1, 2, 'x')], styleChanged: true },
    SEGMENTS,
    DURATION,
  );
  assert.equal(result.allDirty, true);
  assert.deepEqual(result.dirtySegmentIndices, [0, 1, 2, 3]);
  assert.deepEqual(result.windows, [{ startSeconds: 0, endSeconds: DURATION }]);
});

check('cue edit dirties only overlapped segments', () => {
  const before = [cue(1, 2, 'a'), cue(50, 52, 'b')];
  const after = [cue(1, 2, 'a'), cue(50, 52, 'b — edited')];
  const result = computeDirtySegments({ before, after }, SEGMENTS, DURATION);
  assert.equal(result.allDirty, false);
  assert.deepEqual(result.dirtySegmentIndices, [3]);
});

check('no edits → nothing dirty', () => {
  const cues = [cue(1, 2, 'a')];
  const result = computeDirtySegments({ before: cues, after: [...cues] }, SEGMENTS, DURATION);
  assert.equal(result.allDirty, false);
  assert.deepEqual(result.windows, []);
  assert.deepEqual(result.dirtySegmentIndices, []);
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-segment-dirty-tracker: ${checks} checks passed`);
