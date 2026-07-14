// v6.0 Phase 2 — registry-native Central Pulse + consumed centered/flow-field helpers.
//
//   Run: node scripts/test-central-pulse-spectrum.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-central-pulse-'));
const outfile = join(outdir, 'central-pulse.mjs');

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
    sourcefile: 'central-pulse-test-entry.ts',
  },
});

const {
  CENTRAL_PULSE_ID,
  CENTRAL_PULSE_MAX_ECHO_RINGS,
  CENTRAL_PULSE_MAX_ELEMENTS,
  CENTRAL_PULSE_MAX_POINTS,
  CENTRAL_PULSE_MIN_POINTS,
  CENTRAL_PULSE_VISUAL_DEFINITION,
  getAudioVisualDefinition,
  mapCenteredContourPoint,
  registerCoreSpectrumVisuals,
  resolveCentralPulseEchoCount,
  resolveCentralPulsePointCount,
  resolveCenteredOrigin,
  sampleLayeredFlowField,
} = await import(pathToFileURL(outfile).href);

const canvas = { width: 640, height: 360 };
const params = {
  sensitivity: 0.58,
  intensity: 0.62,
  smoothing: 0.48,
  color: ['#2a788e', '#22a884', '#7ad151', '#fde725'],
  density: 0.52,
  layoutMode: 'centered',
  highContrast: false,
  afterimageStrength: 0.42,
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
    fill() {
      operations.push(['fill', state.fillStyle, state.globalAlpha, path.map((entry) => [...entry])]);
    },
    createRadialGradient(...args) {
      const gradient = {
        __gradient: true,
        args,
        stops: [],
        addColorStop(offset, color) {
          gradient.stops.push([offset, color]);
          operations.push(['addColorStop', offset, color]);
        },
      };
      operations.push(['createRadialGradient', ...args]);
      return gradient;
    },
  };
  for (const property of [
    'fillStyle', 'strokeStyle', 'lineWidth', 'lineCap',
    'globalAlpha', 'shadowColor', 'shadowBlur',
  ]) {
    Object.defineProperty(ctx, property, {
      get() { return state[property]; },
      set(value) {
        state[property] = value?.__gradient
          ? { type: 'radial-gradient', args: [...value.args], stops: value.stops.map((stop) => [...stop]) }
          : value;
        operations.push([property, state[property]]);
      },
    });
  }
  return ctx;
}

function renderCentral(
  inputFrame = frame,
  inputEnvironment = environment,
  inputParams = params,
  instance = CENTRAL_PULSE_VISUAL_DEFINITION.create(),
  dt,
) {
  const ctx = createContext();
  if (dt !== undefined) instance.update(inputFrame, dt);
  instance.render(ctx, canvas, inputFrame, inputParams, { spectrum: inputEnvironment });
  return { ctx, instance };
}

function strokesWithWidth(operations, width) {
  return operations.filter(([operation, , lineWidth]) => operation === 'stroke' && lineWidth === width);
}

