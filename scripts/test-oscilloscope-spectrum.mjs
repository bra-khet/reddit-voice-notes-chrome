// v6.0 Phase 2 — waveform-on-demand Oscilloscope + bounded trace history.
//
//   Run: node scripts/test-oscilloscope-spectrum.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-oscilloscope-'));
const outfile = join(outdir, 'oscilloscope.mjs');

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
      "export { readAnalyserWaveformOnDemand } from './src/recorder/waveform.ts';",
    ].join('\n'),
    loader: 'ts',
    resolveDir: root,
    sourcefile: 'oscilloscope-test-entry.ts',
  },
});

const {
  OSCILLOSCOPE_MAX_ELEMENTS,
  OSCILLOSCOPE_MAX_HISTORY_FRAMES,
  OSCILLOSCOPE_MAX_TRACE_POINTS,
  OSCILLOSCOPE_MIN_TRACE_POINTS,
  OSCILLOSCOPE_SPECTRUM_ID,
  OSCILLOSCOPE_VISUAL_DEFINITION,
  buildAudioVizFrame,
  buildSyntheticAudioVizFrame,
  getAudioVisualDefinition,
  getAudioVisualWants,
  listAudioVisualDefinitions,
  readAnalyserWaveformOnDemand,
  registerCoreSpectrumVisuals,
  resolveOscilloscopeHistoryCount,
  resolveOscilloscopePointCount,
  sampleOscilloscopeTrace,
} = await import(pathToFileURL(outfile).href);

const canvas = { width: 640, height: 360 };
const params = {
  sensitivity: 0.58,
  intensity: 0.62,
  smoothing: 0.34,
  color: ['#38bdf8', '#a78bfa', '#f8fafc'],
  density: 0.48,
  layoutMode: 'linear',
  highContrast: false,
  afterimageStrength: 0.62,
};
const environment = {
  alignment: 'center',
  amplitudeMode: 'preview',
  reduceMotion: false,
  bars: { width: 12, spacing: 5, cornerRadius: 6, glow: 22 },
  colors: { bar: '#00e5ff', glow: '#ffffff' },
};

function makeWaveform(phase = 0, length = 2048) {
  return Float32Array.from({ length }, (_, index) => {
    const x = index / length;
    return Math.sin(x * Math.PI * 2 * 7 + phase) * 0.68
      + Math.sin(x * Math.PI * 2 * 15 - phase * 0.4) * 0.2;
  });
}

