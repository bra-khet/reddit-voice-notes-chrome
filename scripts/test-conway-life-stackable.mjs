// v6.0 Phase 3 — Conway Life and its consumed bounded B3/S23 lattice.
//
//   Run: node scripts/test-conway-life-stackable.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-conway-life-'));
const outfile = join(outdir, 'conway-life.mjs');

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
      "export * from './src/theme/audio-reactive/stackables/index.ts';",
      "export { drawThemeBackground } from './src/theme/backgrounds.ts';",
      "export { normalizeDesignOverrides } from './src/theme/design-overrides.ts';",
    ].join('\n'),
    loader: 'ts',
    resolveDir: root,
    sourcefile: 'conway-life-test-entry.ts',
  },
});

const {
  BOUNDED_LIFE_GRID_MAX_CELLS,
  BOUNDED_LIFE_GRID_MAX_DIMENSION,
  BoundedLifeGrid,
  CONWAY_LIFE_COLUMNS,
  CONWAY_LIFE_EFFECT_DEFINITION,
  CONWAY_LIFE_ID,
  CONWAY_LIFE_LABEL,
  CONWAY_LIFE_MAX_CELLS,
  CONWAY_LIFE_MAX_ELEMENTS,
  CONWAY_LIFE_ROWS,
  ELECTRIC_ARC_ID,
  RISING_EMBER_ID,
  drawThemeBackground,
  getStackableEffectDefinition,
  isStackableEffectId,
  normalizeDesignOverrides,
  registerCoreStackableEffects,
  resolveConwayTickSeconds,
} = await import(pathToFileURL(outfile).href);

