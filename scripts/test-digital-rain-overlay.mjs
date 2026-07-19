// v6.0 Phase 3 — consumed bounded activation grid + registry-native Digital Rain.
//
//   Run: node scripts/test-digital-rain-overlay.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-digital-rain-'));
const outfile = join(outdir, 'digital-rain.mjs');

await build({
  absWorkingDir: root,
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'silent',
  stdin: {
    contents: [
      "export * from './src/theme/audio-reactive/index.ts';",
      "export * from './src/theme/audio-reactive/overlays/index.ts';",
    ].join('\n'),
    loader: 'ts',
    resolveDir: root,
    sourcefile: 'digital-rain-test-entry.ts',
  },
});

const {
  BOUNDED_ACTIVATION_GRID_MAX_CELLS,
  BOUNDED_ACTIVATION_GRID_MAX_DIMENSION,
  BoundedActivationGrid,
  DIGITAL_RAIN_ID,
  DIGITAL_RAIN_MAX_COLUMNS,
  DIGITAL_RAIN_MAX_ELEMENTS,
  DIGITAL_RAIN_MAX_GLYPHS,
  DIGITAL_RAIN_MAX_ROWS,
  DIGITAL_RAIN_MAX_TRAIL_CELLS,
  DIGITAL_RAIN_MIN_COLUMNS,
  DIGITAL_RAIN_MIN_ROWS,
  DIGITAL_RAIN_VISUAL_DEFINITION,
  getAudioVisualDefinition,
  registerCoreOverlayVisuals,
  resolveDigitalRainGrid,
  resolveDigitalRainLayoutShape,
} = await import(pathToFileURL(outfile).href);

const canvas = { width: 640, height: 360 };
const params = {
  sensitivity: 0.7,
  intensity: 0.68,
  smoothing: 0.42,
  color: ['#2a788e', '#22a884', '#7ad151', '#fde725'],
  density: 1,
  layoutMode: 'linear',
  highContrast: false,
};
const captureEnvironment = { amplitudeMode: 'capture', reduceMotion: false };
const previewEnvironment = { amplitudeMode: 'preview', reduceMotion: false };
const frame = {
  energy: 0.42,
  bands: Array.from({ length: 32 }, (_, index) => 0.22 + ((index * 11) % 23) / 30),
  timeMs: 1000,
  transient: false,
};

// Prototype methods keep gradient stubs deepEqual-comparable across context instances.
class MockGradient {
  constructor(args) {
    this.args = args;
    this.stops = [];
  }

  addColorStop(offset, color) {
    this.stops.push([offset, color]);
  }
}

function createContext() {
  const operations = [];
  const state = {};
  const stack = [];
  const ctx = {
    operations,
    createLinearGradient(...args) {
      const gradient = new MockGradient(args);
      operations.push(['createLinearGradient', ...args]);
      return gradient;
    },
    save() { stack.push({ ...state }); operations.push(['save']); },
    restore() {
      const restored = stack.pop();
      if (restored) {
        for (const key of Object.keys(state)) delete state[key];
        Object.assign(state, restored);
      }
      operations.push(['restore']);
    },
    beginPath() { operations.push(['beginPath']); },
    moveTo(x, y) { operations.push(['moveTo', x, y]); },
    lineTo(x, y) { operations.push(['lineTo', x, y]); },
    arc(...args) { operations.push(['arc', ...args]); },
    translate(x, y) { operations.push(['translate', x, y]); },
    rotate(angle) { operations.push(['rotate', angle]); },
    fillText(glyph, x, y) {
      operations.push([
        'fillText', glyph, x, y, state.font, state.fillStyle,
        state.shadowBlur, state.shadowColor,
      ]);
    },
    stroke() {
      operations.push([
        'stroke', state.strokeStyle, state.lineWidth, state.shadowBlur, state.shadowColor,
      ]);
    },
  };
  for (const property of [
    'fillStyle', 'strokeStyle', 'lineWidth', 'font', 'textAlign', 'textBaseline',
    'shadowBlur', 'shadowColor', 'globalCompositeOperation',
  ]) {
    Object.defineProperty(ctx, property, {
      get() { return state[property]; },
      set(value) { state[property] = value; operations.push([property, value]); },
    });
  }
  return ctx;
}

function renderRain(
  visual,
  inputFrame = frame,
  inputParams = params,
  environment = captureEnvironment,
  dt,
) {
  const ctx = createContext();
  if (dt !== undefined) visual.update(inputFrame, dt);
  visual.render(ctx, canvas, inputFrame, inputParams, environment);
  return ctx.operations;
}

