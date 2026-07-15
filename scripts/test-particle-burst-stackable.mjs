// v6.0 Phase 3 — bounded Particle Burst one-shot stackable.
//
//   Run: node scripts/test-particle-burst-stackable.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-particle-burst-'));
const outfile = join(outdir, 'particle-burst.mjs');

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
    sourcefile: 'particle-burst-test-entry.ts',
  },
});

const {
  NEON_GLOW_ID,
  NEON_GLOW_MAX_ELEMENTS,
  PARTICLE_BURST_BURST_PASSES,
  PARTICLE_BURST_EFFECT_DEFINITION,
  PARTICLE_BURST_ID,
  PARTICLE_BURST_LABEL,
  PARTICLE_BURST_MAX_CONCURRENT_BURSTS,
  PARTICLE_BURST_MAX_ELEMENTS,
  PARTICLE_BURST_MAX_PARTICLES,
  PARTICLE_BURST_MAX_POOL_SIZE,
  PARTICLE_BURST_MIN_PARTICLES,
  PARTICLE_BURST_PARTICLE_PASSES,
  RISING_EMBER_ID,
  RISING_EMBER_MAX_ELEMENTS,
  drawThemeBackground,
  getStackableEffectDefinition,
  isStackableEffectId,
  normalizeDesignOverrides,
  registerCoreStackableEffects,
  renderStackableEffectsForCanvas,
  resolveParticleBurstCount,
  resolveParticleBurstPoolLimit,
} = await import(pathToFileURL(outfile).href);

