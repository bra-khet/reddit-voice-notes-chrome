// v6.0 Phase 3 — Layered Smoke and its consumed bounded plume history contract.
//
//   Run: node scripts/test-layered-smoke-stackable.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-layered-smoke-'));
const outfile = join(outdir, 'layered-smoke.mjs');

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
      "export { normalizeDesignOverrides } from './src/theme/design-overrides.ts';",
      "export { drawThemeBackground } from './src/theme/backgrounds.ts';",
    ].join('\n'),
    loader: 'ts',
    resolveDir: root,
    sourcefile: 'layered-smoke-test-entry.ts',
  },
});

const {
  BOUNDED_PLUME_MAX_NODES,
  BOUNDED_PLUME_MAX_NODES_PER_PLUME,
  BOUNDED_PLUME_MAX_PLUMES,
  BoundedPlumeField,
  CONWAY_LIFE_ID,
  LAYERED_SMOKE_EFFECT_DEFINITION,
  LAYERED_SMOKE_ID,
  LAYERED_SMOKE_LABEL,
  LAYERED_SMOKE_MAX_ELEMENTS,
  LAYERED_SMOKE_MAX_NODES,
  LAYERED_SMOKE_MAX_PLUMES,
  LAYERED_SMOKE_MIN_PLUMES,
  LAYERED_SMOKE_NODES_PER_PLUME,
  RISING_EMBER_ID,
  drawThemeBackground,
  getStackableEffectDefinition,
  isStackableEffectId,
  normalizeDesignOverrides,
  registerCoreStackableEffects,
  resolveLayeredSmokePlumeLimit,
} = await import(pathToFileURL(outfile).href);

