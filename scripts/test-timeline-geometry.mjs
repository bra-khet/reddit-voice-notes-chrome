// v5.8.0 — Timeline editor view-geometry tests: seconds↔px mapping, bar layout,
// ruler tick generation, pointer hit-testing (16px handles + fight-priority), and
// snap resolution (authoritative magnetism priority; frame quantization always).
//
//   Run:  node scripts/test-timeline-geometry.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-timeline-geom-'));

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

const geom = await bundle('src/ui/design-studio/timeline-geometry.ts', 'timeline-geometry.mjs');
const { snapTimeToFrame } = await bundle('src/timeline/timeline.ts', 'timeline.mjs');

const {
  MIN_BAR_WIDTH_PX,
  EDGE_HANDLE_PX,
  secondsToPx,
  pxToSeconds,
  pxDeltaToSeconds,
  clampSeconds,
  layoutBar,
  layoutBars,
  chooseTickInterval,
  generateRulerTicks,
  handleWidthForBar,
  hitTestTrack,
  resolveSnap,
  MIN_CUE_DURATION_SECONDS,
  constrainResizeStart,
  constrainResizeEnd,
  constrainMove,
} = geom;

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

const VP = { durationSeconds: 60, trackWidthPx: 600 }; // 10 px per second

console.log('seconds ↔ px');

check('secondsToPx / pxToSeconds round-trip and clamp', () => {
  assert.equal(secondsToPx(0, VP), 0);
  assert.equal(secondsToPx(60, VP), 600);
  assert.equal(secondsToPx(30, VP), 300);
  // clamps out-of-range
  assert.equal(secondsToPx(-5, VP), 0);
  assert.equal(secondsToPx(120, VP), 600);
  assert.equal(pxToSeconds(300, VP), 30);
  assert.equal(pxToSeconds(-10, VP), 0);
  assert.equal(pxToSeconds(9999, VP), 60);
  // round trip
  for (const s of [0, 3.5, 12.1, 44.9, 60]) {
    assert.ok(Math.abs(pxToSeconds(secondsToPx(s, VP), VP) - s) < 1e-9);
  }
});

check('degenerate viewport is safe (no NaN/Infinity)', () => {
  const bad = { durationSeconds: 0, trackWidthPx: 0 };
  assert.equal(secondsToPx(10, bad), 0);
  assert.equal(pxToSeconds(10, bad), 0);
  assert.equal(pxDeltaToSeconds(10, bad), 0);
  assert.equal(clampSeconds(10, bad), 0);
});

check('pxDeltaToSeconds is an unclamped ratio', () => {
  assert.equal(pxDeltaToSeconds(10, VP), 1); // 10px = 1s at 10px/s
  assert.equal(pxDeltaToSeconds(-10, VP), -1);
});

console.log('bar layout');

check('layoutBar positions by start, widths by duration, floors min width', () => {
  const bar = layoutBar({ start: 10, end: 20 }, 0, VP);
  assert.equal(bar.leftPx, 100);
  assert.equal(bar.widthPx, 100);
  assert.equal(bar.rawWidthPx, 100);
});

check('tiny cue keeps a grabbable minimum width but honest rawWidth', () => {
  const bar = layoutBar({ start: 10, end: 10.2 }, 0, VP); // 0.2s → ~2px raw
  assert.ok(Math.abs(bar.rawWidthPx - 2) < 1e-6, `rawWidthPx ≈ 2 (got ${bar.rawWidthPx})`);
  assert.equal(bar.widthPx, MIN_BAR_WIDTH_PX);
});

check('inverted span (start > end) is normalized', () => {
  const bar = layoutBar({ start: 20, end: 10 }, 3, VP);
  assert.equal(bar.startSeconds, 10);
  assert.equal(bar.endSeconds, 20);
  assert.equal(bar.leftPx, 100);
  assert.equal(bar.index, 3);
});

