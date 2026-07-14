// v6.0 Phase 2 — registry-native Radial Spectrum + first non-linear coordinate helpers.
//
//   Run: node scripts/test-radial-spectrum.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-radial-spectrum-'));
const outfile = join(outdir, 'radial-spectrum.mjs');

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
      "export * from './src/theme/audio-reactive/spectra/index.ts';",
    ].join('\n'),
    loader: 'ts',
    resolveDir: root,
    sourcefile: 'radial-spectrum-test-entry.ts',
  },
});

const {
  RADIAL_MAX_SEGMENTS,
  RADIAL_MIN_SEGMENTS,
  RADIAL_SPECTRUM_ID,
  RADIAL_SPECTRUM_VISUAL_DEFINITION,
  getAudioVisualDefinition,
  mapRadialSegment,
  polarToCartesian,
  registerCoreSpectrumVisuals,
  resolveRadialBandIndex,
  resolveRadialSegmentCount,
} = await import(pathToFileURL(outfile).href);

const canvas = { width: 640, height: 360 };
const params = {
  sensitivity: 0.55,
  intensity: 0.62,
  smoothing: 0.56,
  color: ['#414487', '#2a788e', '#22a884', '#fde725'],
  density: 0.55,
  layoutMode: 'radial',
  highContrast: false,
  afterimageStrength: 0.34,
};
const environment = {
  alignment: 'center',
  amplitudeMode: 'preview',
  reduceMotion: false,
  bars: { width: 12, spacing: 5, cornerRadius: 6, glow: 22 },
  colors: { bar: '#00e5ff', glow: '#ffffff' },
};
const frame = {
  energy: 0.32,
  bands: Array.from({ length: 32 }, (_, index) => ((index * 11) % 31) / 31),
  timeMs: 1000,
  transient: false,
};

function createContext() {
  const operations = [];
  const state = {};
  let path = [];
  const ctx = {
    operations,
    beginPath() { path = []; operations.push(['beginPath']); },
    moveTo(x, y) { path.push(['moveTo', x, y]); operations.push(['moveTo', x, y]); },
    lineTo(x, y) { path.push(['lineTo', x, y]); operations.push(['lineTo', x, y]); },
    closePath() { path.push(['closePath']); operations.push(['closePath']); },
    arc(...args) { path.push(['arc', ...args]); operations.push(['arc', ...args]); },
    stroke() {
      operations.push([
        'stroke', state.strokeStyle, state.lineWidth, state.globalAlpha, state.shadowBlur,
        path.map((entry) => [...entry]),
      ]);
    },
    fill() { operations.push(['fill', state.fillStyle, state.globalAlpha, path.map((entry) => [...entry])]); },
  };
  for (const property of [
    'fillStyle', 'strokeStyle', 'lineWidth', 'lineCap',
    'globalAlpha', 'shadowColor', 'shadowBlur',
  ]) {
    Object.defineProperty(ctx, property, {
      get() { return state[property]; },
      set(value) { state[property] = value; operations.push([property, value]); },
    });
  }
  return ctx;
}

function renderRadial(
  inputFrame = frame,
  inputEnvironment = environment,
  inputParams = params,
  instance = RADIAL_SPECTRUM_VISUAL_DEFINITION.create(),
  dt,
) {
  const ctx = createContext();
  if (dt !== undefined) instance.update(inputFrame, dt);
  instance.render(ctx, canvas, inputFrame, inputParams, { spectrum: inputEnvironment });
  return { ctx, instance };
}

function bodyStrokes(operations, width = 2.25) {
  return operations.filter(([operation, , lineWidth]) => operation === 'stroke' && lineWidth === width);
}

