// v5.6.0 — Timeline primitive tests: exact frame math (the painter's global-PTS
// expression), uniform segmentation, trim clamping, and the planTrim gate.
//
//   Run:  node scripts/test-timeline.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-timeline-'));

async function bundle(entry, name) {
  const outfile = join(outdir, name);
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
  TRIM_MIN_DURATION_SECONDS,
  clampTrimRange,
  createTimeline,
  frameToTime,
  segmentsFromEncodedMeta,
  snapTimeToFrame,
  timeToFrame,
  uniformSegments,
} = await bundle('src/timeline/timeline.ts', 'timeline.mjs');

const { planTrim, shiftCuesForTrim } = await bundle('src/editing/trim.ts', 'trim.mjs');

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

console.log('frame math (global-PTS expression)');

check('frameToTime is the exact serial expression frame/fps', () => {
  assert.equal(frameToTime(0, 24), 0);
  assert.equal(frameToTime(24, 24), 1);
  assert.equal(frameToTime(37, 24), 37 / 24);
});

check('timeToFrame floors to the displayed frame; round-trips frame PTS', () => {
  assert.equal(timeToFrame(0, 24), 0);
  assert.equal(timeToFrame(1 - 1e-9, 24), 23);
  // Every frame's own PTS maps back to itself (epsilon guards float error).
  for (let frame = 0; frame < 240; frame += 7) {
    assert.equal(timeToFrame(frameToTime(frame, 24), 24), frame);
  }
});

check('snapTimeToFrame lands exactly on a frame PTS and clamps at 0', () => {
  assert.equal(snapTimeToFrame(1.02, 24), frameToTime(24, 24));
  assert.equal(snapTimeToFrame(-5, 24), 0);
});

console.log('createTimeline');

check('validates inputs and counts whole frames', () => {
  const timeline = createTimeline(60, 24);
  assert.equal(timeline.frameCount, 1440);
  // Exactly-representable partial tail still counts a frame.
  assert.equal(createTimeline(60.5, 24).frameCount, 1452);
  assert.throws(() => createTimeline(0, 24));
  assert.throws(() => createTimeline(60, 0));
  assert.throws(() => createTimeline(Number.NaN, 24));
});

console.log('segments');

check('uniformSegments tile exactly; tail absorbed, no slivers', () => {
  const timeline = createTimeline(61, 24); // 1464 frames; 2s segments = 48 frames
  const segments = uniformSegments(timeline, 2);
  assert.equal(segments[0].startFrame, 0);
  const total = segments.reduce((sum, s) => sum + s.frameCount, 0);
  assert.equal(total, timeline.frameCount);
  for (let i = 1; i < segments.length; i += 1) {
    assert.equal(segments[i].startFrame, segments[i - 1].startFrame + segments[i - 1].frameCount);
  }
  const last = segments[segments.length - 1];
  // The 1-second tail merged into the final segment instead of a 24-frame sliver.
  assert.ok(last.frameCount >= 48);
  assert.ok(segments.every((s) => s.startSeconds === frameToTime(s.startFrame, 24)));
});

check('segmentsFromEncodedMeta is a pure re-projection', () => {
  const segments = segmentsFromEncodedMeta([
    {
      index: 3,
      startFrame: 96,
      frameCount: 48,
      fps: 24,
      startSeconds: 4,
      durationSeconds: 2,
      cutQuality: 'gap',
      encoderType: 'webcodecs',
      codec: 'vp8',
      cueSpan: { cueCount: 0, firstCueStartSeconds: null, lastCueEndSeconds: null },
      paintMs: 0,
      encodeMs: 0,
      colorBytes: 0,
      alphaBytes: 0,
    },
  ]);
  assert.deepEqual(segments, [
    { index: 3, startFrame: 96, frameCount: 48, startSeconds: 4, durationSeconds: 2 },
  ]);
});

console.log('trim clamping');

const TIMELINE = createTimeline(60, 24);

check('valid trim frame-snaps both ends', () => {
  const range = clampTrimRange({ inSeconds: 2.03, outSeconds: 30.99 }, TIMELINE);
  assert.notEqual(range, null);
  assert.equal(range.inSeconds, snapTimeToFrame(2.03, 24));
  assert.equal(range.outSeconds, snapTimeToFrame(30.99, 24));
});

check('rejects inverted / too-short / out-of-bounds / full-span trims', () => {
  assert.equal(clampTrimRange({ inSeconds: 30, outSeconds: 2 }, TIMELINE), null);
  assert.equal(
    clampTrimRange(
      { inSeconds: 10, outSeconds: 10 + TRIM_MIN_DURATION_SECONDS / 2 },
      TIMELINE,
    ),
    null,
  );
  assert.equal(clampTrimRange({ inSeconds: 70, outSeconds: 80 }, TIMELINE), null);
  // Trimming nothing is not an edit.
  assert.equal(clampTrimRange({ inSeconds: 0, outSeconds: 60 }, TIMELINE), null);
  assert.equal(clampTrimRange({ inSeconds: Number.NaN, outSeconds: 10 }, TIMELINE), null);
});