check('layoutBars preserves order + indices', () => {
  const bars = layoutBars([{ start: 0, end: 5 }, { start: 5, end: 12 }], VP);
  assert.equal(bars.length, 2);
  assert.equal(bars[0].index, 0);
  assert.equal(bars[1].index, 1);
  assert.equal(bars[1].leftPx, 50);
});

console.log('ruler ticks');

check('chooseTickInterval picks a nice interval keeping majors ~spaced', () => {
  // 60s over 600px, target 90px/major → ~6 majors → raw 10s → nice 10s
  assert.equal(chooseTickInterval(60, 600, 90), 10);
  // very wide track wants finer majors
  assert.ok(chooseTickInterval(30, 1200, 90) <= 5);
  // tiny track falls back to coarse
  assert.ok(chooseTickInterval(600, 120, 90) >= 60);
});

check('generateRulerTicks: first tick at 0, majors labeled, all within bounds', () => {
  const ticks = generateRulerTicks(VP);
  assert.ok(ticks.length > 0);
  assert.equal(ticks[0].seconds, 0);
  assert.equal(ticks[0].major, true);
  assert.equal(ticks[0].label, '0:00');
  for (const t of ticks) {
    assert.ok(t.px >= 0 && t.px <= VP.trackWidthPx + 1e-6, `tick px ${t.px} in bounds`);
    assert.ok(t.seconds >= 0 && t.seconds <= VP.durationSeconds + 1e-6);
    if (t.major) assert.equal(typeof t.label, 'string');
    else assert.equal(t.label, null);
  }
  // a labeled major exists at a mid position with m:ss formatting
  assert.ok(ticks.some((t) => t.label === '0:30'));
});

check('degenerate viewport → no ticks', () => {
  assert.deepEqual(generateRulerTicks({ durationSeconds: 0, trackWidthPx: 600 }), []);
});

console.log('hit testing (16px edge handles + fight-priority)');

check('EDGE_HANDLE_PX is 16 and handle clamps on narrow bars', () => {
  assert.equal(EDGE_HANDLE_PX, 16);
  const wide = layoutBar({ start: 0, end: 10 }, 0, VP); // 100px wide
  assert.equal(handleWidthForBar(wide), 16);
  const narrow = layoutBar({ start: 0, end: 1 }, 0, VP); // 10px raw → 12px min
  assert.equal(handleWidthForBar(narrow), 6); // floor(12/2)
});

check('start-handle, body, end-handle zones resolve on a single bar', () => {
  const bars = [layoutBar({ start: 10, end: 20 }, 0, VP)]; // left 100, right 200
  assert.deepEqual(hitTestTrack(103, bars), { index: 0, zone: 'start-handle' });
  assert.deepEqual(hitTestTrack(150, bars), { index: 0, zone: 'body' });
  assert.deepEqual(hitTestTrack(197, bars), { index: 0, zone: 'end-handle' });
  assert.equal(hitTestTrack(400, bars), null);
});

check('fighting handles: nearest boundary wins, tie → start-handle', () => {
  // Two touching bars share boundary at x=200. Prev end-handle [184,200],
  // next start-handle [200,216]. Pointer at 198 is nearer prev's right edge (dist 2)
  // than next's left edge (dist 2)… exactly tie at 200 only; at 198 prev wins.
  const bars = [
    layoutBar({ start: 0, end: 20 }, 0, VP), // right = 200
    layoutBar({ start: 20, end: 40 }, 1, VP), // left = 200
  ];
  assert.deepEqual(hitTestTrack(198, bars), { index: 0, zone: 'end-handle' });
  assert.deepEqual(hitTestTrack(202, bars), { index: 1, zone: 'start-handle' });
  // exactly on the shared boundary → tie in distance → start-handle wins (index 1)
  assert.deepEqual(hitTestTrack(200, bars), { index: 1, zone: 'start-handle' });
});

console.log('snap resolution (magnetism priority; frame always applied)');

const FPS = 24;
const baseCtx = { fps: FPS, toleranceSeconds: 0.2 };

