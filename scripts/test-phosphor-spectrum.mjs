// v6.0 Phase 2 — registry-native Phosphor segmented spectrum.
//
//   Run: node scripts/test-phosphor-spectrum.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-phosphor-spectrum-'));
const outfile = join(outdir, 'phosphor-spectrum.mjs');

await build({
  absWorkingDir: root,
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'silent',
  stdin: {
    contents: [
      "export { getAudioVisualDefinition } from './src/theme/audio-reactive/index.ts';",
      "export * from './src/theme/audio-reactive/spectra/index.ts';",
    ].join('\n'),
    loader: 'ts',
    resolveDir: root,
    sourcefile: 'phosphor-spectrum-test-entry.ts',
  },
});

const {
  PHOSPHOR_MAX_COLUMNS,
  PHOSPHOR_MAX_ROWS,
  PHOSPHOR_MAX_SEGMENTS,
  PHOSPHOR_MIN_COLUMNS,
  PHOSPHOR_MIN_ROWS,
  PHOSPHOR_SPECTRUM_ID,
  PHOSPHOR_VISUAL_DEFINITION,
  getAudioVisualDefinition,
  registerCoreSpectrumVisuals,
  resolvePhosphorGrid,
} = await import(pathToFileURL(outfile).href);

const canvas = { width: 640, height: 360 };
const params = {
  sensitivity: 0.55,
  intensity: 0.6,
  smoothing: 0.68,
  color: ['#79ff98', '#efffe8'],
  density: 0.52,
  highContrast: false,
  afterimageStrength: 0.58,
};
const environment = {
  alignment: 'bottom',
  amplitudeMode: 'preview',
  reduceMotion: false,
  bars: { width: 12, spacing: 5, cornerRadius: 6, glow: 22 },
  colors: { bar: '#00e5ff', glow: '#ffffff44' },
};
const frame = {
  energy: 0.32,
  bands: Array.from({ length: 32 }, (_, index) => ((index * 11) % 31) / 31),
  timeMs: 1000,
  transient: false,
};

