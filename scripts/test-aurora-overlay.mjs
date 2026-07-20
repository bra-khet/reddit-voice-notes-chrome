// v6.0 Phase 3 — registry-native Aurora with bounded flow-field ribbons.
//
//   Run: node scripts/test-aurora-overlay.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-aurora-'));
const outfile = join(outdir, 'aurora.mjs');

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
    sourcefile: 'aurora-test-entry.ts',
  },
});

const {
  AURORA_ID,
  AURORA_LABEL,
  AURORA_LANE_COUNT,
  AURORA_MAX_ELEMENTS,
  AURORA_MAX_PARTICLES,
  AURORA_MIN_PARTICLES,
  AURORA_VISUAL_DEFINITION,
  getAudioVisualDefinition,
  registerCoreOverlayVisuals,
  resolveAuroraParticleLimit,
} = await import(pathToFileURL(outfile).href);

const canvas = { width: 640, height: 360 };
const params = {
  sensitivity: 0.7,
  intensity: 0.72,
  smoothing: 0.58,
  color: ['#071a52', '#174f8f', '#16c7a3', '#7cffcb', '#d7fff2'],
  density: 1,
  layoutMode: 'linear',
  highContrast: false,
};
const captureEnvironment = { amplitudeMode: 'capture', reduceMotion: false };
const previewEnvironment = { amplitudeMode: 'preview', reduceMotion: false };
const frame = {
  energy: 0.44,
  bands: Array.from({ length: 32 }, (_, index) => 0.18 + ((index * 13) % 27) / 34),
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
  let path = [];
  const ctx = {
    operations,
    createLinearGradient(...args) {
      const gradient = new MockGradient(args);
      operations.push(['createLinearGradient', ...args]);
      return gradient;
    },
    createRadialGradient(...args) {
      const gradient = new MockGradient(args);
      operations.push(['createRadialGradient', ...args]);
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
    beginPath() { path = []; operations.push(['beginPath']); },
    closePath() { path.push(['closePath']); operations.push(['closePath']); },
    moveTo(x, y) { path.push(['moveTo', x, y]); operations.push(['moveTo', x, y]); },
    lineTo(x, y) { path.push(['lineTo', x, y]); operations.push(['lineTo', x, y]); },
    bezierCurveTo(...args) {
      path.push(['bezierCurveTo', ...args]);
      operations.push(['bezierCurveTo', ...args]);
    },
    arc(...args) { path.push(['arc', ...args]); operations.push(['arc', ...args]); },
    fill() {
      operations.push([
        'fill', state.fillStyle, state.shadowBlur, state.shadowColor,
        path.map((entry) => [...entry]),
      ]);
    },
    stroke() {
      operations.push([
        'stroke', state.strokeStyle, state.lineWidth, state.shadowBlur, state.shadowColor,
        path.map((entry) => [...entry]),
      ]);
    },
  };
  for (const property of [
    'fillStyle', 'strokeStyle', 'lineWidth', 'shadowBlur', 'shadowColor',
    'globalAlpha', 'globalCompositeOperation',
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

function renderAurora(
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

function paintOperations(operations) {
  return operations.filter(([operation]) => operation === 'fill' || operation === 'stroke');
}

function ribbonFills(operations) {
  return operations.filter(
    ([operation, , , , path]) => operation === 'fill'
      && path?.filter(([pathOperation]) => pathOperation === 'bezierCurveTo').length >= 2,
  );
}

function ribbonPointBudget(operations) {
  return ribbonFills(operations).reduce(
    (sum, [, , , , path]) =>
      sum + path.filter(([pathOperation]) => pathOperation === 'bezierCurveTo').length,
    0,
  );
}

function ribbonStrokes(operations) {
  return operations.filter(
    ([operation, , , , , path]) => operation === 'stroke'
      && path?.some(([pathOperation]) => pathOperation === 'bezierCurveTo'),
  );
}

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

console.log('Aurora overlay');

check('definition is registered, audio-aware, layout-capable, and hard-capped', () => {
  assert.deepEqual(
    [
      AURORA_VISUAL_DEFINITION.id,
      AURORA_VISUAL_DEFINITION.label,
      AURORA_VISUAL_DEFINITION.family,
      AURORA_VISUAL_DEFINITION.maxElements,
    ],
    [AURORA_ID, AURORA_LABEL, 'flow-field-ribbons', AURORA_MAX_ELEMENTS],
  );
  assert.equal(AURORA_VISUAL_DEFINITION.wants.bands, true);
  assert.deepEqual(
    AURORA_VISUAL_DEFINITION.create().supportedLayouts,
    ['linear', 'centered', 'radial'],
  );
  assert.equal(AURORA_MAX_ELEMENTS, AURORA_LANE_COUNT * 2 + 3);
  registerCoreOverlayVisuals();
  registerCoreOverlayVisuals();
  assert.equal(getAudioVisualDefinition('overlay', AURORA_ID), AURORA_VISUAL_DEFINITION);
});

check('density resolves only the documented 42–84 control-point range', () => {
  assert.equal(resolveAuroraParticleLimit(-2), AURORA_MIN_PARTICLES);
  assert.equal(resolveAuroraParticleLimit(2), AURORA_MAX_PARTICLES);
  assert.equal(resolveAuroraParticleLimit(0.5), 63);
});

check('two instances render deterministic finite ribbons inside the element cap', () => {
  const first = renderAurora(AURORA_VISUAL_DEFINITION.create());
  const second = renderAurora(AURORA_VISUAL_DEFINITION.create());
  assert.deepEqual(first, second);
  // One joined ribbon per populated lane (plus the source front stroke).
  assert.ok(ribbonFills(first).length >= 4);
  assert.ok(ribbonFills(first).length <= AURORA_LANE_COUNT);
  assert.equal(ribbonFills(first).length, ribbonStrokes(first).length - 1);
  assert.ok(first.flat(Infinity).filter((value) => typeof value === 'number').every(Number.isFinite));
  assert.ok(paintOperations(first).length <= AURORA_MAX_ELEMENTS);
});

check('linear, opposing-side centered, and radial-rim sources are geometrically distinct', () => {
  const linear = renderAurora(AURORA_VISUAL_DEFINITION.create());
  const centered = renderAurora(
    AURORA_VISUAL_DEFINITION.create(),
    frame,
    { ...params, layoutMode: 'centered' },
  );
  const radial = renderAurora(
    AURORA_VISUAL_DEFINITION.create(),
    frame,
    { ...params, layoutMode: 'radial' },
  );
  assert.notDeepEqual(ribbonFills(linear), ribbonFills(centered));
  assert.notDeepEqual(ribbonFills(centered), ribbonFills(radial));
  assert.equal(centered.filter(([operation]) => operation === 'lineTo').length >= 2, true);
  assert.ok(radial.some(([operation]) => operation === 'arc'));
});

check('capture silence stays empty while voice energy forms a layered curtain', () => {
  const quiet = { ...frame, energy: 0, bands: Array(32).fill(0) };
  const loud = { ...frame, energy: 1, bands: Array(32).fill(1) };
  const quietOps = renderAurora(AURORA_VISUAL_DEFINITION.create(), quiet);
  const loudOps = renderAurora(AURORA_VISUAL_DEFINITION.create(), loud);
  assert.equal(paintOperations(quietOps).length, 0);
  assert.ok(ribbonFills(loudOps).length >= 6);
  assert.ok(loudOps.some(([operation, value]) => operation === 'globalCompositeOperation' && value === 'lighter'));
});

check('band weighting changes the curtain at its source rather than only recoloring it', () => {
  const bass = renderAurora(
    AURORA_VISUAL_DEFINITION.create(),
    frame,
    { ...params, bassWeight: 2, midWeight: 0, trebleWeight: 0 },
  );
  const treble = renderAurora(
    AURORA_VISUAL_DEFINITION.create(),
    frame,
    { ...params, bassWeight: 0, midWeight: 0, trebleWeight: 2 },
  );
  assert.notDeepEqual(ribbonFills(bass), ribbonFills(treble));
});

check('transients inject an immediate bounded set of sharp folds', () => {
  const steady = AURORA_VISUAL_DEFINITION.create();
  const transient = AURORA_VISUAL_DEFINITION.create();
  const base = { ...frame, energy: 0.11, bands: Array(32).fill(0.09) };
  renderAurora(steady, base);
  renderAurora(transient, base);
  const steadyOps = renderAurora(
    steady,
    { ...base, timeMs: 1100 },
    params,
    captureEnvironment,
    0.1,
  );
  const transientOps = renderAurora(
    transient,
    { ...base, timeMs: 1100, transient: true },
    params,
    captureEnvironment,
    0.1,
  );
  // Transient spawns add control points, so the joined ribbons carry more curve segments.
  assert.ok(ribbonPointBudget(transientOps) > ribbonPointBudget(steadyOps));
  assert.ok(paintOperations(transientOps).length <= AURORA_MAX_ELEMENTS);
});

check('synthetic preview evolves deterministically through the shared flow field', () => {
  const first = AURORA_VISUAL_DEFINITION.create();
  const second = AURORA_VISUAL_DEFINITION.create();
  const initial = renderAurora(first, frame, params, previewEnvironment);
  renderAurora(second, frame, params, previewEnvironment);
  let firstOps = initial;
  let secondOps = initial;
  for (let index = 1; index <= 7; index += 1) {
    const next = { ...frame, timeMs: 1000 + index * 100 };
    firstOps = renderAurora(first, next, params, previewEnvironment, 0.1);
    secondOps = renderAurora(second, next, params, previewEnvironment, 0.1);
  }
  assert.deepEqual(firstOps, secondOps);
  assert.notDeepEqual(ribbonFills(firstOps), ribbonFills(initial));
});

check('High Contrast renders crisp cyan-white folds without glow blur', () => {
  const operations = renderAurora(
    AURORA_VISUAL_DEFINITION.create(),
    frame,
    { ...params, highContrast: true },
  );
  // Pass D: fold lines may stroke with end-taper gradients — accept white either
  // as a plain stroke string or inside a gradient's stops.
  assert.ok(operations.some(([operation, value]) => operation === 'strokeStyle'
    && (typeof value === 'string'
      ? value.includes('255, 255, 255')
      : value?.stops?.some(([, color]) => color.includes('255, 255, 255')))));
  assert.ok(operations.some(([operation, value]) => operation === 'globalCompositeOperation' && value === 'source-over'));
  assert.equal(
    operations.some(([operation, value]) => operation === 'shadowBlur' && value > 0),
    false,
  );
});

check('reduced motion is one frozen audio-scaled curtain sculpture', () => {
  const visual = AURORA_VISUAL_DEFINITION.create();
  const reduced = { amplitudeMode: 'preview', reduceMotion: true };
  const first = renderAurora(visual, { ...frame, timeMs: 0 }, params, reduced, 0);
  const second = renderAurora(visual, { ...frame, timeMs: 9000 }, params, reduced, 0.1);
  assert.deepEqual(second, first);
  assert.ok(ribbonFills(first).length >= 6);
  assert.ok(paintOperations(first).length <= AURORA_MAX_ELEMENTS);
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-aurora-overlay: ${checks} checks passed`);