const canvas = { width: 640, height: 360 };
const params = {
  sensitivity: 0.72,
  intensity: 0.68,
  smoothing: 0.46,
  color: ['#173b6c', '#2a788e', '#22a884', '#7ad151', '#fde725'],
  density: 0.72,
  bassWeight: 1,
  midWeight: 1.1,
  trebleWeight: 1.15,
  layoutMode: 'linear',
  highContrast: false,
};
const captureEnvironment = { amplitudeMode: 'capture', reduceMotion: false };
const previewEnvironment = { amplitudeMode: 'preview', reduceMotion: false };
const frame = {
  energy: 0.48,
  bands: Array.from({ length: 32 }, (_, index) => 0.12 + ((index * 17) % 28) / 36),
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
    // The stack seam runs the real Rising Ember effect, whose taper trail needs these.
    quadraticCurveTo(...args) { operations.push(['quadraticCurveTo', ...args]); },
    createLinearGradient(...args) {
      operations.push(['createLinearGradient', ...args]);
      return { addColorStop() {} };
    },
    moveTo(...args) { operations.push(['moveTo', ...args]); },
    lineTo(...args) { operations.push(['lineTo', ...args]); },
    arc(...args) { operations.push(['arc', ...args]); },
    rect(...args) { operations.push(['rect', ...args]); },
    fillRect(...args) { operations.push(['fillRect', state.fillStyle, ...args]); },
    stroke() { operations.push(['stroke', state.strokeStyle, state.lineWidth]); },
    fill() { operations.push(['fill', state.fillStyle]); },
    clearRect(...args) { operations.push(['clearRect', ...args]); },
    drawImage(...args) { operations.push(['drawImage', ...args.slice(1)]); },
  };
  for (const property of [
    'fillStyle', 'strokeStyle', 'lineWidth', 'globalCompositeOperation',
    'shadowColor', 'shadowBlur', 'globalAlpha', 'filter',
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

function render(
  visual = CONWAY_LIFE_EFFECT_DEFINITION.create(),
  inputFrame = frame,
  inputParams = params,
  environment = captureEnvironment,
  dt,
) {
  const ctx = createContext();
  if (dt !== undefined) visual.update(inputFrame, dt);
  visual.render(ctx, canvas, inputFrame, inputParams, environment);
  return { visual, operations: ctx.operations };
}

function paintOperations(operations) {
  return operations.filter(([operation]) => operation === 'fillRect' || operation === 'stroke');
}

function cellOperations(operations) {
  return operations.filter(([operation]) => operation === 'fillRect');
}

function numericValuesAreFinite(operations) {
  return operations.flat(Infinity)
    .filter((value) => typeof value === 'number')
    .every(Number.isFinite);
}

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

console.log('Conway Life stackable');

check('the lattice clamps dimensions and keeps topology inside fixed buffers', () => {
  const grid = new BoundedLifeGrid(999, 999);
  assert.equal(grid.capacityColumns, BOUNDED_LIFE_GRID_MAX_DIMENSION);
  assert.equal(grid.capacityRows, BOUNDED_LIFE_GRID_MAX_DIMENSION);
  assert.equal(grid.capacity, BOUNDED_LIFE_GRID_MAX_CELLS);
  assert.deepEqual([grid.columns, grid.rows, grid.countAlive()], [64, 64, 0]);
  assert.equal(grid.setAlive(64, 0), false);
  assert.equal(grid.setAlive(-1, 0), false);
});

check('B3/S23 preserves a block and oscillates a blinker', () => {
  const block = new BoundedLifeGrid(6, 6);
  [[2, 2], [3, 2], [2, 3], [3, 3]].forEach(([column, row]) => block.setAlive(column, row));
  assert.equal(block.step(), 4);
  assert.equal(block.generation, 1);
  assert.deepEqual(
    [[2, 2], [3, 2], [2, 3], [3, 3]].map(([column, row]) => block.isAlive(column, row)),
    [true, true, true, true],
  );

  const blinker = new BoundedLifeGrid(6, 6);
  [[2, 1], [2, 2], [2, 3]].forEach(([column, row]) => blinker.setAlive(column, row));
  assert.equal(blinker.step(), 3);
  assert.deepEqual(
    [[1, 2], [2, 2], [3, 2]].map(([column, row]) => blinker.isAlive(column, row)),
    [true, true, true],
  );
});

check('dead edges do not wrap into a torus', () => {
  const grid = new BoundedLifeGrid(6, 6);
  [[0, 0], [0, 1], [0, 2]].forEach(([column, row]) => grid.setAlive(column, row));
  grid.step();
  assert.equal(grid.isAlive(5, 1), false);
  assert.equal(grid.isAlive(0, 1), true);
  assert.equal(grid.isAlive(1, 1), true);
});

check('definition is a normalized registered stackable with the exact 48x16 cost ceiling', () => {
  registerCoreStackableEffects();
  registerCoreStackableEffects();
  assert.equal(isStackableEffectId(CONWAY_LIFE_ID), true);
  assert.equal(getStackableEffectDefinition(CONWAY_LIFE_ID), CONWAY_LIFE_EFFECT_DEFINITION);
  assert.deepEqual(
    [CONWAY_LIFE_EFFECT_DEFINITION.id, CONWAY_LIFE_EFFECT_DEFINITION.label],
    [CONWAY_LIFE_ID, CONWAY_LIFE_LABEL],
  );
  assert.equal(CONWAY_LIFE_MAX_CELLS, CONWAY_LIFE_COLUMNS * CONWAY_LIFE_ROWS);
  assert.equal(CONWAY_LIFE_MAX_ELEMENTS, CONWAY_LIFE_MAX_CELLS + 1);
  assert.equal(CONWAY_LIFE_EFFECT_DEFINITION.create().getPerformanceCost(), CONWAY_LIFE_MAX_ELEMENTS);
  assert.deepEqual(
    normalizeDesignOverrides({ barColor: '#22a884', stackables: [RISING_EMBER_ID, CONWAY_LIFE_ID] })?.stackables,
    [RISING_EMBER_ID, CONWAY_LIFE_ID],
  );
});

check('generation cadence is finite, smoothed, and independently capped', () => {
  assert.equal(resolveConwayTickSeconds(-1), 0.08);
  assert.ok(Math.abs(resolveConwayTickSeconds(2) - 0.22) < 1e-9);
  assert.ok(resolveConwayTickSeconds(0.5) > resolveConwayTickSeconds(0));
});

check('steady voice paints a deterministic finite living field under the hard cap', () => {
  const first = render().operations;
  const second = render().operations;
  assert.deepEqual(first, second);
  assert.equal(numericValuesAreFinite(first), true);
  assert.ok(cellOperations(first).length > 0);
  assert.ok(paintOperations(first).length <= CONWAY_LIFE_MAX_ELEMENTS);
});

check('capture silence stays empty while synthetic preview demonstrates Life', () => {
  const silence = { ...frame, energy: 0, bands: Array(32).fill(0), transient: false };
  const capture = render(undefined, silence, params, captureEnvironment).operations;
  const preview = render(undefined, silence, params, previewEnvironment).operations;
  assert.equal(paintOperations(capture).length, 0);
  assert.ok(cellOperations(preview).length > 0);
});

check('a transient immediately stamps additional bounded organisms', () => {
  const steady = render().operations;
  const transient = render(undefined, { ...frame, transient: true }).operations;
  assert.ok(cellOperations(transient).length > cellOperations(steady).length);
  assert.ok(paintOperations(transient).length <= CONWAY_LIFE_MAX_ELEMENTS);
});

check('treble weighting changes population seeding and cellular geometry', () => {
  const trebleFrame = {
    ...frame,
    energy: 0.1,
    bands: Array.from({ length: 32 }, (_, index) => index >= 22 ? 0.95 : 0.02),
  };
  const muted = render(undefined, trebleFrame, { ...params, trebleWeight: 0 }).operations;
  const lifted = render(undefined, trebleFrame, { ...params, trebleWeight: 2 }).operations;
  assert.notDeepEqual(muted, lifted);
  assert.ok(cellOperations(lifted).length >= cellOperations(muted).length);
});

check('the fixed cadence holds a generation between ticks and advances after its interval', () => {
  const visual = CONWAY_LIFE_EFFECT_DEFINITION.create();
  const initial = render(visual, frame, { ...params, smoothing: 0 }, captureEnvironment, 0).operations;
  const held = render(
    visual,
    { ...frame, timeMs: 1040 },
    { ...params, smoothing: 0 },
    captureEnvironment,
    0.04,
  ).operations;
  const advanced = render(
    visual,
    { ...frame, timeMs: 1100 },
    { ...params, smoothing: 0 },
    captureEnvironment,
    0.06,
  ).operations;
  assert.deepEqual(initial, held);
  assert.notDeepEqual(held, advanced);
});

check('linear tapestry, centered terrarium, and radial colony are distinct projections', () => {
  const linear = cellOperations(render().operations);
  const centered = cellOperations(render(
    undefined,
    frame,
    { ...params, layoutMode: 'centered' },
  ).operations);
  const radial = cellOperations(render(
    undefined,
    frame,
    { ...params, layoutMode: 'radial' },
  ).operations);
  assert.notDeepEqual(linear, centered);
  assert.notDeepEqual(centered, radial);
});

check('the live theme seam composes Conway in a real bounded three-stack', () => {
  const ctx = createContext();
  drawThemeBackground(
    ctx,
    canvas,
    {
      id: 'conway-stack-test',
      name: 'Conway stack test',
      bars: { width: 8, spacing: 4, cornerRadius: 2, glow: 4 },
      colors: { bar: '#7ad151', glow: '#22a884', bg: '#07131d' },
      background: { type: 'solid', value: '#07131d' },
      designEffects: { stackables: [RISING_EMBER_ID, ELECTRIC_ARC_ID, CONWAY_LIFE_ID] },
    },
    null,
    frame,
    null,
    undefined,
    captureEnvironment,
  );
  const backgroundIndex = ctx.operations.findIndex(([operation]) => operation === 'fillRect');
  const lifeIndex = ctx.operations.findIndex(
    ([operation, , , , width, height]) => operation === 'fillRect' && width < 20 && height < 30,
  );
  assert.ok(backgroundIndex >= 0);
  assert.ok(lifeIndex > backgroundIndex);
});

check('High Contrast removes additive compositing and cellular blur', () => {
  const operations = render(
    undefined,
    frame,
    { ...params, highContrast: true },
  ).operations;
  assert.equal(
    operations.some(([operation, value]) => operation === 'globalCompositeOperation' && value === 'lighter'),
    false,
  );
  assert.equal(
    operations.some(([operation, value]) => operation === 'shadowBlur' && value > 0),
    false,
  );
  assert.ok(operations.some(([operation, value]) => operation === 'shadowColor' && value === 'transparent'));
});

check('reduced motion is a fixed time-independent cellular constellation', () => {
  const reduced = { amplitudeMode: 'preview', reduceMotion: true };
  const first = render(
    undefined,
    { ...frame, timeMs: 1000 },
    params,
    reduced,
    0.1,
  ).operations;
  const second = render(
    undefined,
    { ...frame, timeMs: 9000 },
    params,
    reduced,
    0.1,
  ).operations;
  assert.deepEqual(first, second);
  assert.ok(paintOperations(first).length <= CONWAY_LIFE_MAX_ELEMENTS);
});

check('180 frames of generations stay finite and bounded without growing state', () => {
  const visual = CONWAY_LIFE_EFFECT_DEFINITION.create();
  for (let index = 0; index < 180; index += 1) {
    const operations = render(
      visual,
      { ...frame, timeMs: 1000 + index * 100, transient: index % 19 === 0 },
      params,
      captureEnvironment,
      0.1,
    ).operations;
    assert.ok(paintOperations(operations).length <= CONWAY_LIFE_MAX_ELEMENTS);
    assert.equal(numericValuesAreFinite(operations), true);
  }
});

console.log(`\n${checks}/${checks} checks passed.`);
rmSync(outdir, { recursive: true, force: true });
