// v6.0 Phase 3 — consumed simulation backbone + registry-native Forest Spirits.
//
//   Run: node scripts/test-forest-spirits-overlay.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-forest-spirits-'));
const outfile = join(outdir, 'forest-spirits.mjs');

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
    sourcefile: 'forest-spirits-test-entry.ts',
  },
});

const {
  AudioReactiveSimulation,
  DEFAULT_SPATIAL_PARTITION_CELL_SIZE,
  FOREST_SPIRITS_CHAIN_COUNT,
  FOREST_SPIRITS_ID,
  FOREST_SPIRITS_MAX_AGENTS,
  FOREST_SPIRITS_MAX_ELEMENTS,
  FOREST_SPIRITS_MIN_AGENTS,
  FOREST_SPIRITS_VISUAL_DEFINITION,
  ReactiveAgentPool,
  SpatialPartition,
  getAudioVisualDefinition,
  registerCoreOverlayVisuals,
  resolveForestSpiritsAgentCount,
  sampleLayeredVectorFlowField,
} = await import(pathToFileURL(outfile).href);

const canvas = { width: 640, height: 360 };
const params = {
  sensitivity: 0.68,
  intensity: 0.62,
  smoothing: 0.7,
  color: ['#2a788e', '#22a884', '#7ad151', '#fde725'],
  density: 1,
  highContrast: false,
};
const captureEnvironment = { amplitudeMode: 'capture', reduceMotion: false };
const frame = {
  energy: 0.34,
  bands: Array.from({ length: 32 }, (_, index) => ((index * 13) % 31) / 31),
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
  let path = [];
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
    beginPath() { path = []; operations.push(['beginPath']); },
    moveTo(x, y) { path.push(['moveTo', x, y]); operations.push(['moveTo', x, y]); },
    lineTo(x, y) { path.push(['lineTo', x, y]); operations.push(['lineTo', x, y]); },
    closePath() { path.push(['closePath']); operations.push(['closePath']); },
    quadraticCurveTo(cx, cy, x, y) {
      path.push(['quadraticCurveTo', cx, cy, x, y]);
      operations.push(['quadraticCurveTo', cx, cy, x, y]);
    },
    arc(...args) { path.push(['arc', ...args]); operations.push(['arc', ...args]); },
    fill() {
      operations.push([
        'fill',
        state.fillStyle?.__gradient
          ? { gradient: state.fillStyle.args, stops: state.fillStyle.stops.map((stop) => [...stop]) }
          : state.fillStyle,
        path.map((entry) => [...entry]),
      ]);
    },
    stroke() {
      operations.push([
        'stroke', state.strokeStyle, state.lineWidth, state.shadowBlur, state.shadowColor,
        path.map((entry) => [...entry]),
      ]);
    },
    createRadialGradient(...args) {
      operations.push(['createRadialGradient', ...args]);
      return createGradient(args);
    },
  };
  for (const property of [
    'fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin',
    'shadowBlur', 'shadowColor', 'globalAlpha', 'globalCompositeOperation',
  ]) {
    Object.defineProperty(ctx, property, {
      get() { return state[property]; },
      set(value) { state[property] = value; operations.push([property, value?.__gradient ? 'gradient' : value]); },
    });
  }
  return ctx;
}

