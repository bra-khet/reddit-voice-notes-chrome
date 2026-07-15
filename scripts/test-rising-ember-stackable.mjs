// v6.0 Phase 3 — Rising Ember and the first bounded ordered stackable contract.
//
//   Run: node scripts/test-rising-ember-stackable.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-rising-ember-'));
const outfile = join(outdir, 'rising-ember.mjs');

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
    ].join('\n'),
    loader: 'ts',
    resolveDir: root,
    sourcefile: 'rising-ember-test-entry.ts',
  },
});

// BUG FIX: Built-in Neon Glow fixture collision
// Fix: Import the real Neon definition and bounded-cost metadata instead of registering a colliding stub.
// Sync: Fake canvas contract and ordered runtime fixture below
const {
  MAX_STACKABLE_EFFECTS,
  LAYERED_SMOKE_EFFECT_DEFINITION,
  LAYERED_SMOKE_NODES_PER_PLUME,
  NEON_GLOW_EFFECT_DEFINITION,
  NEON_GLOW_PULSES_PER_TUBE,
  NEON_GLOW_POINTS_PER_TUBE,
  RISING_EMBER_EFFECT_DEFINITION,
  RISING_EMBER_ID,
  RISING_EMBER_LABEL,
  RISING_EMBER_MAX_ELEMENTS,
  RISING_EMBER_MAX_PARTICLES,
  RISING_EMBER_MIN_PARTICLES,
  drawThemeBackground,
  getStackableEffectDefinition,
  registerCoreStackableEffects,
  registerStackableEffect,
  renderStackableEffectsForCanvas,
  resolveLayeredSmokePlumeLimit,
  resolveNeonGlowTubeLimit,
  resolveRisingEmberParticleLimit,
} = await import(pathToFileURL(outfile).href);