function glyphOps(operations) {
  return operations.filter(([operation]) => operation === 'fillText');
}

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

console.log('Digital Rain overlay + bounded activation grid');

check('definition is registered, audio-aware, layout-capable, and hard-capped', () => {
  assert.deepEqual(
    [
      DIGITAL_RAIN_VISUAL_DEFINITION.id,
      DIGITAL_RAIN_VISUAL_DEFINITION.label,
      DIGITAL_RAIN_VISUAL_DEFINITION.family,
      DIGITAL_RAIN_VISUAL_DEFINITION.maxElements,
    ],
    [DIGITAL_RAIN_ID, 'Digital Rain', 'cellular-glyph-grid', DIGITAL_RAIN_MAX_ELEMENTS],
  );
  assert.equal(DIGITAL_RAIN_VISUAL_DEFINITION.wants.bands, true);
  assert.deepEqual(
    DIGITAL_RAIN_VISUAL_DEFINITION.create().supportedLayouts,
    ['linear', 'centered', 'radial'],
  );
  assert.equal(
    DIGITAL_RAIN_MAX_ELEMENTS,
    DIGITAL_RAIN_MAX_COLUMNS * DIGITAL_RAIN_MAX_TRAIL_CELLS + 1,
  );
  registerCoreOverlayVisuals();
  registerCoreOverlayVisuals();
  assert.equal(getAudioVisualDefinition('overlay', DIGITAL_RAIN_ID), DIGITAL_RAIN_VISUAL_DEFINITION);
});

check('density resolves only the consumed 14×9 through 32×18 lattice', () => {
  assert.deepEqual(resolveDigitalRainGrid(-2), {
    columns: DIGITAL_RAIN_MIN_COLUMNS,
    rows: DIGITAL_RAIN_MIN_ROWS,
  });
  assert.deepEqual(resolveDigitalRainGrid(2), {
    columns: DIGITAL_RAIN_MAX_COLUMNS,
    rows: DIGITAL_RAIN_MAX_ROWS,
  });
  for (const density of [0, 0.2, 0.5, 0.8, 1]) {
    const shape = resolveDigitalRainGrid(density);
    assert.ok(shape.columns * shape.rows <= DIGITAL_RAIN_MAX_GLYPHS);
  }
});

check('radial-only row reduction never shrinks linear or centered lattices', () => {
  for (const density of [0, 0.35, 0.56, 0.8, 1]) {
    const base = resolveDigitalRainGrid(density);
    assert.deepEqual(resolveDigitalRainLayoutShape(density, 'linear'), base);
    assert.deepEqual(resolveDigitalRainLayoutShape(density, 'centered'), base);
    const radial = resolveDigitalRainLayoutShape(density, 'radial');
    assert.equal(radial.columns, base.columns);
    assert.ok(radial.rows <= base.rows);
    assert.ok(radial.rows >= 7);
    if (base.rows >= 10) {
      assert.ok(radial.rows < base.rows);
    }
  }
});

check('BoundedActivationGrid clamps allocation and active topology', () => {
  const grid = new BoundedActivationGrid(1000, 1000);
  assert.equal(grid.capacityColumns, BOUNDED_ACTIVATION_GRID_MAX_DIMENSION);
  assert.equal(grid.capacityRows, BOUNDED_ACTIVATION_GRID_MAX_DIMENSION);
  assert.equal(grid.capacity, BOUNDED_ACTIVATION_GRID_MAX_CELLS);
  assert.equal(grid.configure(5, 4), true);
  assert.deepEqual([grid.columns, grid.rows], [5, 4]);
  grid.activate(2, 2, 1);
  assert.equal(grid.configure(4, 4), true);
  assert.equal(grid.countActive(), 0);
});

check('activation clamps values and rejects non-finite or out-of-bounds cells', () => {
  const grid = new BoundedActivationGrid(4, 3);
  assert.equal(grid.activate(1, 1, 5), true);
  assert.equal(grid.valueAt(1, 1), 1);
  assert.equal(grid.activate(-1, 0, 1), false);
  assert.equal(grid.activate(4, 0, 1), false);
  assert.equal(grid.activate(0, 0, Number.NaN), false);
  assert.equal(grid.valueAt(Infinity, 0), 0);
});

