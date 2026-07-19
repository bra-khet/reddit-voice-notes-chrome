// v6.0 Phase 2 — registry-native Minimal accessibility spectrum.
//
//   Run: node scripts/test-minimal-spectrum.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-minimal-spectrum-'));
const outfile = join(outdir, 'minimal-spectrum.mjs');

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
    sourcefile: 'minimal-spectrum-test-entry.ts',
  },
});

const {
  MINIMAL_MAX_BAR_COUNT,
  MINIMAL_MIN_BAR_COUNT,
  MINIMAL_SPECTRUM_ID,
  MINIMAL_VISUAL_DEFINITION,
  getAudioVisualDefinition,
  registerCoreSpectrumVisuals,
  resolveMinimalBarCount,
  resolveMinimalContrastColor,
} = await import(pathToFileURL(outfile).href);

const canvas = { width: 640, height: 360 };
const params = {
  sensitivity: 0.5,
  intensity: 0.5,
  smoothing: 0.72,
  color: ['#00e5ff', '#ffffff'],
  density: 0.35,
  highContrast: true,
};
const environment = {
  alignment: 'center',
  amplitudeMode: 'preview',
  reduceMotion: false,
  bars: { width: 12, spacing: 5, cornerRadius: 6, glow: 22 },
  colors: { bar: '#00e5ff', glow: '#ffffff44' },
};
const frame = {
  energy: 0.32,
  bands: Array.from({ length: 32 }, (_, index) => ((index * 11) % 31) / 31),
  timeMs: 1000,
};

function createContext() {
  const operations = [];
  const ctx = {
    operations,
    fillRect(...args) { operations.push(['fillRect', ...args]); },
  };
  for (const property of ['fillStyle', 'globalAlpha', 'shadowColor', 'shadowBlur']) {
    Object.defineProperty(ctx, property, {
      get() { return undefined; },
      set(value) { operations.push([property, value]); },
    });
  }
  return ctx;
}

function renderMinimal(
  inputFrame = frame,
  inputEnvironment = environment,
  inputParams = params,
  instance = MINIMAL_VISUAL_DEFINITION.create(),
  dt,
) {
  const ctx = createContext();
  if (dt !== undefined) instance.update(inputFrame, dt);
  instance.render(ctx, canvas, inputFrame, inputParams, { spectrum: inputEnvironment });
  return { ctx, instance };
}

function bodyRects(operations, barCount) {
  return operations.filter(([operation]) => operation === 'fillRect').slice(1, barCount + 1);
}

function totalBodyHeight(operations, barCount) {
  return bodyRects(operations, barCount).reduce((sum, rectangle) => sum + rectangle[4], 0);
}

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

console.log('Minimal spectrum');

check('definition is a low-density, capped linear accessibility spectrum', () => {
  assert.deepEqual(
    [
      MINIMAL_VISUAL_DEFINITION.id,
      MINIMAL_VISUAL_DEFINITION.label,
      MINIMAL_VISUAL_DEFINITION.family,
      MINIMAL_VISUAL_DEFINITION.maxElements,
    ],
    [MINIMAL_SPECTRUM_ID, 'Minimal', 'accessible-spectrum', 16],
  );
  const visual = MINIMAL_VISUAL_DEFINITION.create();
  assert.deepEqual(visual.supportedLayouts, ['linear']);
  assert.equal(MINIMAL_VISUAL_DEFINITION.wants.bands, true);
  assert.equal(visual.supportsAfterimage, undefined);
  registerCoreSpectrumVisuals();
  registerCoreSpectrumVisuals();
  assert.equal(getAudioVisualDefinition('spectrum', MINIMAL_SPECTRUM_ID), MINIMAL_VISUAL_DEFINITION);
});

check('density clamps to 8–16 broad bars and never exceeds its registry cap', () => {
  assert.equal(resolveMinimalBarCount(-1), MINIMAL_MIN_BAR_COUNT);
  assert.equal(resolveMinimalBarCount(0.35), 11);
  assert.equal(resolveMinimalBarCount(1), MINIMAL_MAX_BAR_COUNT);
  assert.equal(resolveMinimalBarCount(4), MINIMAL_MAX_BAR_COUNT);

  const operations = renderMinimal(frame, environment, { ...params, density: 1 }).ctx.operations;
  const fillRects = operations.filter(([operation]) => operation === 'fillRect');
  assert.equal(fillRects.length, 1 + 16 + 16 * 2);
});

