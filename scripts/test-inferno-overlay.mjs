// v6.0 Phase 3 — consumed bounded emitter + registry-native Inferno / Void Inferno.
//
//   Run: node scripts/test-inferno-overlay.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-inferno-'));
const outfile = join(outdir, 'inferno.mjs');

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
    sourcefile: 'inferno-test-entry.ts',
  },
});

const {
  BOUNDED_PARTICLE_EMITTER_MAX_CAPACITY,
  BoundedParticleEmitter,
  INFERNO_ID,
  INFERNO_LABEL,
  INFERNO_MAX_ELEMENTS,
  INFERNO_MAX_PARTICLES,
  INFERNO_MIN_PARTICLES,
  INFERNO_VISUAL_DEFINITION,
  VOID_INFERNO_LABEL,
  getAudioVisualDefinition,
  registerCoreOverlayVisuals,
  resolveInfernoParticleLimit,
  resolveInfernoVariant,
} = await import(pathToFileURL(outfile).href);

const canvas = { width: 640, height: 360 };
const params = {
  sensitivity: 0.72,
  intensity: 0.76,
  smoothing: 0.42,
  color: ['#3b0805', '#9e1b08', '#ed4b0b', '#ff9f0a', '#fff1b8'],
  density: 1,
  layoutMode: 'linear',
  highContrast: false,
};
const captureEnvironment = { amplitudeMode: 'capture', reduceMotion: false };
const previewEnvironment = { amplitudeMode: 'preview', reduceMotion: false };
const frame = {
  energy: 0.46,
  bands: Array.from({ length: 32 }, (_, index) => 0.2 + ((index * 17) % 29) / 36),
  timeMs: 1000,
  transient: false,
};

function createGradient(args) {
  return {
    __gradient: true,
    args,
    stops: [],
    addColorStop(offset, color) { this.stops.push([offset, color]); },
  };
}

function createContext() {
  const operations = [];
  const state = {};
  const stack = [];
  let path = [];
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
    beginPath() { path = []; operations.push(['beginPath']); },
    closePath() { path.push(['closePath']); operations.push(['closePath']); },
    moveTo(x, y) { path.push(['moveTo', x, y]); operations.push(['moveTo', x, y]); },
    lineTo(x, y) { path.push(['lineTo', x, y]); operations.push(['lineTo', x, y]); },
    bezierCurveTo(...args) {
      path.push(['bezierCurveTo', ...args]);
      operations.push(['bezierCurveTo', ...args]);
    },
    arc(...args) { path.push(['arc', ...args]); operations.push(['arc', ...args]); },
    ellipse(...args) { path.push(['ellipse', ...args]); operations.push(['ellipse', ...args]); },
    fill() {
      operations.push([
        'fill',
        state.fillStyle?.__gradient
          ? { gradient: state.fillStyle.args, stops: state.fillStyle.stops.map((stop) => [...stop]) }
          : state.fillStyle,
        state.shadowBlur,
        state.shadowColor,
        path.map((entry) => [...entry]),
      ]);
    },
    stroke() {
      operations.push([
        'stroke',
        // Pass D: ember trails stroke with taper gradients — unwrap them like fill()
        // does so deterministic-instance deepEqual compares stops, not closures.
        state.strokeStyle?.__gradient
          ? { gradient: state.strokeStyle.args, stops: state.strokeStyle.stops.map((stop) => [...stop]) }
          : state.strokeStyle,
        state.lineWidth, state.shadowBlur, state.shadowColor,
        path.map((entry) => [...entry]),
      ]);
    },
    createRadialGradient(...args) {
      operations.push(['createRadialGradient', ...args]);
      return createGradient(args);
    },
    createLinearGradient(...args) {
      operations.push(['createLinearGradient', ...args]);
      return createGradient(args);
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
        operations.push([property, value?.__gradient ? 'gradient' : value]);
      },
    });
  }
  return ctx;
}

