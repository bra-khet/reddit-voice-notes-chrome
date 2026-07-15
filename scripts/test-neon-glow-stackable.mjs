// v6.0 Phase 3 — bounded consumer-local Neon Glow geometry/state.
//
//   Run: node scripts/test-neon-glow-stackable.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-neon-glow-'));
const outfile = join(outdir, 'neon-glow.mjs');

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
    sourcefile: 'neon-glow-test-entry.ts',
  },
});

const {
  LAYERED_SMOKE_ID,
  NEON_GLOW_EFFECT_DEFINITION,
  NEON_GLOW_ID,
  NEON_GLOW_LABEL,
  NEON_GLOW_MAX_ELEMENTS,
  NEON_GLOW_MAX_GEOMETRY_POINTS,
  NEON_GLOW_MAX_TUBES,
  NEON_GLOW_MIN_TUBES,
  NEON_GLOW_POINTS_PER_TUBE,
  NEON_GLOW_PULSES_PER_TUBE,
  RISING_EMBER_ID,
  drawThemeBackground,
  getStackableEffectDefinition,
  isStackableEffectId,
  normalizeDesignOverrides,
  registerCoreStackableEffects,
  renderStackableEffectsForCanvas,
  resolveNeonGlowTubeLimit,
} = await import(pathToFileURL(outfile).href);