check('preview and capture emit identical geometry for an already full-scale frame', () => {
  const fullScaleFrame = {
    ...frame,
    bands: frame.bands.with(31, 1),
  };
  const preview = renderMinimal(fullScaleFrame).ctx.operations;
  const capture = renderMinimal(fullScaleFrame, {
    ...environment,
    amplitudeMode: 'capture',
  }).ctx.operations;
  assert.deepEqual(capture, preview);

  const barCount = resolveMinimalBarCount(params.density);
  const nearSilentCapture = renderMinimal(
    { ...fullScaleFrame, energy: 0.005 },
    { ...environment, amplitudeMode: 'capture' },
  ).ctx.operations;
  assert.ok(totalBodyHeight(nearSilentCapture, barCount) < totalBodyHeight(capture, barCount));
});

check('slow smoothing moves toward a new frame without snapping or overshooting', () => {
  const barCount = resolveMinimalBarCount(params.density);
  const quiet = { ...frame, bands: Array(32).fill(0), energy: 0, timeMs: 0 };
  const loud = { ...frame, bands: Array(32).fill(1), energy: 1, timeMs: 1000 / 24 };
  const visual = MINIMAL_VISUAL_DEFINITION.create();
  renderMinimal(quiet, environment, params, visual, 0);
  const eased = renderMinimal(loud, environment, params, visual, 1 / 24).ctx.operations;
  const settled = renderMinimal(loud, environment, params).ctx.operations;
  const quietHeight = barCount * 3;
  const easedHeight = totalBodyHeight(eased, barCount);
  const settledHeight = totalBodyHeight(settled, barCount);
  assert.ok(easedHeight > quietHeight);
  assert.ok(easedHeight < settledHeight);
});

check('reduced motion keeps a fixed silhouette independent of FFT rearrangement', () => {
  const reducedEnvironment = { ...environment, reduceMotion: true };
  const ascending = { ...frame, bands: Array.from({ length: 32 }, (_, index) => index / 31) };
  const descending = { ...frame, bands: [...ascending.bands].reverse() };
  assert.deepEqual(
    renderMinimal(ascending, reducedEnvironment).ctx.operations,
    renderMinimal(descending, reducedEnvironment).ctx.operations,
  );
});

check('high contrast enforces an opaque 3:1 tip pair while relaxed mode honors the palette', () => {
  assert.equal(resolveMinimalContrastColor('#ffffff', '#ffffff44'), '#000000');
  assert.equal(resolveMinimalContrastColor('#000000', '#ffffff44'), '#ffffff');

  const highContrast = renderMinimal(frame, {
    ...environment,
    colors: { bar: '#ffffff', glow: '#ffffff44' },
  }).ctx.operations;
  assert.ok(highContrast.some(([operation, value]) => operation === 'fillStyle' && value === '#000000'));

  // Relaxed caps derive from the bar color (lightened toward white) instead of the raw
  // glow token, which could be semi-transparent or clash with the scheme (QA §2b).
  const relaxed = renderMinimal(frame, environment, { ...params, highContrast: false }).ctx.operations;
  assert.equal(relaxed.some(([operation, value]) => operation === 'fillStyle' && value === '#ffffff44'), false);
  const accents = relaxed
    .filter(([operation, value]) => operation === 'fillStyle' && value !== environment.colors.bar)
    .map(([, value]) => value);
  assert.ok(accents.length > 0);
  assert.ok(accents.every((value) => /^#[0-9a-f]{6}$/i.test(value)));
});

check('band weighting changes the intended region without changing element count', () => {
  const bassFrame = {
    ...frame,
    bands: Array.from({ length: 32 }, (_, index) => (index < 11 ? 0.8 : 0.1)),
  };
  const muted = renderMinimal(bassFrame, environment, {
    ...params,
    bassWeight: 0,
  }).ctx.operations;
  const boosted = renderMinimal(bassFrame, environment, {
    ...params,
    bassWeight: 2,
  }).ctx.operations;
  const barCount = resolveMinimalBarCount(params.density);
  assert.ok(totalBodyHeight(boosted, barCount) > totalBodyHeight(muted, barCount));
  assert.equal(bodyRects(boosted, barCount).length, barCount);
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-minimal-spectrum: ${checks} checks passed`);