function createContext() {
  const operations = [];
  const state = { fillStyle: undefined, globalAlpha: undefined };
  const ctx = {
    operations,
    fillRect(...args) {
      operations.push(['fillRect', ...args, state.fillStyle, state.globalAlpha]);
    },
  };
  for (const property of ['fillStyle', 'globalAlpha', 'shadowColor', 'shadowBlur']) {
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

function renderPhosphor(
  inputFrame = frame,
  inputEnvironment = environment,
  inputParams = params,
  instance = PHOSPHOR_VISUAL_DEFINITION.create(),
  dt,
) {
  const ctx = createContext();
  if (dt !== undefined) instance.update(inputFrame, dt);
  instance.render(ctx, canvas, inputFrame, inputParams, { spectrum: inputEnvironment });
  return { ctx, instance };
}

function rectsWithStyle(operations, style) {
  return operations.filter(
    ([operation, _x, _y, _width, _height, fillStyle]) => operation === 'fillRect' && fillStyle === style,
  );
}

function litRects(operations) {
  return rectsWithStyle(operations, '#79ff98');
}

function unlitRects(operations) {
  const firstRect = operations.find(([operation]) => operation === 'fillRect');
  return firstRect ? rectsWithStyle(operations, firstRect[5]) : [];
}

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

console.log('Phosphor spectrum');

check('definition is a capped, registry-native linear segmented spectrum', () => {
  assert.deepEqual(
    [
      PHOSPHOR_VISUAL_DEFINITION.id,
      PHOSPHOR_VISUAL_DEFINITION.label,
      PHOSPHOR_VISUAL_DEFINITION.family,
      PHOSPHOR_VISUAL_DEFINITION.maxElements,
    ],
    [PHOSPHOR_SPECTRUM_ID, 'Phosphor', 'segmented-spectrum', 240],
  );
  const visual = PHOSPHOR_VISUAL_DEFINITION.create();
  assert.deepEqual(visual.supportedLayouts, ['linear']);
  assert.equal(visual.wants.bands, true);
  assert.equal(visual.supportsAfterimage, true);
  registerCoreSpectrumVisuals();
  registerCoreSpectrumVisuals();
  assert.equal(getAudioVisualDefinition('spectrum', PHOSPHOR_SPECTRUM_ID), PHOSPHOR_VISUAL_DEFINITION);
});

check('density clamps grain to a 12×6–24×10 grid beneath the hard segment cap', () => {
  assert.deepEqual(resolvePhosphorGrid(-1), {
    columns: PHOSPHOR_MIN_COLUMNS,
    rows: PHOSPHOR_MIN_ROWS,
    segments: PHOSPHOR_MIN_COLUMNS * PHOSPHOR_MIN_ROWS,
  });
  assert.deepEqual(resolvePhosphorGrid(1), {
    columns: PHOSPHOR_MAX_COLUMNS,
    rows: PHOSPHOR_MAX_ROWS,
    segments: PHOSPHOR_MAX_SEGMENTS,
  });
  assert.deepEqual(resolvePhosphorGrid(4), resolvePhosphorGrid(1));

  const maxGrid = resolvePhosphorGrid(1);
  const quiet = renderPhosphor(
    { ...frame, energy: 0, bands: Array(32).fill(0) },
    { ...environment, reduceMotion: true },
    { ...params, density: 1 },
  ).ctx.operations;
  const matrixRects = quiet.filter(([operation]) => operation === 'fillRect');
  assert.equal(matrixRects.length, maxGrid.segments + maxGrid.rows - 1);
});

check('preview and capture match at full scale while capture silence remains dark', () => {
  const fullScaleFrame = { ...frame, energy: 0.32, bands: Array(32).fill(1) };
  const preview = renderPhosphor(fullScaleFrame).ctx.operations;
  const capture = renderPhosphor(fullScaleFrame, {
    ...environment,
    amplitudeMode: 'capture',
  }).ctx.operations;
  assert.deepEqual(capture, preview);

  const nearSilentCapture = renderPhosphor(
    { ...fullScaleFrame, energy: 0.002 },
    { ...environment, amplitudeMode: 'capture' },
  ).ctx.operations;
  assert.ok(litRects(nearSilentCapture).length < litRects(capture).length);
});

check('fast attack and slow decay create bounded phosphor persistence', () => {
  const quiet = { ...frame, energy: 0, bands: Array(32).fill(0), timeMs: 0 };
  const loud = { ...frame, energy: 1, bands: Array(32).fill(1), timeMs: 1000 / 24 };

  const attackVisual = PHOSPHOR_VISUAL_DEFINITION.create();
  renderPhosphor(quiet, environment, params, attackVisual, 0);
  const attacking = renderPhosphor(loud, environment, params, attackVisual, 1 / 24).ctx.operations;
  const settledLoud = renderPhosphor(loud).ctx.operations;
  assert.ok(litRects(attacking).length > 0);
  assert.ok(litRects(attacking).length < litRects(settledLoud).length);

  const decayVisual = PHOSPHOR_VISUAL_DEFINITION.create();
  renderPhosphor(loud, environment, params, decayVisual, 0);
  const decaying = renderPhosphor(quiet, environment, params, decayVisual, 1 / 24).ctx.operations;
  const settledQuiet = renderPhosphor(quiet).ctx.operations;
  assert.ok(litRects(decaying).length > litRects(settledQuiet).length);
});

check('reduced motion fixes the silhouette and suppresses chromatic movement', () => {
  const reducedEnvironment = { ...environment, reduceMotion: true };
  const ascending = { ...frame, bands: Array.from({ length: 32 }, (_, index) => index / 31) };
  const descending = { ...frame, bands: [...ascending.bands].reverse() };
  const first = renderPhosphor(ascending, reducedEnvironment).ctx.operations;
  const second = renderPhosphor(descending, reducedEnvironment).ctx.operations;
  assert.deepEqual(first, second);
  assert.equal(rectsWithStyle(first, 'rgba(255, 70, 92, 0.72)').length, 0);
  assert.equal(rectsWithStyle(first, 'rgba(54, 188, 255, 0.68)').length, 0);
});

check('High Contrast removes RGB/scanline haze and doubles the bevel edge', () => {
  const relaxed = renderPhosphor(frame).ctx.operations;
  assert.ok(rectsWithStyle(relaxed, 'rgba(255, 70, 92, 0.72)').length > 0);
  assert.ok(rectsWithStyle(relaxed, 'rgba(0, 0, 0, 0.24)').length > 0);
  assert.ok(rectsWithStyle(relaxed, '#efffe8').some((rectangle) => rectangle[4] === 1));

  const contrasted = renderPhosphor(frame, environment, {
    ...params,
    highContrast: true,
  }).ctx.operations;
  assert.equal(rectsWithStyle(contrasted, 'rgba(255, 70, 92, 0.72)').length, 0);
  assert.equal(rectsWithStyle(contrasted, 'rgba(0, 0, 0, 0.24)').length, 0);
  assert.ok(rectsWithStyle(contrasted, '#efffe8').some((rectangle) => rectangle[4] === 2));
});

check('band weighting changes the intended region without changing grid density', () => {
  const bassFrame = {
    ...frame,
    bands: Array.from({ length: 32 }, (_, index) => (index < 11 ? 0.8 : 0.08)),
  };
  const muted = renderPhosphor(bassFrame, environment, {
    ...params,
    bassWeight: 0,
  }).ctx.operations;
  const boosted = renderPhosphor(bassFrame, environment, {
    ...params,
    bassWeight: 2,
  }).ctx.operations;
  assert.ok(litRects(boosted).length > litRects(muted).length);
  const segmentCount = resolvePhosphorGrid(params.density).segments;
  assert.equal(unlitRects(muted).length, segmentCount);
  assert.equal(unlitRects(boosted).length, segmentCount);
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-phosphor-spectrum: ${checks} checks passed`);
