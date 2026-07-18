// v6.0 Phase 3 — registry-native Glitch with bounded signal corruption.
//
//   Run: node scripts/test-glitch-overlay.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-glitch-'));
const outfile = join(outdir, 'glitch.mjs');

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
    sourcefile: 'glitch-test-entry.ts',
  },
});

const {
  GLITCH_ID,
  GLITCH_LABEL,
  GLITCH_MAX_ELEMENTS,
  GLITCH_MAX_SCANLINES,
  GLITCH_MAX_TEAR_COUNT,
  GLITCH_MAX_WAVE_ROWS,
  GLITCH_MIN_SCANLINES,
  GLITCH_VISUAL_DEFINITION,
  getAudioVisualDefinition,
  registerCoreOverlayVisuals,
  resolveGlitchScanlineCount,
} = await import(pathToFileURL(outfile).href);

const canvas = { width: 640, height: 360 };
const params = {
  sensitivity: 0.72,
  intensity: 0.76,
  smoothing: 0.3,
  color: ['#ff2f92', '#00eaff', '#7dff72', '#f7fbff'],
  density: 1,
  bassWeight: 0.84,
  midWeight: 1,
  trebleWeight: 1.34,
  layoutMode: 'linear',
  highContrast: false,
};
const captureEnvironment = { amplitudeMode: 'capture', reduceMotion: false };
const previewEnvironment = { amplitudeMode: 'preview', reduceMotion: false };
const frame = {
  energy: 0.42,
  bands: Array.from({ length: 32 }, (_, index) => 0.12 + ((index * 17) % 29) / 36),
  timeMs: 1000,
  transient: false,
};

function createContext() {
  const operations = [];
  const state = {};
  const stack = [];
  const ctx = {
    operations,
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
    arc(...args) { operations.push(['arc', ...args]); },
    stroke() { operations.push(['stroke', state.strokeStyle, state.lineWidth]); },
    fillRect(...args) { operations.push(['fillRect', state.fillStyle, ...args]); },
    drawImage(...args) { operations.push(['drawImage', state.filter, state.globalAlpha, ...args]); },
  };
  for (const property of [
    'fillStyle', 'strokeStyle', 'lineWidth', 'filter', 'globalAlpha',
    'globalCompositeOperation', 'imageSmoothingEnabled', 'shadowBlur',
  ]) {
    Object.defineProperty(ctx, property, {
      get() { return state[property]; },
      set(value) {
        state[property] = value;
        operations.push([property, value]);
      },
    });
  }
  return ctx;
}