const canvas = { width: 640, height: 360 };
const params = {
  sensitivity: 0.72,
  intensity: 0.78,
  smoothing: 0.36,
  color: ['#7dd3fc', '#a78bfa', '#f472b6', '#fef08a', '#ffffff'],
  density: 1,
  bassWeight: 1,
  midWeight: 1,
  trebleWeight: 1,
  layoutMode: 'linear',
  highContrast: false,
};
const captureEnvironment = { amplitudeMode: 'capture', reduceMotion: false };
const previewEnvironment = { amplitudeMode: 'preview', reduceMotion: false };
const frame = {
  energy: 0.48,
  bands: Array.from({ length: 32 }, (_, index) => 0.12 + ((index * 11) % 23) / 32),
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
    closePath() { operations.push(['closePath']); },
    moveTo(...args) { operations.push(['moveTo', ...args]); },
    lineTo(...args) { operations.push(['lineTo', ...args]); },
    quadraticCurveTo(...args) { operations.push(['quadraticCurveTo', ...args]); },
    arc(...args) { operations.push(['arc', ...args]); },
    rect(...args) { operations.push(['rect', ...args]); },
    fillRect(...args) { operations.push(['fillRect', state.fillStyle, ...args]); },
    stroke() { operations.push(['stroke', state.strokeStyle, state.lineWidth]); },
    fill() { operations.push(['fill', state.fillStyle]); },
  };
  for (const property of [
    'fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin',
    'globalCompositeOperation', 'shadowColor', 'shadowBlur',
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
  visual = PARTICLE_BURST_EFFECT_DEFINITION.create(),
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

function geometryOperations(operations) {
  return operations.filter(([operation]) => (
    operation === 'moveTo'
    || operation === 'lineTo'
    || operation === 'arc'
    || operation === 'closePath'
  ));
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

console.log('Particle Burst stackable');

check('definition is registered with stable identity and exact concurrent paint ceiling', () => {
  registerCoreStackableEffects();
  registerCoreStackableEffects();
  assert.equal(isStackableEffectId(PARTICLE_BURST_ID), true);
  assert.equal(getStackableEffectDefinition(PARTICLE_BURST_ID), PARTICLE_BURST_EFFECT_DEFINITION);
  assert.deepEqual(
    [PARTICLE_BURST_EFFECT_DEFINITION.id, PARTICLE_BURST_EFFECT_DEFINITION.label],
    [PARTICLE_BURST_ID, PARTICLE_BURST_LABEL],
  );
  assert.equal(
    PARTICLE_BURST_MAX_POOL_SIZE,
    PARTICLE_BURST_MAX_PARTICLES * PARTICLE_BURST_MAX_CONCURRENT_BURSTS,
  );
  assert.equal(
    PARTICLE_BURST_MAX_ELEMENTS,
    PARTICLE_BURST_MAX_POOL_SIZE * PARTICLE_BURST_PARTICLE_PASSES
      + PARTICLE_BURST_MAX_CONCURRENT_BURSTS * PARTICLE_BURST_BURST_PASSES,
  );
  // BUG FIX: Particle Burst normalization fixture lacked the required base style color
  // Fix: Supply the existing DesignOverrides barColor invariant before asserting stackable preservation.
  assert.deepEqual(
    normalizeDesignOverrides({
      barColor: '#7dd3fc',
      stackables: [NEON_GLOW_ID, PARTICLE_BURST_ID],
    })?.stackables,
    [NEON_GLOW_ID, PARTICLE_BURST_ID],
  );
});

check('density resolves 14–28 shards per bloom and only three overlapping bloom loads', () => {
  assert.equal(resolveParticleBurstCount(-1), PARTICLE_BURST_MIN_PARTICLES);
  assert.equal(resolveParticleBurstCount(2), PARTICLE_BURST_MAX_PARTICLES);
  assert.equal(resolveParticleBurstCount(0.5), 21);
  assert.equal(
    resolveParticleBurstPoolLimit(1),
    PARTICLE_BURST_MAX_PARTICLES * PARTICLE_BURST_MAX_CONCURRENT_BURSTS,
  );
  const visual = PARTICLE_BURST_EFFECT_DEFINITION.create();
  render(visual, { ...frame, transient: true });
  assert.equal(visual.getPerformanceCost(), PARTICLE_BURST_MAX_ELEMENTS);
});

check('steady capture stays quiet while an explicit onset paints a deterministic finite bloom', () => {
  const quiet = render().operations;
  const first = render(undefined, { ...frame, transient: true }).operations;
  const second = render(undefined, { ...frame, transient: true }).operations;
  assert.equal(elementOperations(quiet).length, 0);
  assert.deepEqual(first, second);
  assert.equal(numericValuesAreFinite(first), true);
  assert.ok(elementOperations(first).length > 0);
  assert.ok(elementOperations(first).length <= PARTICLE_BURST_MAX_ELEMENTS);
});

check('a bloom is truly one-shot and fully expires without continuous emission', () => {
  const visual = PARTICLE_BURST_EFFECT_DEFINITION.create();
  render(visual, { ...frame, transient: true });
  let last = [];
  for (let index = 1; index <= 30; index += 1) {
    last = render(
      visual,
      { ...frame, timeMs: 1000 + index * 100, transient: false },
      params,
      captureEnvironment,
      0.1,
    ).operations;
  }
  assert.equal(elementOperations(last).length, 0);
});

check('preset-local positive spectral flux triggers real capture without a carrier hint', () => {
  const visual = PARTICLE_BURST_EFFECT_DEFINITION.create();
  const baseline = { ...frame, energy: 0.03, bands: Array(32).fill(0.02), transient: false };
  const attack = { ...frame, energy: 0.62, bands: Array(32).fill(0.9), timeMs: 1100, transient: false };
  assert.equal(elementOperations(render(visual, baseline).operations).length, 0);
  const burst = render(visual, attack, params, captureEnvironment, 0.1).operations;
  assert.ok(elementOperations(burst).length > 0);
});

check('falling spectral energy does not create a false attack bloom', () => {
  const visual = PARTICLE_BURST_EFFECT_DEFINITION.create();
  const high = { ...frame, energy: 0.62, bands: Array(32).fill(0.9), transient: false };
  const low = { ...frame, energy: 0.03, bands: Array(32).fill(0.02), timeMs: 1100, transient: false };
  render(visual, high);
  const falling = render(visual, low, params, captureEnvironment, 0.1).operations;
  assert.equal(elementOperations(falling).length, 0);
});

check('capture silence is empty while synthetic preview demonstrates deterministic punctuation', () => {
  const silence = { ...frame, energy: 0, bands: Array(32).fill(0), transient: false };
  const capture = render(undefined, silence, params, captureEnvironment).operations;
  const first = render(undefined, silence, params, previewEnvironment).operations;
  const second = render(undefined, silence, params, previewEnvironment).operations;
  assert.equal(elementOperations(capture).length, 0);
  assert.ok(elementOperations(first).length > 0);
  assert.deepEqual(first, second);
});

check('band weights move the bloom origin and alter shard force, not only color', () => {
  const splitFrame = {
    ...frame,
    energy: 0.18,
    transient: true,
    bands: Array.from({ length: 32 }, (_, index) => (
      index < 6 ? 0.82 : index >= 26 ? 0.76 : 0.04
    )),
  };
  const bass = render(
    undefined,
    splitFrame,
    { ...params, bassWeight: 2, trebleWeight: 0 },
  ).operations;
  const treble = render(
    undefined,
    splitFrame,
    { ...params, bassWeight: 0, trebleWeight: 2 },
  ).operations;
  assert.notDeepEqual(geometryOperations(bass), geometryOperations(treble));
});

check('linear fan, centered nova, and radial rim bloom are distinct geometries', () => {
  const transient = { ...frame, transient: true };
  const linear = render(undefined, transient).operations;
  const centered = render(undefined, transient, { ...params, layoutMode: 'centered' }).operations;
  const radial = render(undefined, transient, { ...params, layoutMode: 'radial' }).operations;
  assert.notDeepEqual(geometryOperations(linear), geometryOperations(centered));
  assert.notDeepEqual(geometryOperations(centered), geometryOperations(radial));
  assert.notDeepEqual(geometryOperations(radial), geometryOperations(linear));
});

check('visual identity is shock rings plus comet trails and diamond shards, never bars', () => {
  const operations = render(undefined, { ...frame, transient: true }).operations;
  assert.ok(operations.some(([operation]) => operation === 'arc'));
  assert.ok(operations.some(([operation]) => operation === 'lineTo'));
  assert.ok(operations.some(([operation]) => operation === 'closePath'));
  assert.equal(operations.some(([operation]) => operation === 'fillRect'), false);
  assert.equal(operations.some(([operation]) => operation === 'rect'), false);
});

check('the theme seam renders Particle Burst after its background without a primary overlay', () => {
  const ctx = createContext();
  drawThemeBackground(
    ctx,
    canvas,
    {
      id: 'particle-burst-stackable-test',
      name: 'Particle Burst stackable test',
      bars: { width: 8, spacing: 4, cornerRadius: 2, glow: 4 },
      colors: { bar: '#ffffff', glow: '#a78bfa', bg: '#030712' },
      background: { type: 'solid', value: '#030712' },
      designEffects: { stackables: [PARTICLE_BURST_ID] },
    },
    null,
    { ...frame, transient: true },
    null,
    undefined,
    captureEnvironment,
  );
  const backgroundIndex = ctx.operations.findIndex(([operation]) => operation === 'fillRect');
  const burstIndex = ctx.operations.findIndex(([operation]) => operation === 'closePath');
  assert.ok(backgroundIndex >= 0);
  assert.ok(burstIndex > backgroundIndex);
});

check('a real Ember + Neon + Particle stack stays within its summed hard ceiling', () => {
  const ctx = createContext();
  const cost = renderStackableEffectsForCanvas(
    [RISING_EMBER_ID, NEON_GLOW_ID, PARTICLE_BURST_ID],
    ctx,
    canvas,
    { ...frame, transient: true },
    params,
    captureEnvironment,
  );
  assert.equal(
    cost,
    RISING_EMBER_MAX_ELEMENTS + NEON_GLOW_MAX_ELEMENTS + PARTICLE_BURST_MAX_ELEMENTS,
  );
  assert.ok(ctx.operations.some(([operation]) => operation === 'quadraticCurveTo'));
  assert.ok(ctx.operations.some(([operation]) => operation === 'closePath'));
});

check('High Contrast removes additive blur while retaining rings and shards', () => {
  const operations = render(
    undefined,
    { ...frame, transient: true },
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
  assert.ok(operations.some(([operation]) => operation === 'closePath'));
});

check('reduced motion is a fixed time-independent burst sculpture', () => {
  const visual = PARTICLE_BURST_EFFECT_DEFINITION.create();
  const reduced = { amplitudeMode: 'preview', reduceMotion: true };
  const first = render(
    visual,
    { ...frame, timeMs: 1000 },
    params,
    reduced,
    0.1,
  ).operations;
  const second = render(
    visual,
    { ...frame, timeMs: 9000 },
    params,
    reduced,
    0.1,
  ).operations;
  assert.deepEqual(first, second);
  assert.ok(elementOperations(first).length > 0);
  assert.ok(elementOperations(first).length <= PARTICLE_BURST_MAX_ELEMENTS);
});

check('240 capture frames reuse bounded state and never exceed the declared paint ceiling', () => {
  const visual = PARTICLE_BURST_EFFECT_DEFINITION.create();
  for (let index = 0; index < 240; index += 1) {
    const operations = render(
      visual,
      {
        ...frame,
        timeMs: 1000 + index * 100,
        transient: index % 17 === 0,
      },
      params,
      captureEnvironment,
      0.1,
    ).operations;
    assert.ok(elementOperations(operations).length <= PARTICLE_BURST_MAX_ELEMENTS);
    assert.equal(numericValuesAreFinite(operations), true);
  }
});

console.log(`\n${checks}/${checks} checks passed.`);
rmSync(outdir, { recursive: true, force: true });