check('neighbor edge beats playhead beats tick', () => {
  const ctx = {
    ...baseCtx,
    neighborSeconds: [10.05],
    playheadSeconds: 10.02,
    tickSeconds: [10.0],
  };
  const r = resolveSnap(10.06, ctx);
  assert.equal(r.snappedTo, 'neighbor');
  assert.equal(r.seconds, snapTimeToFrame(10.05, FPS));
});

check('playhead used when no neighbor in range', () => {
  const r = resolveSnap(10.06, { ...baseCtx, playheadSeconds: 10.02, tickSeconds: [10.0] });
  assert.equal(r.snappedTo, 'playhead');
  assert.equal(r.seconds, snapTimeToFrame(10.02, FPS));
});

check('tick used when neither neighbor nor playhead in range', () => {
  const r = resolveSnap(10.06, { ...baseCtx, tickSeconds: [10.0, 15.0] });
  assert.equal(r.snappedTo, 'tick');
  assert.equal(r.seconds, snapTimeToFrame(10.0, FPS));
});

check('falls through to frame quantization when nothing is in tolerance', () => {
  const r = resolveSnap(10.5, { ...baseCtx, neighborSeconds: [3], playheadSeconds: 40, tickSeconds: [0, 60] });
  assert.equal(r.snappedTo, 'frame');
  assert.equal(r.seconds, snapTimeToFrame(10.5, FPS));
});

check('Shift (disableMagnetism) skips magnets but STILL frame-snaps', () => {
  const ctx = {
    ...baseCtx,
    neighborSeconds: [10.05],
    playheadSeconds: 10.02,
    tickSeconds: [10.0],
    disableMagnetism: true,
  };
  const r = resolveSnap(10.06, ctx);
  assert.equal(r.snappedTo, 'frame');
  assert.equal(r.seconds, snapTimeToFrame(10.06, FPS));
  // and the result is a valid frame PTS
  assert.equal(r.seconds, snapTimeToFrame(r.seconds, FPS));
});

console.log('edit constraints (clamp-to-neighbor policy)');

const CTX = { prevEndSeconds: 5, nextStartSeconds: 20, minDurationSeconds: 0.5 };

check('MIN_CUE_DURATION_SECONDS is 0.5', () => {
  assert.equal(MIN_CUE_DURATION_SECONDS, 0.5);
});

check('resize-start clamps to left neighbor end and keeps min duration', () => {
  // free move within range
  assert.equal(constrainResizeStart(8, 15, CTX), 8);
  // cannot cross into the left neighbor (end 5)
  assert.equal(constrainResizeStart(2, 15, CTX), 5);
  // cannot come within 0.5s of the end
  assert.equal(constrainResizeStart(14.9, 15, CTX), 14.5);
});

check('resize-end clamps to right neighbor start and keeps min duration', () => {
  assert.equal(constrainResizeEnd(10, 15, CTX), 15);
  // cannot cross into the right neighbor (start 20)
  assert.equal(constrainResizeEnd(10, 25, CTX), 20);
  // cannot come within 0.5s of the start
  assert.equal(constrainResizeEnd(10, 10.1, CTX), 10.5);
});

check('move preserves duration and clamps both edges to neighbors', () => {
  // duration 4, free move
  assert.deepEqual(constrainMove(8, 4, CTX), { start: 8, end: 12 });
  // pushed left into neighbor end (5) — start pins to 5
  assert.deepEqual(constrainMove(2, 4, CTX), { start: 5, end: 9 });
  // pushed right so end would pass 20 — start pins to 16 (20 - 4)
  assert.deepEqual(constrainMove(18, 4, CTX), { start: 16, end: 20 });
});

check('degenerate bar (bigger than the gap) pins to the floor without crashing', () => {
  const tight = { prevEndSeconds: 5, nextStartSeconds: 6, minDurationSeconds: 0.5 };
  // gap is 1s but duration 4 — start pins to prevEnd
  assert.deepEqual(constrainMove(10, 4, tight), { start: 5, end: 9 });
  // resize-start where hi < lo pins to lo
  assert.equal(constrainResizeStart(10, 5.2, tight), 5);
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-timeline-geometry: ${checks} checks passed`);