function averageContourRadius(operations, width, centerX = 320, centerY = 180) {
  const stroke = strokesWithWidth(operations, width)[0];
  const points = (stroke?.[5] ?? []).filter(([operation]) => operation === 'moveTo' || operation === 'lineTo');
  return points.reduce(
    (sum, [, x, y]) => sum + Math.hypot(x - centerX, y - centerY),
    0,
  ) / Math.max(1, points.length);
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

console.log('Central Pulse spectrum');

check('definition is a capped, registry-native centered organic spectrum', () => {
  assert.deepEqual(
    [
      CENTRAL_PULSE_VISUAL_DEFINITION.id,
      CENTRAL_PULSE_VISUAL_DEFINITION.label,
      CENTRAL_PULSE_VISUAL_DEFINITION.family,
      CENTRAL_PULSE_VISUAL_DEFINITION.maxElements,
    ],
    [CENTRAL_PULSE_ID, 'Central Pulse', 'organic-spectrum', CENTRAL_PULSE_MAX_ELEMENTS],
  );
  assert.equal(CENTRAL_PULSE_MAX_ELEMENTS, CENTRAL_PULSE_MAX_POINTS * (1 + CENTRAL_PULSE_MAX_ECHO_RINGS));
  const visual = CENTRAL_PULSE_VISUAL_DEFINITION.create();
  assert.deepEqual(visual.supportedLayouts, ['centered']);
  assert.equal(visual.wants.bands, true);
  assert.equal(visual.supportsAfterimage, true);
  registerCoreSpectrumVisuals();
  registerCoreSpectrumVisuals();
  assert.equal(getAudioVisualDefinition('spectrum', CENTRAL_PULSE_ID), CENTRAL_PULSE_VISUAL_DEFINITION);
});

check('centered helpers guard the origin, bias, and displaced contour radius', () => {
  assert.deepEqual(resolveCenteredOrigin(640, 360), { x: 320, y: 180 });
  assert.deepEqual(resolveCenteredOrigin(640, 360, -0.2), { x: 320, y: 144 });
  assert.deepEqual(resolveCenteredOrigin(640, 360, 4), { x: 320, y: 360 });
  const top = mapCenteredContourPoint(0, 4, 10, 20, 5, 2);
  approximately(top.x, 10);
  approximately(top.y, 13);
  assert.deepEqual(mapCenteredContourPoint(0, 4, 10, 20, 5, -20), {
    x: 10,
    y: 20,
    angle: -Math.PI / 2,
  });
});

check('layered flow field is deterministic, finite, bounded, and parameter-sensitive', () => {
  const first = sampleLayeredFlowField(0.4, -0.7, 1.25, { complexity: 0.6, speed: 1.1, seed: 29 });
  const second = sampleLayeredFlowField(0.4, -0.7, 1.25, { complexity: 0.6, speed: 1.1, seed: 29 });
  assert.equal(first, second);
  assert.ok(first >= -1 && first <= 1);
  assert.notEqual(first, sampleLayeredFlowField(0.4, -0.7, 2.25, { complexity: 0.6, speed: 1.1, seed: 29 }));
  assert.notEqual(first, sampleLayeredFlowField(0.4, -0.7, 1.25, { complexity: 0.1, speed: 1.1, seed: 29 }));
  assert.ok(Number.isFinite(sampleLayeredFlowField(Number.NaN, Infinity, Number.NaN)));
});

check('density and afterimage controls remain within even point and echo caps', () => {
  assert.equal(resolveCentralPulsePointCount(-1), CENTRAL_PULSE_MIN_POINTS);
  assert.equal(resolveCentralPulsePointCount(1), CENTRAL_PULSE_MAX_POINTS);
  assert.equal(resolveCentralPulsePointCount(8), CENTRAL_PULSE_MAX_POINTS);
  for (const density of [0, 0.2, 0.5, 0.8, 1]) {
    assert.equal(resolveCentralPulsePointCount(density) % 2, 0);
  }
  assert.equal(resolveCentralPulseEchoCount(0), 0);
  assert.equal(resolveCentralPulseEchoCount(0.05), 1);
  assert.equal(resolveCentralPulseEchoCount(0.4), 2);
  assert.equal(resolveCentralPulseEchoCount(1), CENTRAL_PULSE_MAX_ECHO_RINGS);

  const maxDensity = renderCentral(frame, environment, {
    ...params,
    density: 1,
    highContrast: true,
  }).ctx.operations;
  const body = strokesWithWidth(maxDensity, 4)[0];
  const points = body[5].filter(([operation]) => operation === 'moveTo' || operation === 'lineTo');
  assert.equal(points.length, CENTRAL_PULSE_MAX_POINTS);
});

check('preview and capture match at full scale while capture silence contracts', () => {
  const fullScale = { ...frame, energy: 0.32, bands: Array(32).fill(1) };
  const preview = renderCentral(fullScale).ctx.operations;
  const capture = renderCentral(fullScale, { ...environment, amplitudeMode: 'capture' }).ctx.operations;
  assert.deepEqual(capture, preview);

  const nearSilent = renderCentral(
    { ...fullScale, energy: 0.002 },
    { ...environment, amplitudeMode: 'capture' },
  ).ctx.operations;
  assert.ok(averageContourRadius(nearSilent, 2.4) < averageContourRadius(capture, 2.4));
});

check('Pulse Speed changes the contour and echo envelopes decay without retained pixels', () => {
  const slow = renderCentral(frame, environment, { ...params, smoothing: 0 }).ctx.operations;
  const fast = renderCentral(frame, environment, { ...params, smoothing: 1 }).ctx.operations;
  assert.notDeepEqual(strokesWithWidth(slow, 2.4)[0][5], strokesWithWidth(fast, 2.4)[0][5]);

  const loud = { ...frame, energy: 1, bands: Array(32).fill(1), timeMs: 0 };
  const quiet = { ...frame, energy: 0, bands: Array(32).fill(0), timeMs: 100 };
  const visual = CENTRAL_PULSE_VISUAL_DEFINITION.create();
  renderCentral(loud, environment, params, visual, 0);
  const decaying = renderCentral(quiet, environment, params, visual, 0.1).ctx.operations;
  const settledQuiet = renderCentral(quiet).ctx.operations;
  assert.ok(averageContourRadius(decaying, 2.4) > averageContourRadius(settledQuiet, 2.4));
  assert.equal(strokesWithWidth(decaying, 1.5).length, resolveCentralPulseEchoCount(params.afterimageStrength));
});

check('reduced motion fixes the silhouette across FFT order and time while suppressing soft motion', () => {
  const reduced = { ...environment, reduceMotion: true };
  const ascending = {
    ...frame,
    timeMs: 100,
    bands: Array.from({ length: 32 }, (_, index) => index / 31),
  };
  const descending = { ...frame, timeMs: 4000, bands: [...ascending.bands].reverse() };
  const first = renderCentral(ascending, reduced).ctx.operations;
  const second = renderCentral(descending, reduced).ctx.operations;
  assert.deepEqual(first, second);
  assert.equal(strokesWithWidth(first, 1.5).length, 0);
  assert.equal(first.some(([operation, , , , shadowBlur]) => operation === 'stroke' && shadowBlur > 0), false);
  assert.equal(strokesWithWidth(first, 3).length, 1);
});

check('High Contrast removes gradients, glow, and echoes while brightening the structure', () => {
  const contrasted = renderCentral(frame, environment, { ...params, highContrast: true }).ctx.operations;
  assert.equal(contrasted.some(([operation]) => operation === 'createRadialGradient'), false);
  assert.equal(strokesWithWidth(contrasted, 1.5).length, 0);
  assert.equal(contrasted.some(([operation, , , , shadowBlur]) => operation === 'stroke' && shadowBlur > 0), false);
  const bodies = strokesWithWidth(contrasted, 4);
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0][1], '#feef6b');
});

check('band weighting changes the whole-orb response without changing contour density', () => {
  const bassFrame = {
    ...frame,
    bands: Array.from({ length: 32 }, (_, index) => (index < 11 ? 0.82 : 0.02)),
  };
  const muted = renderCentral(bassFrame, environment, { ...params, bassWeight: 0 }).ctx.operations;
  const boosted = renderCentral(bassFrame, environment, { ...params, bassWeight: 2 }).ctx.operations;
  assert.ok(averageContourRadius(boosted, 2.4) > averageContourRadius(muted, 2.4));
  assert.equal(strokesWithWidth(muted, 2.4)[0][5].length, strokesWithWidth(boosted, 2.4)[0][5].length);
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-central-pulse-spectrum: ${checks} checks passed`);
