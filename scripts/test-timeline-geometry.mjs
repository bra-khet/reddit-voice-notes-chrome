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
  MIN_WINDOW_SECONDS,
  minWindowSeconds,
  fitWindow,
  windowDurationSeconds,
  windowZoomFactor,
  clampWindow,
  zoomWindowAt,
  panWindow,
  windowForSpan,
  windowFromZoomFactor,
  sliderToZoomFactor,
  zoomFactorToSlider,
  windowSecondsToPx,
  windowPxToSeconds,
  windowPxDeltaToSeconds,
  layoutBarInWindow,
  layoutBarsInWindow,
  generateRulerTicksInWindow,
  minimapLens,
  minimapPxToSeconds,
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

console.log('view window (zoom + pan, §16.2)');

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ''} (${a} ≈ ${b})`);

check('minWindowSeconds: max(0.5s, 4 frames)', () => {
  assert.equal(MIN_WINDOW_SECONDS, 0.5);
  assert.equal(minWindowSeconds(24), 0.5); // 4/24 ≈ 0.167 → 0.5 wins
  assert.equal(minWindowSeconds(2), 2); // 4/2 = 2 → frame floor wins
});

check('fitWindow spans the whole clip (z = 1)', () => {
  const w = fitWindow(48);
  assert.deepEqual(w, { viewStartSeconds: 0, viewEndSeconds: 48 });
  assert.equal(windowDurationSeconds(w), 48);
  assert.equal(windowZoomFactor(w, 48), 1);
});

check('clampWindow: duration into [min, clip], position into [0, clip]', () => {
  // too narrow → widened to the min window
  const narrow = clampWindow({ viewStartSeconds: 2, viewEndSeconds: 2.1 }, 10, 0.5);
  near(windowDurationSeconds(narrow), 0.5, 'min duration');
  // hanging past the clip end → shifted back inside
  const shifted = clampWindow({ viewStartSeconds: 8, viewEndSeconds: 12 }, 10, 0.5);
  assert.deepEqual(shifted, { viewStartSeconds: 6, viewEndSeconds: 10 });
  // wider than the clip → fit
  const wide = clampWindow({ viewStartSeconds: -5, viewEndSeconds: 40 }, 10, 0.5);
  assert.deepEqual(wide, { viewStartSeconds: 0, viewEndSeconds: 10 });
});

check('zoomWindowAt keeps the anchor at the same relative x (anchored zoom)', () => {
  const w = { viewStartSeconds: 0, viewEndSeconds: 10 };
  const zoomed = zoomWindowAt(w, 2, 4, 10, 0.5); // anchor 4s at rel 0.4
  near(zoomed.viewStartSeconds, 2, 'start');
  near(zoomed.viewEndSeconds, 7, 'end');
  near((4 - zoomed.viewStartSeconds) / windowDurationSeconds(zoomed), 0.4, 'anchor rel preserved');
});

check('zoomWindowAt clamps at the min window and back out to fit', () => {
  const w = { viewStartSeconds: 4, viewEndSeconds: 5 };
  const inMax = zoomWindowAt(w, 1000, 4.5, 10, 0.5);
  near(windowDurationSeconds(inMax), 0.5, 'zoom-in capped at min window');
  const out = zoomWindowAt(w, 1 / 1000, 4.5, 10, 0.5);
  assert.deepEqual(out, { viewStartSeconds: 0, viewEndSeconds: 10 });
});

check('panWindow preserves duration and clamps at both clip edges', () => {
  const w = { viewStartSeconds: 2, viewEndSeconds: 6 };
  assert.deepEqual(panWindow(w, 3, 10, 0.5), { viewStartSeconds: 5, viewEndSeconds: 9 });
  assert.deepEqual(panWindow(w, -99, 10, 0.5), { viewStartSeconds: 0, viewEndSeconds: 4 });
  assert.deepEqual(panWindow(w, 99, 10, 0.5), { viewStartSeconds: 6, viewEndSeconds: 10 });
});

check('windowForSpan pads the span and guards tiny spans with the min window', () => {
  const w = windowForSpan(2, 4, 10, 0.5, 0.15);
  near(w.viewStartSeconds, 1.7, 'padded start');
  near(w.viewEndSeconds, 4.3, 'padded end');
  const tiny = windowForSpan(2, 2.05, 10, 0.5, 0.15);
  near(windowDurationSeconds(tiny), 0.5, 'tiny span widened to min');
  assert.ok(tiny.viewStartSeconds <= 2 && tiny.viewEndSeconds >= 2.05, 'span still contained');
});

check('windowFromZoomFactor centers the window (slider input)', () => {
  const w = windowFromZoomFactor(2, 5, 10, 0.5);
  assert.deepEqual(w, { viewStartSeconds: 2.5, viewEndSeconds: 7.5 });
});

check('log slider mapping round-trips (t=0.5 on maxZoom 16 → 4×)', () => {
  near(sliderToZoomFactor(0.5, 16), 4, 'midpoint is sqrt of max');
  near(zoomFactorToSlider(4, 16), 0.5, 'inverse');
  assert.equal(sliderToZoomFactor(0.3, 1), 1); // no zoom range → always fit
  near(sliderToZoomFactor(zoomFactorToSlider(7.3, 16), 16), 7.3, 'round trip');
});

console.log('window-relative px mapping + culling');

const WV = { window: { viewStartSeconds: 5, viewEndSeconds: 15 }, trackWidthPx: 100 };

check('windowSecondsToPx is window-relative and unclamped (off-window is negative/past)', () => {
  near(windowSecondsToPx(10, WV), 50, 'mid');
  near(windowSecondsToPx(5, WV), 0, 'window start');
  near(windowSecondsToPx(0, WV), -50, 'before window is negative');
  near(windowSecondsToPx(20, WV), 150, 'after window is past the track');
});

check('windowPxToSeconds clamps to the window (pointer input) and round-trips', () => {
  near(windowPxToSeconds(50, WV), 10, 'mid');
  near(windowPxToSeconds(-30, WV), 5, 'clamped to view start');
  near(windowPxToSeconds(999, WV), 15, 'clamped to view end');
  near(windowPxDeltaToSeconds(10, WV), 1, '10px = 1s at this zoom');
});

check('layoutBarsInWindow culls off-window bars but preserves original indices', () => {
  const cues = [
    { start: 0, end: 1 }, // far left of window {4.5,7} → culled
    { start: 5, end: 6 }, // inside → kept
    { start: 20, end: 21 }, // far right → culled
  ];
  const wv = { window: { viewStartSeconds: 4.5, viewEndSeconds: 7 }, trackWidthPx: 250 };
  const bars = layoutBarsInWindow(cues, wv, 200);
  assert.equal(bars.length, 1);
  assert.equal(bars[0].index, 1, 'original index survives culling');
  near(bars[0].leftPx, 50, 'window-relative position');
  const single = layoutBarInWindow(cues[1], 1, wv);
  assert.deepEqual(single, bars[0]);
});

check('generateRulerTicksInWindow: ticks inside the window, labels absolute', () => {
  const wv = { window: { viewStartSeconds: 5, viewEndSeconds: 15 }, trackWidthPx: 500 };
  const ticks = generateRulerTicksInWindow(wv);
  assert.ok(ticks.length > 0);
  for (const t of ticks) {
    assert.ok(t.seconds >= 5 - 1e-9 && t.seconds <= 15 + 1e-9, `tick ${t.seconds} in window`);
    assert.ok(t.px >= -1e-6 && t.px <= 500 + 1e-6, `tick px ${t.px} on track`);
  }
  assert.ok(
    ticks.some((t) => t.label === '0:06'),
    'labels are absolute clip time, not window-relative',
  );
});

check('minimapLens maps the window onto the strip; px→seconds inverts', () => {
  const lens = minimapLens({ viewStartSeconds: 2, viewEndSeconds: 7 }, 10, 200);
  near(lens.leftPx, 40, 'lens left');
  near(lens.widthPx, 100, 'lens width');
  near(minimapPxToSeconds(40, 10, 200), 2, 'strip px → seconds');
  near(minimapPxToSeconds(9999, 10, 200), 10, 'clamped');
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-timeline-geometry: ${checks} checks passed`);