function renderInferno(
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

function flameFills(operations) {
  return operations.filter(
    ([operation, , , , path]) => operation === 'fill'
      && path?.some(([pathOperation]) => pathOperation === 'bezierCurveTo'),
  );
}

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

console.log('Inferno overlay + bounded emitter');

check('definition is registered, audio-aware, layout-capable, and hard-capped', () => {
  assert.deepEqual(
    [
      INFERNO_VISUAL_DEFINITION.id,
      INFERNO_VISUAL_DEFINITION.label,
      INFERNO_VISUAL_DEFINITION.family,
      INFERNO_VISUAL_DEFINITION.maxElements,
    ],
    [INFERNO_ID, INFERNO_LABEL, 'flow-field-fire', INFERNO_MAX_ELEMENTS],
  );
  assert.equal(VOID_INFERNO_LABEL, 'Void Inferno');
  assert.equal(INFERNO_VISUAL_DEFINITION.wants.bands, true);
  assert.deepEqual(
    INFERNO_VISUAL_DEFINITION.create().supportedLayouts,
    ['linear', 'centered', 'radial'],
  );
  assert.equal(INFERNO_MAX_ELEMENTS, INFERNO_MAX_PARTICLES * 3 + 6);
  registerCoreOverlayVisuals();
  registerCoreOverlayVisuals();
  assert.equal(getAudioVisualDefinition('overlay', INFERNO_ID), INFERNO_VISUAL_DEFINITION);
});

check('density resolves only the consumed 28–72 particle range', () => {
  assert.equal(resolveInfernoParticleLimit(-2), INFERNO_MIN_PARTICLES);
  assert.equal(resolveInfernoParticleLimit(2), INFERNO_MAX_PARTICLES);
  for (const density of [0, 0.2, 0.5, 0.8, 1]) {
    const count = resolveInfernoParticleLimit(density);
    assert.ok(count >= INFERNO_MIN_PARTICLES && count <= INFERNO_MAX_PARTICLES);
  }
});

check('BoundedParticleEmitter hard-clamps allocation and reuses fixed identities', () => {
  const emitter = new BoundedParticleEmitter(999, (index) => ({
    index, active: false, age: 0, lifetime: 1,
  }));
  assert.equal(emitter.capacity, BOUNDED_PARTICLE_EMITTER_MAX_CAPACITY);
  const identities = [...emitter.particles];
  emitter.configureLimit(3);
  for (let index = 0; index < 7; index += 1) {
    emitter.emit((particle) => { particle.lifetime = 1 + index; });
  }
  assert.equal(emitter.activeCount, 3);
  assert.deepEqual(emitter.particles, identities);
  assert.deepEqual(emitter.particles.slice(0, 3).map(({ active }) => active), [true, true, true]);
});

check('emitter lifetime expiry, limit changes, and recycling remain bounded', () => {
  const expiring = new BoundedParticleEmitter(1, (index) => ({
    index, active: false, age: 0, lifetime: 1,
  }));
  expiring.emit((particle) => { particle.lifetime = 0.1; });
  expiring.advance(0.25);
  assert.equal(expiring.activeCount, 0);

  const emitter = new BoundedParticleEmitter(4, (index) => ({
    index, active: false, age: 0, lifetime: 1,
  }));
  let recycled = false;
  for (let index = 0; index < 4; index += 1) {
    emitter.emit((particle) => { particle.lifetime = index === 0 ? 0.1 : 2; });
  }
  emitter.emit((_particle, _index, didRecycle) => { recycled = didRecycle; });
  assert.equal(recycled, true);
  emitter.advance(0.25);
  assert.ok(emitter.activeCount <= 4);
  assert.equal(emitter.configureLimit(2), 2);
  assert.ok(emitter.activeCount <= 2);
  emitter.clear();
  assert.equal(emitter.activeCount, 0);
});

check('two instances produce deterministic finite fire inside the element cap', () => {
  const first = INFERNO_VISUAL_DEFINITION.create();
  const second = INFERNO_VISUAL_DEFINITION.create();
  renderInferno(first);
  renderInferno(second);
  const later = { ...frame, timeMs: 1100 };
  const firstOps = renderInferno(first, later, params, captureEnvironment, 0.1);
  const secondOps = renderInferno(second, later, params, captureEnvironment, 0.1);
  assert.deepEqual(firstOps, secondOps);
  assert.ok(flameFills(firstOps).length > 8);
  assert.ok(firstOps.flat(Infinity).filter((value) => typeof value === 'number').every(Number.isFinite));
  assert.ok(paintOperations(firstOps).length <= INFERNO_MAX_ELEMENTS);
});

check('linear hearth, centered bonfire, and radial corona have distinct geometry', () => {
  const linear = renderInferno(INFERNO_VISUAL_DEFINITION.create());
  const centered = renderInferno(
    INFERNO_VISUAL_DEFINITION.create(),
    frame,
    { ...params, layoutMode: 'centered' },
  );
  const radial = renderInferno(
    INFERNO_VISUAL_DEFINITION.create(),
    frame,
    { ...params, layoutMode: 'radial' },
  );
  assert.notDeepEqual(flameFills(linear), flameFills(centered));
  assert.notDeepEqual(flameFills(centered), flameFills(radial));
  const radialCoordinates = radial
    .filter(([operation]) => operation === 'moveTo')
    .flatMap(([, x, y]) => [x, y]);
  assert.ok(radialCoordinates.some((value) => value < canvas.height * 0.45));
});

check('capture silence stays empty while voice energy grows a layered flame field', () => {
  const quiet = { ...frame, energy: 0, bands: Array(32).fill(0) };
  const loud = { ...frame, energy: 1, bands: Array(32).fill(1) };
  const quietOps = renderInferno(INFERNO_VISUAL_DEFINITION.create(), quiet);
  const loudOps = renderInferno(INFERNO_VISUAL_DEFINITION.create(), loud);
  assert.equal(flameFills(quietOps).length, 0);
  assert.ok(flameFills(loudOps).length > flameFills(quietOps).length);
  assert.ok(loudOps.some(([operation]) => operation === 'ellipse'));
  assert.ok(loudOps.some(([operation]) => operation === 'createRadialGradient'));
  // Flame front: a gradient-bodied crest paints over the tongue roots and stays in the
  // lower half of the canvas (QA §3e).
  assert.ok(loudOps.some(([operation]) => operation === 'createLinearGradient'));
  // Pass D: ember-trail tapers also use linear gradients at particle coordinates;
  // the lower-half invariant applies to the VERTICAL front-layer gradients only.
  const frontYs = loudOps
    .filter(([operation, x0, , x1]) => operation === 'createLinearGradient' && x0 === 0 && x1 === 0)
    .map(([, , , , y1]) => y1);
  assert.ok(frontYs.length > 0);
  assert.ok(frontYs.every((y) => y >= canvas.height * 0.5 - 1));
});

check('transients throw an immediate bounded spark-and-flame burst', () => {
  const steady = INFERNO_VISUAL_DEFINITION.create();
  const transient = INFERNO_VISUAL_DEFINITION.create();
  const base = { ...frame, energy: 0.12, bands: Array(32).fill(0.1) };
  renderInferno(steady, base);
  renderInferno(transient, base);
  const steadyOps = renderInferno(
    steady,
    { ...base, timeMs: 1100 },
    params,
    captureEnvironment,
    0.1,
  );
  const transientOps = renderInferno(
    transient,
    { ...base, timeMs: 1100, transient: true },
    params,
    captureEnvironment,
    0.1,
  );
  assert.ok(paintOperations(transientOps).length > paintOperations(steadyOps).length);
  assert.ok(paintOperations(transientOps).length <= INFERNO_MAX_ELEMENTS);
});

check('crest peaks peel off licks while the hearth stays occluded behind the front', () => {
  const visual = INFERNO_VISUAL_DEFINITION.create();
  const loud = {
    ...frame,
    energy: 0.85,
    bands: frame.bands.map((band) => Math.min(1, band + 0.25)),
  };
  renderInferno(visual, loud);
  let ops = [];
  for (let step = 1; step <= 10; step += 1) {
    ops = renderInferno(
      visual,
      { ...loud, timeMs: 1000 + step * 100 },
      params,
      captureEnvironment,
      0.1,
    );
  }
  const fills = flameFills(ops);
  assert.ok(fills.length > 0);
  // A tongue's base is the lowest (max-y) coordinate of its path. With peak-emitted
  // licks plus strict front occlusion, the majority of visible tongues must float at or
  // above the crest zone instead of being rooted on the canvas bottom (QA Pass B).
  const baseYs = fills.map(([, , , , path]) => Math.max(
    ...path
      .filter(([pathOperation]) => pathOperation !== 'closePath')
      .flatMap((entry) => entry.slice(1).filter((_, argIndex) => argIndex % 2 === 1)),
  ));
  const floating = baseYs.filter((baseY) => baseY < canvas.height * 0.9).length;
  assert.ok(floating >= baseYs.length * 0.5);
});

check('synthetic preview evolves deterministically through the shared simulation', () => {
  const first = INFERNO_VISUAL_DEFINITION.create();
  const second = INFERNO_VISUAL_DEFINITION.create();
  const initial = renderInferno(first, frame, params, previewEnvironment);
  renderInferno(second, frame, params, previewEnvironment);
  let firstOps = initial;
  let secondOps = initial;
  for (let index = 1; index <= 8; index += 1) {
    const next = { ...frame, timeMs: 1000 + index * 100 };
    firstOps = renderInferno(first, next, params, previewEnvironment, 0.1);
    secondOps = renderInferno(second, next, params, previewEnvironment, 0.1);
  }
  assert.deepEqual(firstOps, secondOps);
  assert.notDeepEqual(flameFills(firstOps), flameFills(initial));
});

check('High Contrast is the named Void Inferno variant with hard inverted edges', () => {
  assert.equal(resolveInfernoVariant({ highContrast: false }), 'inferno');
  assert.equal(resolveInfernoVariant({ highContrast: true }), 'void-inferno');
  const operations = renderInferno(
    INFERNO_VISUAL_DEFINITION.create(),
    frame,
    { ...params, highContrast: true },
  );
  assert.equal(operations.some(([operation]) => operation === 'createRadialGradient'), false);
  assert.ok(operations.some(([operation, color]) => operation === 'fillStyle' && color === '#030106'));
  assert.ok(operations.some(([operation]) => operation === 'stroke'));
  assert.equal(
    operations.some(([operation, value]) => operation === 'shadowBlur' && value > 0),
    false,
  );
});

check('reduced motion renders one time-independent audio-scaled flame sculpture', () => {
  const visual = INFERNO_VISUAL_DEFINITION.create();
  const reduced = { amplitudeMode: 'preview', reduceMotion: true };
  const first = renderInferno(visual, { ...frame, timeMs: 0 }, params, reduced, 0);
  const second = renderInferno(visual, { ...frame, timeMs: 9000 }, params, reduced, 0.1);
  assert.deepEqual(second, first);
  assert.ok(flameFills(first).length > 0);
  assert.equal(first.some(([operation]) => operation === 'ellipse'), false);
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-inferno-overlay: ${checks} checks passed`);