const canvas = { width: 640, height: 360 };
const params = {
  sensitivity: 0.72,
  intensity: 0.78,
  smoothing: 0.56,
  color: ['#00f5ff', '#6c63ff', '#d946ef', '#ff4ecd'],
  density: 0.72,
  bassWeight: 0.9,
  midWeight: 1.2,
  trebleWeight: 1.05,
  layoutMode: 'linear',
  highContrast: false,
};
const captureEnvironment = { amplitudeMode: 'capture', reduceMotion: false };
const previewEnvironment = { amplitudeMode: 'preview', reduceMotion: false };
const frame = {
  energy: 0.47,
  bands: Array.from({ length: 32 }, (_, index) => 0.12 + ((index * 19) % 27) / 36),
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
  visual = NEON_GLOW_EFFECT_DEFINITION.create(),
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

console.log('Neon Glow stackable');

check('definition is registered with stable identity, fixed geometry, and exact paint ceiling', () => {
  registerCoreStackableEffects();
  registerCoreStackableEffects();
  assert.equal(isStackableEffectId(NEON_GLOW_ID), true);
  assert.equal(getStackableEffectDefinition(NEON_GLOW_ID), NEON_GLOW_EFFECT_DEFINITION);
  assert.deepEqual(
    [NEON_GLOW_EFFECT_DEFINITION.id, NEON_GLOW_EFFECT_DEFINITION.label],
    [NEON_GLOW_ID, NEON_GLOW_LABEL],
  );
  assert.equal(
    NEON_GLOW_MAX_GEOMETRY_POINTS,
    NEON_GLOW_MAX_TUBES * NEON_GLOW_POINTS_PER_TUBE,
  );
  assert.equal(
    NEON_GLOW_MAX_ELEMENTS,
    NEON_GLOW_MAX_TUBES * (3 + NEON_GLOW_PULSES_PER_TUBE * 2),
  );
  assert.deepEqual(
    normalizeDesignOverrides({
      barColor: '#00f5ff',
      stackables: [LAYERED_SMOKE_ID, NEON_GLOW_ID],
    })?.stackables,
    [LAYERED_SMOKE_ID, NEON_GLOW_ID],
  );
});

check('density resolves only the documented 3–7 tube range', () => {
  assert.equal(resolveNeonGlowTubeLimit(-1), NEON_GLOW_MIN_TUBES);
  assert.equal(resolveNeonGlowTubeLimit(2), NEON_GLOW_MAX_TUBES);
  assert.equal(resolveNeonGlowTubeLimit(0.5), 5);
});

check('steady voice paints deterministic finite continuous neon under the hard cap', () => {
  const first = render().operations;
  const second = render().operations;
  assert.deepEqual(first, second);
  assert.equal(numericValuesAreFinite(first), true);
  assert.ok(first.some(([operation]) => operation === 'quadraticCurveTo'));
  assert.ok(elementOperations(first).length > 0);
  assert.ok(elementOperations(first).length <= NEON_GLOW_MAX_ELEMENTS);
});

check('capture silence is empty while synthetic preview demonstrates the tubes', () => {
  const silence = { ...frame, energy: 0, bands: Array(32).fill(0), transient: false };
  const capture = render(undefined, silence, params, captureEnvironment).operations;
  const preview = render(undefined, silence, params, previewEnvironment).operations;
  assert.equal(elementOperations(capture).length, 0);
  assert.ok(elementOperations(preview).length > 0);
});

check('a transient surges existing bounded cores and charge knots immediately', () => {
  const steady = render().operations;
  const surged = render(
    undefined,
    { ...frame, transient: true },
  ).operations;
  assert.notDeepEqual(steady, surged);
  assert.ok(elementOperations(surged).length <= NEON_GLOW_MAX_ELEMENTS);
  const steadyWidths = steady.filter(([operation]) => operation === 'lineWidth');
  const surgeWidths = surged.filter(([operation]) => operation === 'lineWidth');
  assert.notDeepEqual(steadyWidths, surgeWidths);
});

check('band weighting reshapes tube contours rather than painting spectrum bars', () => {
  const midFrame = {
    ...frame,
    energy: 0.12,
    bands: Array.from({ length: 32 }, (_, index) => index >= 10 && index < 22 ? 0.92 : 0.04),
  };
  const muted = render(
    undefined,
    midFrame,
    { ...params, midWeight: 0 },
  ).operations;
  const lifted = render(
    undefined,
    midFrame,
    { ...params, midWeight: 2 },
  ).operations;
  assert.notDeepEqual(
    muted.filter(([operation]) => operation === 'quadraticCurveTo'),
    lifted.filter(([operation]) => operation === 'quadraticCurveTo'),
  );
  assert.equal(lifted.some(([operation]) => operation === 'fillRect'), false);
});

check('linear rails, centered sign contours, and radial orbit rings are distinct', () => {
  const linear = render().operations;
  const centered = render(
    undefined,
    frame,
    { ...params, layoutMode: 'centered' },
  ).operations;
  const radial = render(
    undefined,
    frame,
    { ...params, layoutMode: 'radial' },
  ).operations;
  const geometry = (operations) => operations.filter(([operation]) => (
    operation === 'moveTo' || operation === 'quadraticCurveTo' || operation === 'lineTo'
  ));
  assert.notDeepEqual(geometry(linear), geometry(centered));
  assert.notDeepEqual(geometry(centered), geometry(radial));
  assert.equal(linear.some(([operation]) => operation === 'closePath'), false);
  assert.ok(centered.some(([operation]) => operation === 'closePath'));
  assert.ok(radial.some(([operation]) => operation === 'closePath'));
});

check('the effect remains a path-and-knot atmosphere, not a second Classic bar renderer', () => {
  const operations = render().operations;
  assert.ok(operations.some(([operation]) => operation === 'quadraticCurveTo'));
  assert.ok(operations.some(([operation]) => operation === 'arc'));
  assert.equal(operations.some(([operation]) => operation === 'fillRect'), false);
  assert.equal(operations.some(([operation]) => operation === 'rect'), false);
});

check('the theme seam renders Neon Glow after its background without a primary overlay', () => {
  const ctx = createContext();
  drawThemeBackground(
    ctx,
    canvas,
    {
      id: 'neon-stackable-test',
      name: 'Neon stackable test',
      bars: { width: 8, spacing: 4, cornerRadius: 2, glow: 4 },
      colors: { bar: '#f8fafc', glow: '#00f5ff', bg: '#030712' },
      background: { type: 'solid', value: '#030712' },
      designEffects: { stackables: [NEON_GLOW_ID] },
    },
    null,
    frame,
    null,
    undefined,
    captureEnvironment,
  );
  const backgroundIndex = ctx.operations.findIndex(([operation]) => operation === 'fillRect');
  const neonIndex = ctx.operations.findIndex(([operation]) => operation === 'quadraticCurveTo');
  assert.ok(backgroundIndex >= 0);
  assert.ok(neonIndex > backgroundIndex);
});

check('a real Ember + Smoke + Neon stack stays ordered and within summed bounded cost', () => {
  const ctx = createContext();
  const cost = renderStackableEffectsForCanvas(
    [RISING_EMBER_ID, LAYERED_SMOKE_ID, NEON_GLOW_ID],
    ctx,
    canvas,
    frame,
    params,
    captureEnvironment,
  );
  assert.ok(ctx.operations.some(([operation]) => operation === 'quadraticCurveTo'));
  assert.ok(ctx.operations.some(([operation]) => operation === 'arc'));
  assert.ok(cost > NEON_GLOW_EFFECT_DEFINITION.create().getPerformanceCost());
  assert.ok(cost <= 132 + 280 + NEON_GLOW_MAX_ELEMENTS);
});

check('High Contrast removes additive blur while retaining hard tube structure', () => {
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
  assert.ok(operations.some(([operation]) => operation === 'stroke'));
});

check('reduced motion is a fixed time-independent neon sculpture', () => {
  const visual = NEON_GLOW_EFFECT_DEFINITION.create();
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
  assert.ok(elementOperations(first).length <= NEON_GLOW_MAX_ELEMENTS);
});

check('180 capture frames reuse bounded geometry and never exceed paint/state ceilings', () => {
  const visual = NEON_GLOW_EFFECT_DEFINITION.create();
  for (let index = 0; index < 180; index += 1) {
    const operations = render(
      visual,
      { ...frame, timeMs: 1000 + index * 100, transient: index % 19 === 0 },
      params,
      captureEnvironment,
      0.1,
    ).operations;
    assert.ok(elementOperations(operations).length <= NEON_GLOW_MAX_ELEMENTS);
    assert.ok(
      operations.filter(([operation]) => operation === 'quadraticCurveTo').length
        <= NEON_GLOW_MAX_GEOMETRY_POINTS * 3,
    );
    assert.equal(numericValuesAreFinite(operations), true);
  }
});

console.log(`\n${checks}/${checks} checks passed.`);
rmSync(outdir, { recursive: true, force: true });