function renderForest(
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

function countCoreFilaments(operations) {
  return operations.filter(
    ([operation, , width]) => operation === 'stroke' && width >= 1.05 && width <= 1.8,
  ).length;
}

function arcRadiusSum(operations) {
  return operations
    .filter(([operation]) => operation === 'arc')
    .reduce((sum, [, , , radius]) => sum + radius, 0);
}

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

console.log('Forest Spirits overlay + simulation backbone');

check('definition is registered, balanced, audio-aware, and hard-capped', () => {
  assert.deepEqual(
    [
      FOREST_SPIRITS_VISUAL_DEFINITION.id,
      FOREST_SPIRITS_VISUAL_DEFINITION.label,
      FOREST_SPIRITS_VISUAL_DEFINITION.family,
      FOREST_SPIRITS_VISUAL_DEFINITION.maxElements,
    ],
    [FOREST_SPIRITS_ID, 'Forest Spirits', 'chaining-boids', FOREST_SPIRITS_MAX_ELEMENTS],
  );
  assert.equal(FOREST_SPIRITS_VISUAL_DEFINITION.wants.bands, true);
  assert.equal(FOREST_SPIRITS_MAX_ELEMENTS, 192);
  registerCoreOverlayVisuals();
  registerCoreOverlayVisuals();
  assert.equal(getAudioVisualDefinition('overlay', FOREST_SPIRITS_ID), FOREST_SPIRITS_VISUAL_DEFINITION);
});

check('density always resolves three balanced chains inside the 18–48 agent cap', () => {
  assert.equal(resolveForestSpiritsAgentCount(-2), FOREST_SPIRITS_MIN_AGENTS);
  assert.equal(resolveForestSpiritsAgentCount(2), FOREST_SPIRITS_MAX_AGENTS);
  for (const density of [0, 0.15, 0.5, 0.82, 1]) {
    const count = resolveForestSpiritsAgentCount(density);
    assert.equal(count % FOREST_SPIRITS_CHAIN_COUNT, 0);
    assert.ok(count >= FOREST_SPIRITS_MIN_AGENTS && count <= FOREST_SPIRITS_MAX_AGENTS);
  }
});

check('SpatialPartition performs exact local queries with a reusable result buffer', () => {
  const partition = new SpatialPartition(0);
  assert.equal(partition.cellSize, DEFAULT_SPATIAL_PARTITION_CELL_SIZE);
  const near = { id: 'near', x: 10, y: 10 };
  const edge = { id: 'edge', x: 30, y: 10 };
  const far = { id: 'far', x: 120, y: 90 };
  assert.equal(partition.insert(near), true);
  assert.equal(partition.insert(edge), true);
  assert.equal(partition.insert(far), true);
  assert.equal(partition.insert({ id: 'invalid', x: Infinity, y: 0 }), false);
  const scratch = [far];
  assert.equal(partition.queryNeighbors(10, 10, 20, scratch), scratch);
  assert.deepEqual(scratch.map(({ id }) => id), ['near', 'edge']);
  assert.ok(partition.occupiedCellCount > 0);
  partition.clear();
  assert.equal(partition.occupiedCellCount, 0);
  assert.deepEqual(partition.queryNeighbors(10, 10, 100, scratch), []);
});

check('ReactiveAgentPool preallocates once and reuses identities across density changes', () => {
  const activations = [];
  const pool = new ReactiveAgentPool(3, (index) => ({
    index, active: false, x: 0, y: 0, vx: 0, vy: 0,
  }));
  const identities = [...pool.agents];
  assert.equal(pool.setActiveCount(9, (agent) => activations.push(agent.index)), 3);
  assert.equal(pool.setActiveCount(1), 1);
  assert.equal(pool.agents[2].active, false);
  assert.equal(pool.setActiveCount(3, (agent) => activations.push(agent.index)), 3);
  assert.deepEqual(pool.agents, identities);
  assert.deepEqual(activations, [0, 1, 2, 1, 2]);
});

check('AudioReactiveSimulation owns the consumed pool-to-grid neighbor lifecycle', () => {
  const simulation = new AudioReactiveSimulation({
    capacity: 3,
    createAgent: (index) => ({ index, active: false, x: 0, y: 0, vx: 0, vy: 0 }),
  });
  simulation.setActiveCount(3, (agent, index) => {
    agent.x = index * 20;
    agent.y = 0;
  });
  simulation.rebuildSpatialIndex();
  const scratch = [];
  const middle = simulation.pool.at(1);
  assert.ok(middle);
  assert.deepEqual(
    simulation.queryNeighbors(middle, 20, scratch).map(({ index }) => index),
    [0, 1, 2],
  );
});

check('vector flow is deterministic, finite, normalized, and caller-buffered', () => {
  const target = { x: 99, y: 99 };
  const first = sampleLayeredVectorFlowField(
    0.2, -0.7, 1.25, { complexity: 0.7, speed: 0.8, seed: 42 }, target,
  );
  assert.equal(first, target);
  assert.ok(Number.isFinite(first.x) && Number.isFinite(first.y));
  assert.ok(Math.abs(Math.hypot(first.x, first.y) - 1) < 1e-9);
  const second = sampleLayeredVectorFlowField(
    0.2, -0.7, 1.25, { complexity: 0.7, speed: 0.8, seed: 42 }, { x: 0, y: 0 },
  );
  assert.deepEqual(first, second);
  assert.notDeepEqual(
    first,
    sampleLayeredVectorFlowField(0.2, -0.7, 2.25, { complexity: 0.7, speed: 0.8, seed: 42 }),
  );
});

check('two instances produce deterministic bounded geometry at maximum density', () => {
  const first = FOREST_SPIRITS_VISUAL_DEFINITION.create();
  const second = FOREST_SPIRITS_VISUAL_DEFINITION.create();
  renderForest(first, frame, params, captureEnvironment, 0);
  renderForest(second, frame, params, captureEnvironment, 0);
  const later = { ...frame, timeMs: 1100 };
  const firstOps = renderForest(first, later, params, captureEnvironment, 0.1);
  const secondOps = renderForest(second, later, params, captureEnvironment, 0.1);
  assert.deepEqual(firstOps, secondOps);
  const coordinateOps = firstOps.filter(([operation]) =>
    operation === 'moveTo' || operation === 'quadraticCurveTo' || operation === 'arc');
  assert.ok(coordinateOps.length > FOREST_SPIRITS_MAX_AGENTS);
  assert.ok(coordinateOps.flat().filter((value) => typeof value === 'number').every(Number.isFinite));
  // Every puff dot now carries one soft-falloff gradient core, bounded by the agent cap.
  assert.ok(
    firstOps.filter(([operation]) => operation === 'createRadialGradient').length
      <= FOREST_SPIRITS_MAX_AGENTS,
  );
});

check('voice energy changes spirit light scale while the agent ceiling stays fixed', () => {
  const quiet = { ...frame, energy: 0, bands: Array(32).fill(0) };
  const loud = { ...frame, energy: 1, bands: Array(32).fill(1) };
  const quietOps = renderForest(FOREST_SPIRITS_VISUAL_DEFINITION.create(), quiet);
  const loudOps = renderForest(FOREST_SPIRITS_VISUAL_DEFINITION.create(), loud);
  assert.ok(arcRadiusSum(loudOps) > arcRadiusSum(quietOps));
  assert.equal(
    quietOps.filter(([operation]) => operation === 'arc').length,
    loudOps.filter(([operation]) => operation === 'arc').length,
  );
});

check('transients fracture filaments and bounded decay reforms every chain', () => {
  const visual = FOREST_SPIRITS_VISUAL_DEFINITION.create();
  const baseline = renderForest(visual, frame, params, captureEnvironment, 0);
  const fractured = renderForest(
    visual,
    { ...frame, timeMs: 1100, transient: true },
    params,
    captureEnvironment,
    0.1,
  );
  let reformed = fractured;
  for (let index = 0; index < 24; index += 1) {
    reformed = renderForest(
      visual,
      { ...frame, timeMs: 1200 + index * 100, transient: false },
      params,
      captureEnvironment,
      0.1,
    );
  }
  assert.ok(countCoreFilaments(fractured) < countCoreFilaments(baseline));
  assert.equal(countCoreFilaments(reformed), countCoreFilaments(baseline));
});

check('High Contrast removes gradient haze and retains a solid structural trace', () => {
  const operations = renderForest(
    FOREST_SPIRITS_VISUAL_DEFINITION.create(),
    frame,
    { ...params, highContrast: true },
  );
  assert.equal(operations.some(([operation]) => operation === 'createRadialGradient'), false);
  assert.equal(
    operations.some(([operation, , , shadowBlur]) => operation === 'stroke' && shadowBlur > 0),
    false,
  );
  assert.ok(operations.some(([operation, , width]) => operation === 'stroke' && width === 2.35));
});

check('reduced motion freezes both simulation and filament phase', () => {
  const visual = FOREST_SPIRITS_VISUAL_DEFINITION.create();
  const reduced = { amplitudeMode: 'preview', reduceMotion: true };
  const first = renderForest(visual, { ...frame, timeMs: 0 }, params, reduced, 0);
  const second = renderForest(visual, { ...frame, timeMs: 9000 }, params, reduced, 0.1);
  assert.deepEqual(second, first);
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-forest-spirits-overlay: ${checks} checks passed`);