const frame = {
  energy: 0.34,
  bands: Array(32).fill(0),
  waveform: makeWaveform(),
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
    fillRect(...args) { operations.push(['fillRect', ...args, state.fillStyle, state.globalAlpha]); },
    stroke() {
      operations.push([
        'stroke',
        state.strokeStyle,
        state.lineWidth,
        state.globalAlpha,
        state.shadowBlur,
        path.map((entry) => [...entry]),
      ]);
    },
  };
  for (const property of [
    'fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin',
    'globalAlpha', 'shadowColor', 'shadowBlur',
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

function renderOscilloscope(
  inputFrame = frame,
  inputEnvironment = environment,
  inputParams = params,
  instance = OSCILLOSCOPE_VISUAL_DEFINITION.create(),
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

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

console.log('Oscilloscope spectrum');

check('definition is the sole waveform consumer and publishes a hard render cap', () => {
  assert.deepEqual(
    [
      OSCILLOSCOPE_VISUAL_DEFINITION.id,
      OSCILLOSCOPE_VISUAL_DEFINITION.label,
      OSCILLOSCOPE_VISUAL_DEFINITION.family,
      OSCILLOSCOPE_VISUAL_DEFINITION.maxElements,
    ],
    [OSCILLOSCOPE_SPECTRUM_ID, 'Oscilloscope', 'waveform-spectrum', OSCILLOSCOPE_MAX_ELEMENTS],
  );
  assert.equal(
    OSCILLOSCOPE_MAX_ELEMENTS,
    OSCILLOSCOPE_MAX_TRACE_POINTS * OSCILLOSCOPE_MAX_HISTORY_FRAMES,
  );
  assert.deepEqual(OSCILLOSCOPE_VISUAL_DEFINITION.wants, { waveform: true });
  assert.deepEqual(OSCILLOSCOPE_VISUAL_DEFINITION.create().supportedLayouts, ['linear', 'radial']);
  registerCoreSpectrumVisuals();
  registerCoreSpectrumVisuals();
  assert.equal(
    getAudioVisualDefinition('spectrum', OSCILLOSCOPE_SPECTRUM_ID),
    OSCILLOSCOPE_VISUAL_DEFINITION,
  );
  const waveformConsumers = listAudioVisualDefinitions('spectrum')
    .filter((definition) => getAudioVisualWants('spectrum', definition.id).waveform);
  assert.deepEqual(waveformConsumers.map(({ id }) => id), [OSCILLOSCOPE_SPECTRUM_ID]);
});

check('analyser time-domain reads happen only when registry metadata requests them', () => {
  let reads = 0;
  const analyser = {
    getByteTimeDomainData(target) {
      reads += 1;
      target.fill(192);
    },
  };
  const target = new Uint8Array(8);
  assert.equal(readAnalyserWaveformOnDemand(analyser, target, { bands: true }), undefined);
  assert.equal(reads, 0);
  assert.deepEqual([...target], Array(8).fill(0));
  assert.equal(readAnalyserWaveformOnDemand(analyser, target, { waveform: true }), target);
  assert.equal(reads, 1);
  assert.deepEqual([...target], Array(8).fill(192));
});

check('byte capture and synthetic preview normalize waveform data without leaking buffers', () => {
  const bytes = new Uint8Array([0, 64, 128, 192, 255]);
  const captured = buildAudioVizFrame({ waveformBytes: bytes });
  assert.deepEqual(
    [...captured.waveform],
    [-1, -0.5, 0, 0.5, 127 / 128],
  );
  bytes[0] = 128;
  assert.equal(captured.waveform[0], -1);

  const commonPreview = buildSyntheticAudioVizFrame([0.2, 0.8], 1000, 0.32);
  assert.equal(commonPreview.waveform, undefined);
  const scopePreview = buildSyntheticAudioVizFrame(
    [0.2, 0.8],
    1000,
    0.32,
    { waveform: true, waveformSampleCount: 64 },
  );
  const samePreview = buildSyntheticAudioVizFrame(
    [0.2, 0.8],
    1000,
    0.32,
    { waveform: true, waveformSampleCount: 64 },
  );
  const laterPreview = buildSyntheticAudioVizFrame(
    [0.2, 0.8],
    1800,
    0.32,
    { waveform: true, waveformSampleCount: 64 },
  );
  assert.equal(scopePreview.waveform.length, 64);
  assert.deepEqual(scopePreview.waveform, samePreview.waveform);
  assert.notDeepEqual(scopePreview.waveform, laterPreview.waveform);
  assert.ok([...scopePreview.waveform].every((sample) => sample >= -1 && sample <= 1));
});

check('point density and persistence remain within even trace and history caps', () => {
  assert.equal(resolveOscilloscopePointCount(-1), OSCILLOSCOPE_MIN_TRACE_POINTS);
  assert.equal(resolveOscilloscopePointCount(1), OSCILLOSCOPE_MAX_TRACE_POINTS);
  assert.equal(resolveOscilloscopePointCount(9), OSCILLOSCOPE_MAX_TRACE_POINTS);
  for (const density of [0, 0.2, 0.5, 0.8, 1]) {
    assert.equal(resolveOscilloscopePointCount(density) % 2, 0);
  }
  assert.equal(resolveOscilloscopeHistoryCount(0), 1);
  assert.equal(resolveOscilloscopeHistoryCount(0.05), 2);
  assert.equal(resolveOscilloscopeHistoryCount(1), OSCILLOSCOPE_MAX_HISTORY_FRAMES);
});

check('triggered sweeps are finite, bounded, and start near a rising zero crossing', () => {
  const corrupted = makeWaveform(1.2);
  corrupted[60] = Number.NaN;
  corrupted[61] = Number.POSITIVE_INFINITY;
  const sampled = sampleOscilloscopeTrace(corrupted, OSCILLOSCOPE_MAX_TRACE_POINTS + 100, 0.45);
  assert.equal(sampled.length, OSCILLOSCOPE_MAX_TRACE_POINTS);
  assert.ok([...sampled].every(Number.isFinite));
  assert.ok([...sampled].every((sample) => sample >= -1 && sample <= 1));
  assert.ok(sampled[0] >= 0 && sampled[0] < 0.25, `trigger sample was ${sampled[0]}`);
});

check('preview and capture produce identical paths from the same normalized waveform', () => {
  const preview = renderOscilloscope().ctx.operations;
  const capture = renderOscilloscope(
    frame,
    { ...environment, amplitudeMode: 'capture' },
  ).ctx.operations;
  assert.deepEqual(capture, preview);
});

check('the ring renders no more than six downsampled traces and persistence can collapse it', () => {
  const visual = OSCILLOSCOPE_VISUAL_DEFINITION.create();
  let result;
  for (let index = 0; index < OSCILLOSCOPE_MAX_HISTORY_FRAMES + 5; index += 1) {
    const nextFrame = {
      ...frame,
      timeMs: frame.timeMs + index * 42,
      waveform: makeWaveform(index * 0.31),
    };
    result = renderOscilloscope(
      nextFrame,
      environment,
      { ...params, density: 1, afterimageStrength: 1 },
      visual,
      0.042,
    );
  }
  const operations = result.ctx.operations;
  assert.equal(
    strokesWithWidth(operations, 1.25).length,
    OSCILLOSCOPE_MAX_HISTORY_FRAMES - 1,
  );
  const traceStrokes = operations.filter(
    ([operation, , width]) => operation === 'stroke' && [1.25, 7.5, 2.25].includes(width),
  );
  assert.ok(traceStrokes.every((stroke) => stroke[5].length <= OSCILLOSCOPE_MAX_TRACE_POINTS));

  const resumed = renderOscilloscope(
    { ...frame, timeMs: 9000, waveform: makeWaveform(1.7) },
    environment,
    { ...params, afterimageStrength: 1 },
    visual,
    0.1,
  ).ctx.operations;
  assert.equal(strokesWithWidth(resumed, 1.25).length, 0, 'long gaps clear stale history');

  const collapsed = renderOscilloscope(
    frame,
    environment,
    { ...params, afterimageStrength: 0 },
    visual,
    0.042,
  ).ctx.operations;
  assert.equal(strokesWithWidth(collapsed, 1.25).length, 0);
});

check('linear silence is a calm baseline while circular mode closes the trace at max density', () => {
  const silent = renderOscilloscope({ ...frame, waveform: undefined }).ctx.operations;
  const linearPath = strokesWithWidth(silent, 2.25)[0][5];
  const yValues = linearPath
    .filter(([operation]) => operation === 'moveTo' || operation === 'lineTo')
    .map(([, , y]) => y);
  assert.ok(yValues.every((y) => y === yValues[0]));

  const circular = renderOscilloscope(
    frame,
    environment,
    { ...params, density: 1, layoutMode: 'radial', highContrast: true },
  ).ctx.operations;
  const circularPath = strokesWithWidth(circular, 4)[0][5];
  assert.equal(
    circularPath.filter(([operation]) => operation === 'moveTo' || operation === 'lineTo').length,
    OSCILLOSCOPE_MAX_TRACE_POINTS,
  );
  assert.equal(circularPath.at(-1)[0], 'closePath');
});

check('High Contrast removes history and glow but strengthens the live trace', () => {
  const visual = OSCILLOSCOPE_VISUAL_DEFINITION.create();
  renderOscilloscope(frame, environment, params, visual, 0.042);
  renderOscilloscope({ ...frame, waveform: makeWaveform(0.8) }, environment, params, visual, 0.042);
  const contrasted = renderOscilloscope(
    { ...frame, waveform: makeWaveform(1.4) },
    environment,
    { ...params, highContrast: true, afterimageStrength: 1 },
    visual,
    0.042,
  ).ctx.operations;
  assert.equal(strokesWithWidth(contrasted, 1.25).length, 0);
  assert.equal(strokesWithWidth(contrasted, 7.5).length, 0);
  assert.equal(strokesWithWidth(contrasted, 4).length, 1);
  assert.equal(
    contrasted.some(([operation, , , , shadowBlur]) => operation === 'stroke' && shadowBlur > 0),
    false,
  );
});

check('reduced motion ignores waveform order and time while suppressing glow/history', () => {
  const reduced = { ...environment, reduceMotion: true };
  const first = renderOscilloscope(
    { ...frame, waveform: makeWaveform(0), timeMs: 100 },
    reduced,
  ).ctx.operations;
  const second = renderOscilloscope(
    { ...frame, waveform: makeWaveform(2.2).reverse(), timeMs: 9000 },
    reduced,
  ).ctx.operations;
  assert.deepEqual(second, first);
  assert.equal(strokesWithWidth(first, 1.25).length, 0);
  assert.equal(strokesWithWidth(first, 7.5).length, 0);
  assert.equal(strokesWithWidth(first, 3).length, 1);
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-oscilloscope-spectrum: ${checks} checks passed`);