const canvas = { width: 640, height: 360 };
const params = {
  sensitivity: 0.72,
  intensity: 0.7,
  smoothing: 0.62,
  color: ['#111827', '#334155', '#64748b', '#a8b5c6', '#e2e8f0'],
  density: 0.72,
  bassWeight: 1,
  midWeight: 1.15,
  trebleWeight: 0.9,
  layoutMode: 'linear',
  highContrast: false,
};
const captureEnvironment = { amplitudeMode: 'capture', reduceMotion: false };
const previewEnvironment = { amplitudeMode: 'preview', reduceMotion: false };
const frame = {
  energy: 0.48,
  bands: Array.from({ length: 32 }, (_, index) => 0.1 + ((index * 17) % 29) / 38),
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
    moveTo(...args) { operations.push(['moveTo', ...args]); },
    lineTo(...args) { operations.push(['lineTo', ...args]); },
    arc(...args) { operations.push(['arc', ...args]); },
    rect(...args) { operations.push(['rect', ...args]); },
    fillRect(...args) { operations.push(['fillRect', state.fillStyle, ...args]); },
    stroke() { operations.push(['stroke', state.strokeStyle, state.lineWidth]); },
    fill() { operations.push(['fill', state.fillStyle]); },
  };
  for (const property of [
    'fillStyle', 'strokeStyle', 'lineWidth', 'globalCompositeOperation',
    'shadowColor', 'shadowBlur',
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
  visual = LAYERED_SMOKE_EFFECT_DEFINITION.create(),
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

function elementOperations(operations) {
  return operations.filter(([operation]) => operation === 'fill' || operation === 'stroke');
}

function fillOperations(operations) {
  return operations.filter(([operation]) => operation === 'fill');
}

function lobeGeometry(operations) {
  return operations.filter(([operation]) => operation === 'arc');
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

console.log('Layered Smoke stackable');

check('the plume field clamps both fixed dimensions and never exceeds 256 nodes', () => {
  const field = new BoundedPlumeField(999, 999, (index) => ({
    index,
    active: false,
    age: 0,
    lifetime: 1,
  }));
  assert.equal(field.plumeCapacity, BOUNDED_PLUME_MAX_PLUMES);
  assert.equal(field.nodesPerPlume, BOUNDED_PLUME_MAX_NODES_PER_PLUME);
  assert.equal(field.nodeCapacity, BOUNDED_PLUME_MAX_NODES);
  assert.equal(field.nodes.length, BOUNDED_PLUME_MAX_NODES);
  assert.equal(field.configurePlumeLimit(3.8), 3);
  assert.equal(field.append(3, () => {}), null);
});

check('each plume recycles only its own oldest slot and exposes newest-first history', () => {
  const field = new BoundedPlumeField(2, 2, (index) => ({
    index,
    marker: 0,
    active: false,
    age: 0,
    lifetime: 1,
  }));
  let marker = 0;
  const append = (plumeIndex) => field.append(plumeIndex, (node) => { node.marker = ++marker; });
  const firstNodes = field.nodes;
  append(0);
  append(0);
  append(1);
  append(0);
  assert.equal(field.nodes, firstNodes);
  assert.equal(field.activeCount, 3);
  assert.deepEqual([field.nodeAt(0, 0)?.marker, field.nodeAt(0, 1)?.marker], [4, 2]);
  assert.equal(field.nodeAt(1, 0)?.marker, 3);
});

check('age expiry and live-limit changes clear nodes without reallocating the field', () => {
  const field = new BoundedPlumeField(3, 3, (index) => ({
    index,
    active: false,
    age: 0,
    lifetime: 1,
  }));
  const nodes = field.nodes;
  field.append(0, (node) => { node.lifetime = 0.1; });
  field.append(2, (node) => { node.lifetime = 1; });
  field.advance(0.11);
  assert.equal(field.activeCount, 1);
  field.configurePlumeLimit(2);
  assert.equal(field.activeCount, 0);
  assert.equal(field.nodes, nodes);
});

check('definition is registered with the stable id, label, and exact paint ceiling', () => {
  registerCoreStackableEffects();
  registerCoreStackableEffects();
  assert.equal(isStackableEffectId(LAYERED_SMOKE_ID), true);
  assert.equal(getStackableEffectDefinition(LAYERED_SMOKE_ID), LAYERED_SMOKE_EFFECT_DEFINITION);
  assert.deepEqual(
    [LAYERED_SMOKE_EFFECT_DEFINITION.id, LAYERED_SMOKE_EFFECT_DEFINITION.label],
    [LAYERED_SMOKE_ID, LAYERED_SMOKE_LABEL],
  );
  assert.equal(LAYERED_SMOKE_MAX_NODES, LAYERED_SMOKE_MAX_PLUMES * LAYERED_SMOKE_NODES_PER_PLUME);
  assert.equal(
    LAYERED_SMOKE_MAX_ELEMENTS,
    LAYERED_SMOKE_MAX_NODES * 3 + LAYERED_SMOKE_MAX_PLUMES,
  );
  assert.equal(LAYERED_SMOKE_EFFECT_DEFINITION.create().getPerformanceCost(), LAYERED_SMOKE_MAX_ELEMENTS);
  assert.deepEqual(
    normalizeDesignOverrides({
      barColor: '#94a3b8',
      stackables: [RISING_EMBER_ID, LAYERED_SMOKE_ID],
    })?.stackables,
    [RISING_EMBER_ID, LAYERED_SMOKE_ID],
  );
});

check('density resolves only the documented 4–10 plume range', () => {
  assert.equal(resolveLayeredSmokePlumeLimit(-1), LAYERED_SMOKE_MIN_PLUMES);
  assert.equal(resolveLayeredSmokePlumeLimit(2), LAYERED_SMOKE_MAX_PLUMES);
  assert.equal(resolveLayeredSmokePlumeLimit(0.5), 7);
});

check('steady voice paints deterministic finite smoke under the hard cap', () => {
  const first = render().operations;
  const second = render().operations;
  assert.deepEqual(first, second);
  assert.equal(numericValuesAreFinite(first), true);
  assert.ok(fillOperations(first).length > 0);
  assert.ok(elementOperations(first).length <= LAYERED_SMOKE_MAX_ELEMENTS);
});

check('capture silence stays empty while synthetic preview demonstrates the effect', () => {
  const silence = { ...frame, energy: 0, bands: Array(32).fill(0), transient: false };
  const capture = render(undefined, silence, params, captureEnvironment).operations;
  const preview = render(undefined, silence, params, previewEnvironment).operations;
  assert.equal(elementOperations(capture).length, 0);
  assert.ok(fillOperations(preview).length > 0);
});

check('a transient immediately sheds additional bounded wisps', () => {
  const steady = render().operations;
  const transient = render(undefined, { ...frame, transient: true }).operations;
  assert.ok(fillOperations(transient).length > fillOperations(steady).length);
  assert.ok(elementOperations(transient).length <= LAYERED_SMOKE_MAX_ELEMENTS);
});

check('mid-band weighting changes plume curl and volume geometry', () => {
  const midFrame = {
    ...frame,
    energy: 0.1,
    bands: Array.from({ length: 32 }, (_, index) => index >= 10 && index < 22 ? 0.95 : 0.02),
  };
  const muted = render(undefined, midFrame, { ...params, midWeight: 0 }).operations;
  const lifted = render(undefined, midFrame, { ...params, midWeight: 2 }).operations;
  assert.notDeepEqual(muted, lifted);
  assert.equal(numericValuesAreFinite(lifted), true);
});

check('bounded time advancement moves existing smoke without changing its allocation cap', () => {
  const visual = LAYERED_SMOKE_EFFECT_DEFINITION.create();
  const initial = render(visual, frame, params, captureEnvironment, 0).operations;
  const advanced = render(
    visual,
    { ...frame, timeMs: 1100 },
    params,
    captureEnvironment,
    0.1,
  ).operations;
  assert.notDeepEqual(initial, advanced);
  assert.ok(elementOperations(advanced).length <= LAYERED_SMOKE_MAX_ELEMENTS);
});

check('linear smoke bank, centered chimney, and radial wreath are distinct projections', () => {
  const linear = lobeGeometry(render().operations);
  const centered = lobeGeometry(render(
    undefined,
    frame,
    { ...params, layoutMode: 'centered' },
  ).operations);
  const radial = lobeGeometry(render(
    undefined,
    frame,
    { ...params, layoutMode: 'radial' },
  ).operations);
  assert.notDeepEqual(linear, centered);
  assert.notDeepEqual(centered, radial);
});

check('the live theme seam composes smoke last in a real bounded three-stack', () => {
  const ctx = createContext();
  drawThemeBackground(
    ctx,
    canvas,
    {
      id: 'layered-smoke-stack-test',
      name: 'Layered Smoke stack test',
      bars: { width: 8, spacing: 4, cornerRadius: 2, glow: 4 },
      colors: { bar: '#cbd5e1', glow: '#94a3b8', bg: '#070b12' },
      background: { type: 'solid', value: '#070b12' },
      designEffects: { stackables: [RISING_EMBER_ID, CONWAY_LIFE_ID, LAYERED_SMOKE_ID] },
    },
    null,
    frame,
    null,
    undefined,
    captureEnvironment,
  );
  const backgroundIndex = ctx.operations.findIndex(([operation]) => operation === 'fillRect');
  const lastFillIndex = ctx.operations.findLastIndex(([operation]) => operation === 'fill');
  assert.ok(backgroundIndex >= 0);
  assert.ok(lastFillIndex > backgroundIndex);
});

check('High Contrast uses crisp source-over lobes without blur or additive compositing', () => {
  const operations = render(
    undefined,
    frame,
    { ...params, highContrast: true },
  ).operations;
  assert.equal(
    operations.some(([operation, value]) => operation === 'globalCompositeOperation' && value !== 'source-over'),
    false,
  );
  assert.equal(
    operations.some(([operation, value]) => operation === 'shadowBlur' && value > 0),
    false,
  );
  assert.ok(operations.some(([operation, value]) => operation === 'shadowColor' && value === 'transparent'));
});

check('reduced motion is a fixed time-independent smoke sculpture', () => {
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
  assert.ok(elementOperations(first).length <= LAYERED_SMOKE_MAX_ELEMENTS);
});

check('180 capture frames remain finite and bounded without growing plume state', () => {
  const visual = LAYERED_SMOKE_EFFECT_DEFINITION.create();
  for (let index = 0; index < 180; index += 1) {
    const operations = render(
      visual,
      { ...frame, timeMs: 1000 + index * 100, transient: index % 17 === 0 },
      params,
      captureEnvironment,
      0.1,
    ).operations;
    assert.ok(elementOperations(operations).length <= LAYERED_SMOKE_MAX_ELEMENTS);
    assert.equal(numericValuesAreFinite(operations), true);
  }
});

console.log(`\n${checks}/${checks} checks passed.`);
rmSync(outdir, { recursive: true, force: true });