check('out point clamps to clip end', () => {
  const range = clampTrimRange({ inSeconds: 5, outSeconds: 500 }, TIMELINE);
  assert.equal(range.outSeconds, 60);
});

check('full-span on non-frame-aligned duration is still rejected (no micro-trim)', () => {
  // 13.529s @ 24fps is not on a frame boundary; floor-snapping OUT would yield
  // 13.5s and falsely look like a real trim of ~29ms.
  const fractional = createTimeline(13.529, 24);
  assert.equal(
    clampTrimRange({ inSeconds: 0, outSeconds: 13.529 }, fractional),
    null,
  );
  assert.equal(
    clampTrimRange({ inSeconds: 0, outSeconds: 500 }, fractional),
    null,
  );
});

check('out past clip end keeps true duration when head is trimmed', () => {
  const fractional = createTimeline(13.529, 24);
  const range = clampTrimRange({ inSeconds: 1, outSeconds: 13.529 }, fractional);
  assert.notEqual(range, null);
  assert.equal(range.outSeconds, 13.529);
  assert.equal(range.inSeconds, snapTimeToFrame(1, 24));
});

console.log('planTrim gate');

check('planTrim accepts, snaps, and reports honest errors', () => {
  const ok = planTrim({ inSeconds: 1.01, outSeconds: 12 }, 60, 24);
  assert.equal(ok.ok, true);
  assert.equal(ok.range.inSeconds, snapTimeToFrame(1.01, 24));

  const short = planTrim({ inSeconds: 1, outSeconds: 1.2 }, 60, 24);
  assert.equal(short.ok, false);
  assert.match(short.error, /at least/);

  const badClip = planTrim({ inSeconds: 1, outSeconds: 12 }, 0, 24);
  assert.equal(badClip.ok, false);
});

console.log('shiftCuesForTrim (v5.9.0 — mirrors the ghost-bar preview)');

check('shifts overlapping cues by exactly -inSeconds; preserves extra fields', () => {
  const cues = [
    { start: 12, end: 14, text: 'kept whole' },
    { start: 20, end: 21.5, text: 'also kept' },
  ];
  const shifted = shiftCuesForTrim(cues, { inSeconds: 10, outSeconds: 30 });
  assert.deepEqual(shifted, [
    { start: 2, end: 4, text: 'kept whole' },
    { start: 10, end: 11.5, text: 'also kept' },
  ]);
});

check('drops fully-outside cues, including exact-boundary touches (half-open)', () => {
  const cues = [
    { start: 0, end: 5, text: 'before' },
    { start: 8, end: 10, text: 'ends exactly at in' },
    { start: 30, end: 32, text: 'starts exactly at out' },
    { start: 40, end: 45, text: 'after' },
  ];
  assert.deepEqual(shiftCuesForTrim(cues, { inSeconds: 10, outSeconds: 30 }), []);
});

check('clamps partial overlaps to the kept window', () => {
  const cues = [
    { start: 8, end: 12, text: 'straddles in' },
    { start: 28, end: 35, text: 'straddles out' },
    { start: 5, end: 40, text: 'straddles both' },
  ];
  const shifted = shiftCuesForTrim(cues, { inSeconds: 10, outSeconds: 30 });
  assert.deepEqual(shifted, [
    { start: 0, end: 2, text: 'straddles in' },
    { start: 18, end: 20, text: 'straddles out' },
    { start: 0, end: 20, text: 'straddles both' },
  ]);
  // Every survivor fits the new duration.
  const newDuration = 20;
  for (const cue of shifted) {
    assert.ok(cue.start >= 0 && cue.end <= newDuration + 1e-9);
  }
});

check('normalizes inverted spans (same as projectCueThroughTrim)', () => {
  const shifted = shiftCuesForTrim(
    [{ start: 14, end: 12, text: 'inverted' }],
    { inSeconds: 10, outSeconds: 30 },
  );
  assert.deepEqual(shifted, [{ start: 2, end: 4, text: 'inverted' }]);
});

check('trim removing every cue returns empty; input order preserved otherwise', () => {
  assert.deepEqual(
    shiftCuesForTrim([{ start: 0, end: 9, text: 'x' }], { inSeconds: 10, outSeconds: 30 }),
    [],
  );
  const order = shiftCuesForTrim(
    [
      { start: 25, end: 26, text: 'b' },
      { start: 11, end: 12, text: 'a' },
    ],
    { inSeconds: 10, outSeconds: 30 },
  );
  assert.deepEqual(order.map((cue) => cue.text), ['b', 'a']);
});

check('frame-snapped planTrim range composes: shift lands inside frame math', () => {
  // The realistic pipeline: planTrim snaps the range, then cues shift by the
  // SNAPPED in point — never the raw request.
  const plan = planTrim({ inSeconds: 2.03, outSeconds: 30.99 }, 60, 24);
  assert.equal(plan.ok, true);
  const [cue] = shiftCuesForTrim([{ start: 5, end: 6, text: 'c' }], plan.range);
  assert.equal(cue.start, 5 - plan.range.inSeconds);
  assert.equal(cue.end, 6 - plan.range.inSeconds);
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-timeline: ${checks} checks passed`);
