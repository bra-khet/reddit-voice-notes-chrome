// v6.0 Phase 3 — Electric Arc corona and sustained Lightning stackables.
//
//   Run: node scripts/test-electricity-stackables.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-electricity-stackables-'));
const outfile = join(outdir, 'electricity-stackables.mjs');

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
    sourcefile: 'electricity-stackables-test-entry.ts',
  },
});

const {
  ELECTRIC_ARC_EFFECT_DEFINITION,
  ELECTRIC_ARC_ID,
  ELECTRIC_ARC_LABEL,
  ELECTRIC_ARC_MAX_CONTACTS,
  ELECTRIC_ARC_MAX_ELEMENTS,
  ELECTRIC_ARC_MAX_STREAMERS,
  ELECTRIC_ARC_MIN_STREAMERS,
  LIGHTNING_EFFECT_DEFINITION,
  LIGHTNING_ID,
  LIGHTNING_LABEL,
  LIGHTNING_MAX_BRANCHES,
  LIGHTNING_MAX_ELEMENTS,
  LIGHTNING_MAX_POINTS,
  LIGHTNING_MIN_BRANCHES,
  LIGHTNING_MIN_POINTS,
  MAX_STACKABLE_EFFECTS,
  RISING_EMBER_ID,
  drawThemeBackground,
  getStackableEffectDefinition,
  isStackableEffectId,
  normalizeDesignOverrides,
  registerCoreStackableEffects,
  renderStackableEffectsForCanvas,
  resolveElectricArcContactCount,
  resolveElectricArcStreamerLimit,
  resolveLightningBranchLimit,
  resolveLightningPointCount,
} = await import(pathToFileURL(outfile).href);