check('local propagation advances vertically and horizontally without wrapping', () => {
  const grid = new BoundedActivationGrid(4, 3);
  grid.activate(1, 0, 1);
  grid.propagate({ direction: 'down', decay: 0, transfer: 1 });
  assert.equal(grid.valueAt(1, 1), 1);
  assert.equal(grid.valueAt(1, 0), 0);
  grid.clear();
  grid.activate(0, 1, 1);
  grid.propagate({ direction: 'right', decay: 0, transfer: 1 });
  assert.equal(grid.valueAt(1, 1), 1);
  grid.clear();
  grid.activate(3, 1, 1);
  grid.propagate({ direction: 'right', decay: 0, transfer: 1 });
  assert.equal(grid.countActive(), 0);
});

check('diagonal spread and decay stay local, thresholded, and bounded', () => {
  const grid = new BoundedActivationGrid(4, 3);
  grid.activate(1, 0, 1);
  grid.propagate({ direction: 'down', decay: 0.25, transfer: 0.5, spread: 0.25 });
  assert.equal(grid.valueAt(1, 0), 0.25);
  assert.equal(grid.valueAt(1, 1), 0.5);
  assert.equal(grid.valueAt(0, 1), 0.25);
  assert.equal(grid.valueAt(2, 1), 0.25);
  grid.propagate({ direction: 'down', decay: 0.001, transfer: 0, threshold: 0.01 });
  assert.equal(grid.countActive(), 0);
});

check('two instances produce deterministic, finite, diverse glyph streams inside the element cap', () => {
  const first = DIGITAL_RAIN_VISUAL_DEFINITION.create();
  const second = DIGITAL_RAIN_VISUAL_DEFINITION.create();
  renderRain(first);
  renderRain(second);
  const later = { ...frame, timeMs: 1200 };
  const firstOps = renderRain(first, later, params, captureEnvironment, 0.1);
  const secondOps = renderRain(second, later, params, captureEnvironment, 0.1);
  assert.deepEqual(firstOps, secondOps);
  const glyphs = glyphOps(firstOps);
  assert.ok(glyphs.length > DIGITAL_RAIN_MIN_COLUMNS);
  assert.ok(glyphs.length <= DIGITAL_RAIN_MAX_GLYPHS);
  assert.ok(new Set(glyphs.map(([, glyph]) => glyph)).size >= 8);
  assert.ok(firstOps.flat().filter((value) => typeof value === 'number').every(Number.isFinite));
  assert.ok(glyphs.length + firstOps.filter(([operation]) => operation === 'stroke').length
    <= DIGITAL_RAIN_MAX_ELEMENTS);
});

check('linear, horizontal, and radial layouts share one grid but produce distinct coordinates', () => {
  const linearOps = renderRain(DIGITAL_RAIN_VISUAL_DEFINITION.create());
  const horizontalOps = renderRain(
    DIGITAL_RAIN_VISUAL_DEFINITION.create(),
    frame,
    { ...params, layoutMode: 'centered' },
  );
  const radialOps = renderRain(
    DIGITAL_RAIN_VISUAL_DEFINITION.create(),
    frame,
    { ...params, layoutMode: 'radial' },
  );
  assert.equal(linearOps.some(([operation]) => operation === 'translate'), false);
  assert.equal(horizontalOps.some(([operation]) => operation === 'translate'), false);
  assert.ok(radialOps.some(([operation]) => operation === 'translate'));
  assert.ok(radialOps.some(([operation]) => operation === 'rotate'));
  assert.notDeepEqual(glyphOps(linearOps), glyphOps(horizontalOps));
});

check('capture silence stays quiet while voice energy illuminates a fixed-size lattice', () => {
  const quiet = { ...frame, energy: 0, bands: Array(32).fill(0) };
  const loud = { ...frame, energy: 1, bands: Array(32).fill(1) };
  const quietGlyphs = glyphOps(renderRain(DIGITAL_RAIN_VISUAL_DEFINITION.create(), quiet));
  const loudGlyphs = glyphOps(renderRain(DIGITAL_RAIN_VISUAL_DEFINITION.create(), loud));
  assert.equal(quietGlyphs.length, 0);
  assert.ok(loudGlyphs.length > DIGITAL_RAIN_MAX_COLUMNS);
  assert.ok(loudGlyphs.length <= DIGITAL_RAIN_MAX_GLYPHS);
});