const canvas = { width: 640, height: 360 };
const params = {
  sensitivity: 0.7,
  intensity: 0.74,
  smoothing: 0.55,
  color: ['#ff5a1f', '#ffad24', '#ffe6a7'],
  density: 1,
  bassWeight: 0.9,
  midWeight: 1,
  trebleWeight: 1.2,
  layoutMode: 'linear',
  highContrast: false,
};
const captureEnvironment = { amplitudeMode: 'capture', reduceMotion: false };
const previewEnvironment = { amplitudeMode: 'preview', reduceMotion: false };
const frame = {
  energy: 0.46,
  bands: Array.from({ length: 32 }, (_, index) => 0.16 + ((index * 13) % 25) / 34),
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
    // BUG FIX: Built-in Neon Glow fixture collision
    // Fix: Extend the fake canvas with the curved-path calls used by the real Neon fixture.
    // Sync: Real-definition imports and ordered runtime fixture in this script
    closePath() { operations.push(['closePath']); },
    moveTo(...args) { operations.push(['moveTo', ...args]); },
    lineTo(...args) { operations.push(['lineTo', ...args]); },
    quadraticCurveTo(...args) { operations.push(['quadraticCurveTo', ...args]); },
    arc(...args) { operations.push(['arc', ...args]); },
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

function renderEmber(
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
  return operations.filter(([operation]) => operation === 'stroke' || operation === 'fill');
}

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

console.log('Rising Ember stackable');

check('definition is registered with a stable label, cap, and bounded cost', () => {
  registerCoreStackableEffects();
  registerCoreStackableEffects();
  assert.equal(getStackableEffectDefinition(RISING_EMBER_ID), RISING_EMBER_EFFECT_DEFINITION);
  assert.deepEqual(
    [RISING_EMBER_EFFECT_DEFINITION.id, RISING_EMBER_EFFECT_DEFINITION.label],
    [RISING_EMBER_ID, RISING_EMBER_LABEL],
  );
  assert.equal(RISING_EMBER_MAX_ELEMENTS, RISING_EMBER_MAX_PARTICLES * 3);
  const visual = RISING_EMBER_EFFECT_DEFINITION.create();
  renderEmber(visual);
  assert.equal(visual.getPerformanceCost(), RISING_EMBER_MAX_ELEMENTS);
});

check('density resolves only the documented 16–44 particle range', () => {
  assert.equal(resolveRisingEmberParticleLimit(-1), RISING_EMBER_MIN_PARTICLES);
  assert.equal(resolveRisingEmberParticleLimit(2), RISING_EMBER_MAX_PARTICLES);
  assert.equal(resolveRisingEmberParticleLimit(0.5), 30);
});

check('the runtime preserves saved order, deduplicates, caps at three, and sums cost', () => {
  const renderOrder = [];
  // BUG FIX: Built-in Neon Glow fixture collision
  // Fix: Stub only Particle Burst and use real Smoke plus Neon Glow for the remaining bounded effects.
  // Sync: Real-definition imports and fake canvas contract above
  const unregister = ['particle-burst'].map((id, index) => (
    registerStackableEffect({
      id,
      label: id,
      maxElements: index + 1,
      create: () => ({
        id,
        render() { renderOrder.push(id); },
        getPerformanceCost() { return index + 1; },
      }),
    })
  ));
  const cost = renderStackableEffectsForCanvas(
    ['smoke', 'particle-burst', 'smoke', 'neon-glow', RISING_EMBER_ID],
    createContext(),
    { width: 320, height: 180 },
    frame,
  );
  assert.deepEqual(renderOrder, ['particle-burst']);
  const smokeCost = resolveLayeredSmokePlumeLimit(
    LAYERED_SMOKE_EFFECT_DEFINITION.defaultParams.density,
  ) * (LAYERED_SMOKE_NODES_PER_PLUME * 3 + 1);
  const neonCost = resolveNeonGlowTubeLimit(
    NEON_GLOW_EFFECT_DEFINITION.defaultParams.density,
  ) * (3 + NEON_GLOW_PULSES_PER_TUBE * 2);
  assert.equal(NEON_GLOW_POINTS_PER_TUBE, 18);
  assert.equal(cost, smokeCost + 1 + neonCost);
  assert.equal(MAX_STACKABLE_EFFECTS, 3);
  unregister.forEach((remove) => remove());
});

check('the theme seam renders Ember without requiring a primary overlay', () => {
  const ctx = createContext();
  drawThemeBackground(
    ctx,
    canvas,
    {
      id: 'stackable-test',
      name: 'Stackable test',
      bars: { width: 8, spacing: 4, cornerRadius: 2, glow: 4 },
      colors: { bar: '#ff9f1c', glow: '#ffd166', bg: '#120602' },
      background: { type: 'solid', value: '#120602' },
      designEffects: { stackables: [RISING_EMBER_ID] },
    },
    null,
    frame,
    null,
    undefined,
    captureEnvironment,
  );
  const backgroundIndex = ctx.operations.findIndex(([operation]) => operation === 'fillRect');
  const emberIndex = ctx.operations.findIndex(([operation]) => operation === 'stroke');
  assert.ok(backgroundIndex >= 0);
  assert.ok(emberIndex > backgroundIndex);
});

check('steady voice paints deterministic finite cinders under the element cap', () => {
  const first = renderEmber(RISING_EMBER_EFFECT_DEFINITION.create());
  const second = renderEmber(RISING_EMBER_EFFECT_DEFINITION.create());
  assert.deepEqual(first, second);
  assert.ok(first.flat(Infinity).filter((value) => typeof value === 'number').every(Number.isFinite));
  assert.ok(elementOperations(first).length > 0);
  assert.ok(elementOperations(first).length <= RISING_EMBER_MAX_ELEMENTS);
});

check('capture silence stays empty while synthetic preview remains gently alive', () => {
  const silence = { ...frame, energy: 0, bands: Array(32).fill(0), transient: false };
  const capture = renderEmber(
    RISING_EMBER_EFFECT_DEFINITION.create(),
    silence,
    params,
    captureEnvironment,
  );
  const preview = renderEmber(
    RISING_EMBER_EFFECT_DEFINITION.create(),
    silence,
    params,
    previewEnvironment,
  );
  assert.equal(elementOperations(capture).length, 0);
  assert.ok(elementOperations(preview).length > 0);
});

check('an explicit transient immediately adds a bounded cinder fan', () => {
  const steady = renderEmber(RISING_EMBER_EFFECT_DEFINITION.create());
  const burst = renderEmber(
    RISING_EMBER_EFFECT_DEFINITION.create(),
    { ...frame, transient: true },
  );
  assert.ok(elementOperations(burst).length > elementOperations(steady).length);
  assert.ok(elementOperations(burst).length <= RISING_EMBER_MAX_ELEMENTS);
});

check('band weighting changes emission and flight geometry', () => {
  const trebleFrame = {
    ...frame,
    energy: 0.12,
    bands: Array.from({ length: 32 }, (_, index) => index >= 22 ? 0.92 : 0.04),
  };
  const muted = renderEmber(
    RISING_EMBER_EFFECT_DEFINITION.create(),
    trebleFrame,
    { ...params, trebleWeight: 0 },
  );
  const lifted = renderEmber(
    RISING_EMBER_EFFECT_DEFINITION.create(),
    trebleFrame,
    { ...params, trebleWeight: 2 },
  );
  assert.notDeepEqual(muted, lifted);
  assert.ok(elementOperations(lifted).length > elementOperations(muted).length);
});

check('linear hearth, centered plume, and radial corona geometries are distinct', () => {
  const linear = renderEmber(RISING_EMBER_EFFECT_DEFINITION.create());
  const centered = renderEmber(
    RISING_EMBER_EFFECT_DEFINITION.create(),
    frame,
    { ...params, layoutMode: 'centered' },
  );
  const radial = renderEmber(
    RISING_EMBER_EFFECT_DEFINITION.create(),
    frame,
    { ...params, layoutMode: 'radial' },
  );
  assert.notDeepEqual(linear.filter(([op]) => op === 'arc'), centered.filter(([op]) => op === 'arc'));
  assert.notDeepEqual(centered.filter(([op]) => op === 'arc'), radial.filter(([op]) => op === 'arc'));
});

check('High Contrast removes additive glow and keeps hard source-over structure', () => {
  const operations = renderEmber(
    RISING_EMBER_EFFECT_DEFINITION.create(),
    frame,
    { ...params, highContrast: true },
  );
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

check('reduced motion is time-independent and uses a fixed low-cost constellation', () => {
  const reduced = { amplitudeMode: 'preview', reduceMotion: true };
  const first = renderEmber(
    RISING_EMBER_EFFECT_DEFINITION.create(),
    { ...frame, timeMs: 1000 },
    params,
    reduced,
    0.1,
  );
  const second = renderEmber(
    RISING_EMBER_EFFECT_DEFINITION.create(),
    { ...frame, timeMs: 9000 },
    params,
    reduced,
    0.1,
  );
  assert.deepEqual(first, second);
  assert.ok(elementOperations(first).length < RISING_EMBER_MAX_ELEMENTS);
});

check('long-running emission remains bounded across deterministic slot reuse', () => {
  const visual = RISING_EMBER_EFFECT_DEFINITION.create();
  let operations = [];
  for (let index = 0; index < 180; index += 1) {
    operations = renderEmber(
      visual,
      { ...frame, timeMs: 1000 + index * 100, transient: index % 17 === 0 },
      params,
      captureEnvironment,
      0.1,
    );
    assert.ok(elementOperations(operations).length <= RISING_EMBER_MAX_ELEMENTS);
  }
  assert.ok(operations.flat(Infinity).filter((value) => typeof value === 'number').every(Number.isFinite));
});

console.log(`\n${checks}/${checks} checks passed.`);
rmSync(outdir, { recursive: true, force: true });