function bodyRadii(operations, width = 2.25) {
  return bodyStrokes(operations, width).map((operation) => {
    const line = operation[5].find(([name]) => name === 'lineTo');
    return Math.hypot((line?.[1] ?? 320) - 320, (line?.[2] ?? 180) - 180);
  });
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function approximately(actual, expected, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} ≈ ${expected}`);
}

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

console.log('Radial spectrum');

check('definition is a capped, registry-native polar spectrum', () => {
  assert.deepEqual(
    [
      RADIAL_SPECTRUM_VISUAL_DEFINITION.id,
      RADIAL_SPECTRUM_VISUAL_DEFINITION.label,
      RADIAL_SPECTRUM_VISUAL_DEFINITION.family,
      RADIAL_SPECTRUM_VISUAL_DEFINITION.maxElements,
    ],
    [RADIAL_SPECTRUM_ID, 'Radial Spectrum', 'polar-spectrum', RADIAL_MAX_SEGMENTS],
  );
  const visual = RADIAL_SPECTRUM_VISUAL_DEFINITION.create();
  assert.deepEqual(visual.supportedLayouts, ['radial']);
  assert.equal(visual.wants.bands, true);
  assert.equal(visual.supportsAfterimage, true);
  registerCoreSpectrumVisuals();
  registerCoreSpectrumVisuals();
  assert.equal(
    getAudioVisualDefinition('spectrum', RADIAL_SPECTRUM_ID),
    RADIAL_SPECTRUM_VISUAL_DEFINITION,
  );
});

check('polar helpers share one guarded canvas-angle convention', () => {
  assert.deepEqual(polarToCartesian(10, 20, 5, 0), { x: 15, y: 20 });
  const top = mapRadialSegment(0, 4, 10, 20, 5);
  approximately(top.x, 10);
  approximately(top.y, 15);
  const right = mapRadialSegment(1, 4, 10, 20, 5);
  approximately(right.x, 15);
  approximately(right.y, 20);
  assert.deepEqual(mapRadialSegment(5, 4, 10, 20, 5), right);
  assert.deepEqual(polarToCartesian(Number.NaN, 20, -5, Number.NaN), { x: 0, y: 20 });
});

check('density stays even and capped while band indices mirror exactly', () => {
  assert.equal(resolveRadialSegmentCount(-1), RADIAL_MIN_SEGMENTS);
  assert.equal(resolveRadialSegmentCount(1), RADIAL_MAX_SEGMENTS);
  assert.equal(resolveRadialSegmentCount(4), RADIAL_MAX_SEGMENTS);
  for (const density of [0, 0.2, 0.5, 0.8, 1]) {
    assert.equal(resolveRadialSegmentCount(density) % 2, 0);
  }
  assert.equal(resolveRadialBandIndex(0, 64), 0);
  assert.equal(resolveRadialBandIndex(63, 64), 0);
  assert.equal(resolveRadialBandIndex(31, 64), 31);
  assert.equal(resolveRadialBandIndex(32, 64), 31);
});

check('preview and capture match at full scale while capture silence contracts', () => {
  const fullScale = { ...frame, energy: 0.32, bands: Array(32).fill(1) };
  const preview = renderRadial(fullScale).ctx.operations;
  const capture = renderRadial(fullScale, { ...environment, amplitudeMode: 'capture' }).ctx.operations;
  assert.deepEqual(capture, preview);

  const nearSilent = renderRadial(
    { ...fullScale, energy: 0.002 },
    { ...environment, amplitudeMode: 'capture' },
  ).ctx.operations;
  assert.ok(average(bodyRadii(nearSilent)) < average(bodyRadii(capture)));
});

check('smoothing and the bounded radial trail retain a decaying loud envelope', () => {
  const loud = { ...frame, energy: 1, bands: Array(32).fill(1) };
  const quiet = { ...frame, energy: 0, bands: Array(32).fill(0) };
  const visual = RADIAL_SPECTRUM_VISUAL_DEFINITION.create();
  renderRadial(loud, environment, params, visual, 0);
  const decay = renderRadial(quiet, environment, params, visual, 0.1).ctx.operations;
  assert.ok(bodyRadii(decay).some((radius) => radius > 62));
  assert.ok(decay.some(([operation, , lineWidth]) => operation === 'stroke' && lineWidth === 1.5));

  const noTrailVisual = RADIAL_SPECTRUM_VISUAL_DEFINITION.create();
  const noTrailParams = { ...params, afterimageStrength: 0 };
  renderRadial(loud, environment, noTrailParams, noTrailVisual, 0);
  const noTrail = renderRadial(quiet, environment, noTrailParams, noTrailVisual, 0.1).ctx.operations;
  assert.equal(
    noTrail.filter(([operation, , lineWidth]) => operation === 'stroke' && lineWidth === 1.5).length,
    0,
  );
});

check('reduced motion ignores FFT rearrangement and removes glow/trails', () => {
  const reduced = { ...environment, reduceMotion: true };
  const ascending = { ...frame, bands: Array.from({ length: 32 }, (_, index) => index / 31) };
  const descending = { ...frame, bands: [...ascending.bands].reverse() };
  const first = renderRadial(ascending, reduced).ctx.operations;
  const second = renderRadial(descending, reduced).ctx.operations;
  assert.deepEqual(first, second);
  assert.equal(first.some(([operation, , , , shadowBlur]) => operation === 'stroke' && shadowBlur > 0), false);
  assert.equal(first.some(([operation, , lineWidth]) => operation === 'stroke' && lineWidth === 1.5), false);
});

check('High Contrast removes soft passes and thickens every reactive spoke', () => {
  const contrasted = renderRadial(frame, environment, { ...params, highContrast: true }).ctx.operations;
  assert.equal(
    contrasted.some(([operation, , , , shadowBlur]) => operation === 'stroke' && shadowBlur > 0),
    false,
  );
  const bodies = bodyStrokes(contrasted, 4);
  assert.equal(bodies.length, resolveRadialSegmentCount(params.density));
  assert.deepEqual([...new Set(bodies.map((operation) => operation[1]))], ['#feef71']);
  assert.equal(contrasted.some(([operation, , lineWidth]) => operation === 'stroke' && lineWidth === 1.5), false);
});

check('band weighting changes radial reach without changing segment density', () => {
  const bassFrame = {
    ...frame,
    bands: Array.from({ length: 32 }, (_, index) => (index < 11 ? 0.8 : 0.04)),
  };
  const muted = renderRadial(bassFrame, environment, { ...params, bassWeight: 0 }).ctx.operations;
  const boosted = renderRadial(bassFrame, environment, { ...params, bassWeight: 2 }).ctx.operations;
  assert.ok(average(bodyRadii(boosted)) > average(bodyRadii(muted)));
  assert.equal(bodyStrokes(muted).length, bodyStrokes(boosted).length);
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-radial-spectrum: ${checks} checks passed`);