check('transients fork a broader bounded cascade than the same steady frame', () => {
  const baseFrame = { ...frame, energy: 0.2, bands: Array(32).fill(0.18) };
  const steady = DIGITAL_RAIN_VISUAL_DEFINITION.create();
  const transient = DIGITAL_RAIN_VISUAL_DEFINITION.create();
  renderRain(steady, baseFrame);
  renderRain(transient, baseFrame);
  const steadyOps = renderRain(steady, { ...baseFrame, timeMs: 1200 }, params, captureEnvironment, 0.2);
  const transientOps = renderRain(
    transient,
    { ...baseFrame, timeMs: 1200, transient: true },
    params,
    captureEnvironment,
    0.2,
  );
  assert.ok(glyphOps(transientOps).length > glyphOps(steadyOps).length);
  assert.ok(glyphOps(transientOps).length <= DIGITAL_RAIN_MAX_GLYPHS);
});

check('synthetic preview evolves deterministically without changing the capture contract', () => {
  const first = DIGITAL_RAIN_VISUAL_DEFINITION.create();
  const second = DIGITAL_RAIN_VISUAL_DEFINITION.create();
  let firstOps = renderRain(first, frame, params, previewEnvironment);
  let secondOps = renderRain(second, frame, params, previewEnvironment);
  const initial = firstOps;
  for (let index = 1; index <= 8; index += 1) {
    const nextFrame = { ...frame, timeMs: 1000 + index * 120 };
    firstOps = renderRain(first, nextFrame, params, previewEnvironment, 0.1);
    secondOps = renderRain(second, nextFrame, params, previewEnvironment, 0.1);
  }
  assert.deepEqual(firstOps, secondOps);
  assert.notDeepEqual(glyphOps(firstOps), glyphOps(initial));
});

check('lanes stay desynchronized with mostly-stable trail glyph identity', () => {
  const visual = DIGITAL_RAIN_VISUAL_DEFINITION.create();
  const loud = { ...frame, energy: 0.8, bands: Array(32).fill(0.8) };
  renderRain(visual, loud);
  let previousIdentity = null;
  let sharedRatioTotal = 0;
  let samples = 0;
  const perColumnCounts = new Map();
  for (let step = 1; step <= 12; step += 1) {
    const ops = renderRain(
      visual,
      { ...loud, timeMs: 1000 + step * 100 },
      params,
      captureEnvironment,
      0.1,
    );
    const glyphs = glyphOps(ops);
    const identity = new Set(glyphs.map(([, glyph, x, y]) => `${glyph}@${x},${y}`));
    if (previousIdentity) {
      let shared = 0;
      for (const key of identity) if (previousIdentity.has(key)) shared += 1;
      sharedRatioTotal += shared / Math.max(1, identity.size);
      samples += 1;
    }
    previousIdentity = identity;
    perColumnCounts.clear();
    for (const [, , x] of glyphs) perColumnCounts.set(x, (perColumnCounts.get(x) ?? 0) + 1);
    for (const count of perColumnCounts.values()) {
      assert.ok(count <= DIGITAL_RAIN_MAX_TRAIL_CELLS);
    }
  }
  // Desync: simultaneous lit-run lengths differ across columns (no global stepping).
  assert.ok(new Set(perColumnCounts.values()).size >= 3);
  // Encoder friendliness: most glyph cells persist frame-to-frame (no full-lattice strobe).
  assert.ok(sharedRatioTotal / Math.max(1, samples) > 0.5);
});

check('High Contrast removes glow and reduced motion freezes glyph identity and geometry', () => {
  const contrastOps = renderRain(
    DIGITAL_RAIN_VISUAL_DEFINITION.create(),
    frame,
    { ...params, highContrast: true },
  );
  assert.ok(glyphOps(contrastOps).length > 0);
  assert.ok(glyphOps(contrastOps).every(([, , , , , , shadowBlur]) => shadowBlur === 0));
  assert.ok(contrastOps.some(([operation, , width]) => operation === 'stroke' && width === 1.5));

  const visual = DIGITAL_RAIN_VISUAL_DEFINITION.create();
  const reduced = { amplitudeMode: 'preview', reduceMotion: true };
  const first = renderRain(visual, { ...frame, timeMs: 0 }, params, reduced, 0);
  const second = renderRain(visual, { ...frame, timeMs: 9000 }, params, reduced, 0.1);
  assert.deepEqual(second, first);
});