const canvas = { width: 640, height: 360 };
const params = {
  sensitivity: 0.72,
  intensity: 0.75,
  smoothing: 0.48,
  color: ['#4b38c8', '#42d7ff', '#f4ffff'],
  density: 1,
  bassWeight: 1,
  midWeight: 1,
  trebleWeight: 1.15,
  layoutMode: 'linear',
  highContrast: false,
};
const captureEnvironment = { amplitudeMode: 'capture', reduceMotion: false };
const previewEnvironment = { amplitudeMode: 'preview', reduceMotion: false };
const frame = {
  energy: 0.48,
  bands: Array.from({ length: 32 }, (_, index) => 0.14 + ((index * 17) % 27) / 34),
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
    // The three-stack seam runs the real Rising Ember effect, whose whip trail needs these.
    quadraticCurveTo(...args) { operations.push(['quadraticCurveTo', ...args]); },
    createLinearGradient(...args) {
      const gradient = new MockGradient(args);
      operations.push(['createLinearGradient', ...args]);
      return gradient;
    },
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

function render(
  definition,
  inputFrame = frame,
  inputParams = params,
  environment = captureEnvironment,
  visual = definition.create(),
  dt,
) {
  const ctx = createContext();
  if (dt !== undefined) visual.update?.(inputFrame, dt);
  visual.render(ctx, canvas, inputFrame, inputParams, environment);
  return { operations: ctx.operations, visual };
}

function paintOperations(operations) {
  return operations.filter(([operation]) => operation === 'stroke' || operation === 'fill');
}

function numericValuesAreFinite(operations) {
  return operations.flat(Infinity)
    .filter((value) => typeof value === 'number')
    .every(Number.isFinite);
}

function hasPoint(operations, operation, x, y) {
  return operations.some(([name, left, top]) => (
    name === operation && Math.abs(left - x) < 0.001 && Math.abs(top - y) < 0.001
  ));
}

/** The main channel start: the one moveTo shared by all three lightning body passes. */
function channelStart(operations) {
  const counts = new Map();
  for (const [name, x, y] of operations) {
    if (name !== 'moveTo') continue;
    const key = `${x},${y}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of counts) {
    if (count >= 3) return key;
  }
  return null;
}

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

console.log('Electric Arc / Lightning stackables');

check('both user-visible effects are stable catalog entries and idempotent built-ins', () => {
  registerCoreStackableEffects();
  registerCoreStackableEffects();
  assert.equal(isStackableEffectId(ELECTRIC_ARC_ID), true);
  assert.equal(isStackableEffectId(LIGHTNING_ID), true);
  assert.equal(getStackableEffectDefinition(ELECTRIC_ARC_ID), ELECTRIC_ARC_EFFECT_DEFINITION);
  assert.equal(getStackableEffectDefinition(LIGHTNING_ID), LIGHTNING_EFFECT_DEFINITION);
  assert.deepEqual(
    [ELECTRIC_ARC_EFFECT_DEFINITION.label, LIGHTNING_EFFECT_DEFINITION.label],
    [ELECTRIC_ARC_LABEL, LIGHTNING_LABEL],
  );
  assert.equal(ELECTRIC_ARC_EFFECT_DEFINITION.maxElements, ELECTRIC_ARC_MAX_ELEMENTS);
  assert.equal(LIGHTNING_EFFECT_DEFINITION.maxElements, LIGHTNING_MAX_ELEMENTS);
  assert.deepEqual(
    normalizeDesignOverrides({
      barColor: '#42d7ff',
      stackables: [ELECTRIC_ARC_ID, LIGHTNING_ID],
    })?.stackables,
    [ELECTRIC_ARC_ID, LIGHTNING_ID],
  );
  assert.equal(render(ELECTRIC_ARC_EFFECT_DEFINITION).visual.getPerformanceCost(), ELECTRIC_ARC_MAX_ELEMENTS);
  assert.equal(render(LIGHTNING_EFFECT_DEFINITION).visual.getPerformanceCost(), LIGHTNING_MAX_ELEMENTS);
});

check('density stays inside the documented corona and bolt geometry ceilings', () => {
  assert.equal(resolveElectricArcStreamerLimit(-1), ELECTRIC_ARC_MIN_STREAMERS);
  assert.equal(resolveElectricArcStreamerLimit(2), ELECTRIC_ARC_MAX_STREAMERS);
  assert.equal(resolveElectricArcContactCount(-1), 3);
  assert.equal(resolveElectricArcContactCount(2), ELECTRIC_ARC_MAX_CONTACTS);
  assert.equal(resolveLightningPointCount(-1), LIGHTNING_MIN_POINTS);
  assert.equal(resolveLightningPointCount(2), LIGHTNING_MAX_POINTS);
  assert.equal(resolveLightningBranchLimit(-1), LIGHTNING_MIN_BRANCHES);
  assert.equal(resolveLightningBranchLimit(2), LIGHTNING_MAX_BRANCHES);
});

check('steady voice paints deterministic finite geometry under both hard caps', () => {
  for (const [definition, cap] of [
    [ELECTRIC_ARC_EFFECT_DEFINITION, ELECTRIC_ARC_MAX_ELEMENTS],
    [LIGHTNING_EFFECT_DEFINITION, LIGHTNING_MAX_ELEMENTS],
  ]) {
    const first = render(definition).operations;
    const second = render(definition).operations;
    assert.deepEqual(first, second);
    assert.equal(numericValuesAreFinite(first), true);
    assert.ok(paintOperations(first).length > 0);
    assert.ok(paintOperations(first).length <= cap);
  }
});

check('corona is a multi-streamer field while Lightning remains a connected contact strike', () => {
  const corona = render(ELECTRIC_ARC_EFFECT_DEFINITION).operations;
  const bolt = render(LIGHTNING_EFFECT_DEFINITION).operations;
  const coronaStarts = corona.filter(([operation]) => operation === 'moveTo').length;
  const boltStarts = bolt.filter(([operation]) => operation === 'moveTo').length;
  assert.ok(coronaStarts > boltStarts);
  // Endpoints now walk, so instead of pinned coordinates assert connectivity: all three
  // main body passes share one start point somewhere on the canvas.
  assert.ok(channelStart(bolt) !== null);
});

check('capture silence stays empty while synthetic preview demonstrates both effects', () => {
  const silence = { ...frame, energy: 0, bands: Array(32).fill(0), transient: false };
  for (const definition of [ELECTRIC_ARC_EFFECT_DEFINITION, LIGHTNING_EFFECT_DEFINITION]) {
    const capture = render(definition, silence, params, captureEnvironment).operations;
    const preview = render(definition, silence, params, previewEnvironment).operations;
    assert.equal(paintOperations(capture).length, 0);
    assert.ok(paintOperations(preview).length > 0);
  }
});

check('transients immediately over-volt streamers and surge/rebranch the conductor', () => {
  for (const definition of [ELECTRIC_ARC_EFFECT_DEFINITION, LIGHTNING_EFFECT_DEFINITION]) {
    const steady = render(definition).operations;
    const transient = render(definition, { ...frame, transient: true }).operations;
    assert.notDeepEqual(transient, steady);
    assert.ok(paintOperations(transient).length >= paintOperations(steady).length);
  }
});

check('treble weighting materially changes ionization forks and bolt branches', () => {
  const trebleFrame = {
    ...frame,
    energy: 0.12,
    bands: Array.from({ length: 32 }, (_, index) => index >= 22 ? 0.94 : 0.03),
  };
  for (const definition of [ELECTRIC_ARC_EFFECT_DEFINITION, LIGHTNING_EFFECT_DEFINITION]) {
    const muted = render(definition, trebleFrame, { ...params, trebleWeight: 0 }).operations;
    const lifted = render(definition, trebleFrame, { ...params, trebleWeight: 2 }).operations;
    assert.notDeepEqual(muted, lifted);
    assert.ok(paintOperations(lifted).length >= paintOperations(muted).length);
  }
});

check('linear, centered, and radial contact arrangements are geometrically distinct', () => {
  for (const definition of [ELECTRIC_ARC_EFFECT_DEFINITION, LIGHTNING_EFFECT_DEFINITION]) {
    const linear = render(definition).operations.filter(([op]) => op === 'arc');
    const centered = render(definition, frame, { ...params, layoutMode: 'centered' })
      .operations.filter(([op]) => op === 'arc');
    const radial = render(definition, frame, { ...params, layoutMode: 'radial' })
      .operations.filter(([op]) => op === 'arc');
    assert.notDeepEqual(linear, centered);
    assert.notDeepEqual(centered, radial);
  }
});

check('Lightning remains continuously connected across bounded route refreshes', () => {
  const visual = LIGHTNING_EFFECT_DEFINITION.create();
  const first = render(LIGHTNING_EFFECT_DEFINITION, frame, params, captureEnvironment, visual, 0).operations;
  const second = render(
    LIGHTNING_EFFECT_DEFINITION,
    { ...frame, timeMs: 1250 },
    params,
    captureEnvironment,
    visual,
    0.1,
  ).operations;
  // No walk fires inside 0.1 s, so the shared channel start must be identical across
  // both renders (connected channel, not a fresh disconnected strike).
  assert.ok(channelStart(first) !== null);
  assert.equal(channelStart(second), channelStart(first));
});

check('Lightning walks: endpoints relocate on a seeded beat, one end at a time', () => {
  const visual = LIGHTNING_EFFECT_DEFINITION.create();
  render(LIGHTNING_EFFECT_DEFINITION, frame, params, captureEnvironment, visual, 0);
  const starts = new Set();
  for (let step = 1; step <= 40; step += 1) {
    const ops = render(
      LIGHTNING_EFFECT_DEFINITION,
      { ...frame, timeMs: 1000 + step * 100 },
      params,
      captureEnvironment,
      visual,
      0.1,
    ).operations;
    const start = channelStart(ops);
    if (start) starts.add(start);
  }
  // Over four seconds of speech the planted end must have hunted new ground at least once.
  assert.ok(starts.size >= 2);
});

check('the live theme seam composes Ember, Electric Arc, and Lightning as one bounded three-stack', () => {
  const ctx = createContext();
  drawThemeBackground(
    ctx,
    canvas,
    {
      id: 'electric-stack-test',
      name: 'Electric stack test',
      bars: { width: 8, spacing: 4, cornerRadius: 2, glow: 4 },
      colors: { bar: '#70e9ff', glow: '#725cff', bg: '#050711' },
      background: { type: 'solid', value: '#050711' },
      designEffects: { stackables: [RISING_EMBER_ID, ELECTRIC_ARC_ID, LIGHTNING_ID] },
    },
    null,
    frame,
    null,
    undefined,
    captureEnvironment,
  );
  const backgroundIndex = ctx.operations.findIndex(([operation]) => operation === 'fillRect');
  const visualIndex = ctx.operations.findIndex(([operation]) => operation === 'stroke');
  assert.ok(backgroundIndex >= 0);
  assert.ok(visualIndex > backgroundIndex);

  const cost = renderStackableEffectsForCanvas(
    [RISING_EMBER_ID, ELECTRIC_ARC_ID, LIGHTNING_ID, 'smoke'],
    createContext(),
    { width: 640, height: 360 },
    frame,
    params,
    captureEnvironment,
  );
  assert.ok(cost > 0);
  assert.equal(MAX_STACKABLE_EFFECTS, 3);
});

check('High Contrast removes additive compositing and all electrical blur', () => {
  for (const definition of [ELECTRIC_ARC_EFFECT_DEFINITION, LIGHTNING_EFFECT_DEFINITION]) {
    const operations = render(definition, frame, { ...params, highContrast: true }).operations;
    assert.equal(
      operations.some(([operation, value]) => operation === 'globalCompositeOperation' && value === 'lighter'),
      false,
    );
    assert.equal(
      operations.some(([operation, value]) => operation === 'shadowBlur' && value > 0),
      false,
    );
    assert.ok(operations.some(([operation, value]) => operation === 'shadowColor' && value === 'transparent'));
  }
});

check('reduced motion is a fixed time-independent electrical sculpture', () => {
  const reduced = { amplitudeMode: 'preview', reduceMotion: true };
  for (const definition of [ELECTRIC_ARC_EFFECT_DEFINITION, LIGHTNING_EFFECT_DEFINITION]) {
    const first = render(definition, { ...frame, timeMs: 1000 }, params, reduced, definition.create(), 0.1).operations;
    const second = render(definition, { ...frame, timeMs: 9000 }, params, reduced, definition.create(), 0.1).operations;
    assert.deepEqual(first, second);
  }
});

check('long-running route churn remains finite and bounded without growing state', () => {
  const corona = ELECTRIC_ARC_EFFECT_DEFINITION.create();
  const lightning = LIGHTNING_EFFECT_DEFINITION.create();
  for (let index = 0; index < 180; index += 1) {
    const inputFrame = { ...frame, timeMs: 1000 + index * 100, transient: index % 17 === 0 };
    const coronaOps = render(
      ELECTRIC_ARC_EFFECT_DEFINITION,
      inputFrame,
      params,
      captureEnvironment,
      corona,
      0.1,
    ).operations;
    const lightningOps = render(
      LIGHTNING_EFFECT_DEFINITION,
      inputFrame,
      params,
      captureEnvironment,
      lightning,
      0.1,
    ).operations;
    assert.ok(paintOperations(coronaOps).length <= ELECTRIC_ARC_MAX_ELEMENTS);
    assert.ok(paintOperations(lightningOps).length <= LIGHTNING_MAX_ELEMENTS);
    assert.equal(numericValuesAreFinite(coronaOps), true);
    assert.equal(numericValuesAreFinite(lightningOps), true);
  }
});

console.log(`\n${checks}/${checks} checks passed.`);
rmSync(outdir, { recursive: true, force: true });