function renderGlitch(
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

function elementOperations(operations) {
  return operations.filter(([operation]) => (
    operation === 'drawImage' || operation === 'fillRect' || operation === 'stroke'
  ));
}

function tearCopies(operations) {
  return operations.filter(([operation, , , ...args]) => operation === 'drawImage' && args.length === 9);
}

function fullSplitCopies(operations) {
  return operations.filter(([operation, , , ...args]) => operation === 'drawImage' && args.length === 3);
}

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

console.log('Glitch overlay');

check('definition is registered, band-aware, layout-capable, and hard-capped', () => {
  assert.deepEqual(
    [
      GLITCH_VISUAL_DEFINITION.id,
      GLITCH_VISUAL_DEFINITION.label,
      GLITCH_VISUAL_DEFINITION.family,
      GLITCH_VISUAL_DEFINITION.maxElements,
    ],
    [GLITCH_ID, GLITCH_LABEL, 'signal-corruption', GLITCH_MAX_ELEMENTS],
  );
  assert.equal(GLITCH_VISUAL_DEFINITION.wants.bands, true);
  assert.deepEqual(
    GLITCH_VISUAL_DEFINITION.create().supportedLayouts,
    ['linear', 'centered', 'radial'],
  );
  assert.equal(
    GLITCH_MAX_ELEMENTS,
    GLITCH_MAX_SCANLINES + 2 + GLITCH_MAX_TEAR_COUNT * 4 + GLITCH_MAX_WAVE_ROWS + 3,
  );
  registerCoreOverlayVisuals();
  registerCoreOverlayVisuals();
  assert.equal(getAudioVisualDefinition('overlay', GLITCH_ID), GLITCH_VISUAL_DEFINITION);
});

check('density resolves only the documented 12–36 scanline range', () => {
  assert.equal(resolveGlitchScanlineCount(-2), GLITCH_MIN_SCANLINES);
  assert.equal(resolveGlitchScanlineCount(2), GLITCH_MAX_SCANLINES);
  assert.equal(resolveGlitchScanlineCount(0.5), 24);
});

check('steady signal renders deterministic finite corruption below the element cap', () => {
  const first = renderGlitch(GLITCH_VISUAL_DEFINITION.create());
  const second = renderGlitch(GLITCH_VISUAL_DEFINITION.create());
  assert.deepEqual(first, second);
  assert.equal(fullSplitCopies(first).length, 2);
  assert.equal(tearCopies(first).length, 0);
  assert.ok(first.flat(Infinity).filter((value) => typeof value === 'number').every(Number.isFinite));
  assert.ok(elementOperations(first).length <= GLITCH_MAX_ELEMENTS);
});

check('explicit transients immediately create bounded chunk tears and RGB ghosts', () => {
  const operations = renderGlitch(
    GLITCH_VISUAL_DEFINITION.create(),
    { ...frame, transient: true },
  );
  assert.ok(tearCopies(operations).length >= 2);
  // Nine-argument copies now include the burst-gated wave slices as well as the tears.
  assert.ok(tearCopies(operations).length <= GLITCH_MAX_TEAR_COUNT + GLITCH_MAX_WAVE_ROWS);
  assert.equal(fullSplitCopies(operations).length, 2);
  assert.ok(operations.some(([operation, value]) => operation === 'filter' && String(value).includes('hue-rotate')));
  assert.ok(elementOperations(operations).length <= GLITCH_MAX_ELEMENTS);
});

check('preset-local spectral flux detects a live onset without a producer hint', () => {
  const visual = GLITCH_VISUAL_DEFINITION.create();
  renderGlitch(
    visual,
    { ...frame, energy: 0.03, bands: Array(32).fill(0.02), transient: false },
  );
  const operations = renderGlitch(
    visual,
    { ...frame, energy: 0.72, bands: Array(32).fill(0.86), timeMs: 1100, transient: false },
    params,
    captureEnvironment,
    0.1,
  );
  assert.ok(tearCopies(operations).length >= 2);
});

check('capture silence retains only a low-entropy scan texture', () => {
  const quiet = renderGlitch(
    GLITCH_VISUAL_DEFINITION.create(),
    { ...frame, energy: 0, bands: Array(32).fill(0), transient: false },
  );
  const voice = renderGlitch(GLITCH_VISUAL_DEFINITION.create(), frame);
  assert.equal(quiet.some(([operation]) => operation === 'drawImage'), false);
  assert.ok(quiet.filter(([operation]) => operation === 'fillRect').length >= GLITCH_MIN_SCANLINES);
  assert.ok(elementOperations(voice).length > elementOperations(quiet).length);
});

check('linear, bilateral centered, and radial corruption geometries are distinct', () => {
  const transient = { ...frame, transient: true };
  const linear = renderGlitch(GLITCH_VISUAL_DEFINITION.create(), transient);
  const centered = renderGlitch(
    GLITCH_VISUAL_DEFINITION.create(),
    transient,
    { ...params, layoutMode: 'centered' },
  );
  const radial = renderGlitch(
    GLITCH_VISUAL_DEFINITION.create(),
    transient,
    { ...params, layoutMode: 'radial' },
  );
  assert.notDeepEqual(tearCopies(linear), tearCopies(centered));
  assert.notDeepEqual(tearCopies(centered), tearCopies(radial));
  assert.ok(radial.some(([operation]) => operation === 'arc'));
});

check('all nine-argument source and destination rectangles stay on-canvas', () => {
  const operations = renderGlitch(
    GLITCH_VISUAL_DEFINITION.create(),
    { ...frame, transient: true },
    { ...params, layoutMode: 'radial' },
  );
  for (const [, , , source, sx, sy, sw, sh, dx, dy, dw, dh] of tearCopies(operations)) {
    assert.equal(source, canvas);
    assert.ok(sx >= 0 && sy >= 0 && dx >= 0 && dy >= 0);
    assert.ok(sx + sw <= canvas.width + 1e-6 && dx + dw <= canvas.width + 1e-6);
    assert.ok(sy + sh <= canvas.height + 1e-6 && dy + dh <= canvas.height + 1e-6);
  }
});

check('band weighting changes displacement strength rather than merely color', () => {
  const transient = { ...frame, transient: true };
  const bass = renderGlitch(
    GLITCH_VISUAL_DEFINITION.create(),
    transient,
    { ...params, bassWeight: 2, midWeight: 0, trebleWeight: 0 },
  );
  const treble = renderGlitch(
    GLITCH_VISUAL_DEFINITION.create(),
    transient,
    { ...params, bassWeight: 0, midWeight: 0, trebleWeight: 2 },
  );
  assert.notDeepEqual(tearCopies(bass), tearCopies(treble));
});

check('synthetic preview bursts evolve deterministically on a bounded cadence', () => {
  const first = GLITCH_VISUAL_DEFINITION.create();
  const second = GLITCH_VISUAL_DEFINITION.create();
  const initial = renderGlitch(first, frame, params, previewEnvironment);
  renderGlitch(second, frame, params, previewEnvironment);
  const nextFrame = { ...frame, timeMs: 2320 };
  const firstNext = renderGlitch(first, nextFrame, params, previewEnvironment, 0.1);
  const secondNext = renderGlitch(second, nextFrame, params, previewEnvironment, 0.1);
  assert.deepEqual(firstNext, secondNext);
  assert.notDeepEqual(tearCopies(firstNext), tearCopies(initial));
  assert.ok(elementOperations(firstNext).length <= GLITCH_MAX_ELEMENTS);
});

check('High Contrast keeps hard source-over fringes and suppresses filtered ghosts', () => {
  const operations = renderGlitch(
    GLITCH_VISUAL_DEFINITION.create(),
    { ...frame, transient: true },
    { ...params, highContrast: true },
  );
  assert.equal(fullSplitCopies(operations).length, 0);
  assert.ok(tearCopies(operations).length > 0);
  assert.ok(operations.some(([operation, value]) => operation === 'globalCompositeOperation' && value === 'source-over'));
  assert.equal(
    operations.some(([operation, value]) => operation === 'filter' && String(value).includes('hue-rotate')),
    false,
  );
});

check('reduced motion is time-independent and never copies retained canvas pixels', () => {
  const visual = GLITCH_VISUAL_DEFINITION.create();
  const reduced = { amplitudeMode: 'preview', reduceMotion: true };
  const first = renderGlitch(visual, { ...frame, timeMs: 0 }, params, reduced, 0);
  const second = renderGlitch(visual, { ...frame, timeMs: 9000 }, params, reduced, 0.1);
  assert.deepEqual(second, first);
  assert.equal(first.some(([operation]) => operation === 'drawImage'), false);
  assert.ok(elementOperations(first).length <= GLITCH_MAX_ELEMENTS);
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-glitch-overlay: ${checks} checks passed`);