check('capture speech keeps outer lanes raining after the first stream cycle', () => {
  // Voice-like spectrum: strong mids, weak extreme bass/treble — the exact shape that
  // previously primed edge columns then permanently starved them on respawn.
  const speechBands = Array.from({ length: 32 }, (_, index) => {
    const t = index / 31;
    const mid = Math.exp(-((t - 0.45) ** 2) / (2 * 0.08 ** 2));
    return 0.08 + mid * 0.72;
  });
  const speech = {
    energy: 0.48,
    bands: speechBands,
    timeMs: 1000,
    transient: false,
  };
  const visual = DIGITAL_RAIN_VISUAL_DEFINITION.create();
  renderRain(visual, speech, params, captureEnvironment, 0);
  let lateEdgeHits = 0;
  let lateGlyphs = 0;
  const edgeMargin = canvas.width * 0.08;
  // Several full fall cycles (depth ~14 rows @ ~3–5 rows/s ⇒ multi-second sim).
  for (let step = 1; step <= 90; step += 1) {
    const ops = renderRain(
      visual,
      { ...speech, timeMs: 1000 + step * 100, energy: 0.42 + (step % 7) * 0.02 },
      params,
      captureEnvironment,
      0.1,
    );
    if (step < 45) continue;
    const glyphs = glyphOps(ops);
    lateGlyphs += glyphs.length;
    for (const [, , x] of glyphs) {
      if (x <= edgeMargin || x >= canvas.width - edgeMargin) lateEdgeHits += 1;
    }
  }
  assert.ok(lateGlyphs > 0, 'late frames still draw glyphs');
  assert.ok(
    lateEdgeHits > 0,
    'outer columns must keep respawning under capture speech (no previewTide)',
  );
});

check('active streams keep their spawn residual through quiet passages', () => {
  // Pass D follow-up: drive gates SPAWNING only. Once live, a stream must stay
  // visible at its spawn-time residual until its tail leaves the grid — under the
  // old drive-coupled decay, 2.5 s of near-silence dimmed every glyph below the
  // draw cutoff mid-fall (and the next word re-lit them mid-air).
  const visual = DIGITAL_RAIN_VISUAL_DEFINITION.create();
  const loud = { ...frame, energy: 0.85, bands: Array(32).fill(0.85) };
  const primed = glyphOps(renderRain(visual, loud));
  assert.ok(primed.length > 0, 'loud prime spawns streams');
  const quiet = { ...frame, energy: 0.015, bands: Array(32).fill(0.01) };
  let ops = [];
  for (let step = 1; step <= 25; step += 1) {
    ops = renderRain(
      visual,
      { ...quiet, timeMs: 1000 + step * 100 },
      params,
      captureEnvironment,
      0.1,
    );
  }
  const surviving = glyphOps(ops);
  assert.ok(
    surviving.length > 0,
    'streams spawned before the quiet passage must live out their pass',
  );
  // Residual floor: surviving glyph alphas stay well above the draw cutoff
  // instead of hovering at the near-zero live drive.
  const alphas = surviving.map(([, , , , , fillStyle]) => {
    const match = /rgba\([^)]+,\s*([\d.]+)\)/.exec(String(fillStyle));
    return match ? Number(match[1]) : 0;
  });
  assert.ok(Math.max(...alphas) > 0.3, 'head cells hold spawn-residual brightness');
});

check('layout switch restores full linear lattice after radial coarsening', () => {
  const visual = DIGITAL_RAIN_VISUAL_DEFINITION.create();
  const loud = { ...frame, energy: 0.85, bands: Array(32).fill(0.85) };
  renderRain(visual, loud, { ...params, layoutMode: 'radial' }, captureEnvironment, 0.1);
  // Advance far enough that radial streams complete, then hot-swap to linear.
  for (let step = 1; step <= 20; step += 1) {
    renderRain(
      visual,
      { ...loud, timeMs: 1000 + step * 100 },
      { ...params, layoutMode: 'radial' },
      captureEnvironment,
      0.1,
    );
  }
  const linearOps = renderRain(
    visual,
    { ...loud, timeMs: 4000 },
    { ...params, layoutMode: 'linear' },
    captureEnvironment,
    0.1,
  );
  const xs = new Set(glyphOps(linearOps).map(([, , x]) => x));
  // Full linear density at default 0.56 ⇒ ~24 columns spanning the canvas.
  assert.ok(xs.size >= DIGITAL_RAIN_MIN_COLUMNS - 2);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  assert.ok(minX < canvas.width * 0.12, 'linear after radial still reaches left edge');
  assert.ok(maxX > canvas.width * 0.88, 'linear after radial still reaches right edge');
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-digital-rain-overlay: ${checks} checks passed`);
