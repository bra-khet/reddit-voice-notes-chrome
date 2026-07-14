// v6.0 Phase 0 — normalized audio carrier + instance-safe registry contract.
//
//   Run: node scripts/test-audio-frame.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-audio-frame-'));
const outfile = join(outdir, 'audio-reactive.mjs');

await build({
  entryPoints: ['src/theme/audio-reactive/index.ts'],
  absWorkingDir: root,
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'silent',
});

const {
  AUDIO_VIZ_BAND_COUNT,
  EMPTY_AUDIO_VIZ_FRAME,
  buildAudioVizFrame,
  buildSyntheticAudioVizFrame,
  listAudioVisualDefinitions,
  registerAudioVisual,
  registerAudioVisualIfAbsent,
  renderAudioVisualForCanvas,
  resolveAudioVisual,
} = await import(pathToFileURL(outfile).href);

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

console.log('AudioVizFrame');

check('empty frame is a stable 32-band zero input', () => {
  assert.equal(AUDIO_VIZ_BAND_COUNT, 32);
  assert.equal(EMPTY_AUDIO_VIZ_FRAME.energy, 0);
  assert.equal(EMPTY_AUDIO_VIZ_FRAME.timeMs, 0);
  assert.equal(EMPTY_AUDIO_VIZ_FRAME.bands.length, 32);
  assert.ok(EMPTY_AUDIO_VIZ_FRAME.bands.every((band) => band === 0));
});

check('byte bands normalize, clamp, pad, and truncate to 32', () => {
  const source = Array.from({ length: 40 }, (_, index) => index * 16);
  source[0] = -20;
  source[1] = Number.NaN;
  const frame = buildAudioVizFrame({ bands: source, bandScale: 255 });
  assert.equal(frame.bands.length, 32);
  assert.equal(frame.bands[0], 0);
  assert.equal(frame.bands[1], 0);
  assert.equal(frame.bands[2], 32 / 255);
  assert.equal(frame.bands[31], 1);
});

check('energy/time are finite and bounded without mutating the input', () => {
  const source = [0.25, 0.75];
  const frame = buildAudioVizFrame({ energy: 2, bands: source, timeMs: -50 });
  source[0] = 1;
  assert.equal(frame.energy, 1);
  assert.equal(frame.timeMs, 0);
  assert.equal(frame.bands[0], 0.25);
  const nonFinite = buildAudioVizFrame({ energy: Number.NaN, timeMs: Number.POSITIVE_INFINITY });
  assert.equal(nonFinite.energy, 0);
  assert.equal(nonFinite.timeMs, 0);
});

check('waveform is cloned and clamped to -1–1', () => {
  const source = new Float32Array([-2, -0.5, Number.NaN, 0.25, 2]);
  const frame = buildAudioVizFrame({ waveform: source });
  assert.deepEqual([...frame.waveform], [-1, -0.5, 0, 0.25, 1]);
  source[1] = 1;
  assert.equal(frame.waveform[1], -0.5);
});

check('synthetic preview keeps representative energy, bands, and clock', () => {
  const frame = buildSyntheticAudioVizFrame([0.2, 0.8], 1234, 0.32);
  assert.equal(frame.energy, 0.32);
  assert.equal(frame.timeMs, 1234);
  assert.equal(frame.bands[0], 0.2);
  assert.equal(frame.bands[1], 0.8);
});

check('optional transient state is preserved only when supplied', () => {
  assert.equal('transient' in buildAudioVizFrame(), false);
  assert.equal(buildAudioVizFrame({ transient: false }).transient, false);
  assert.equal(buildAudioVizFrame({ transient: true }).transient, true);
});

console.log('AudioVisual registry');

check('definitions create isolated stateful instances and unregister cleanly', () => {
  let generation = 0;
  const unregister = registerAudioVisual({
    id: 'test',
    kind: 'spectrum',
    create: () => ({
      id: `test-${++generation}`,
      kind: 'spectrum',
      wants: { bands: true },
      render() {},
    }),
  });
  const first = resolveAudioVisual('spectrum', 'test');
  const second = resolveAudioVisual('spectrum', 'test');
  assert.ok(first && second);
  assert.notEqual(first, second);
  assert.notEqual(first.id, second.id);
  assert.equal(listAudioVisualDefinitions('spectrum').length, 1);
  unregister();
  assert.equal(resolveAudioVisual('spectrum', 'test'), null);
});

check('same id may occupy different draw slots, but duplicates in one slot fail', () => {
  const makeDefinition = (kind) => ({
    id: 'shared',
    kind,
    create: () => ({ id: 'shared', kind, wants: {}, render() {} }),
  });
  const unregisterSpectrum = registerAudioVisual(makeDefinition('spectrum'));
  const overlayDefinition = makeDefinition('overlay');
  const unregisterOverlay = registerAudioVisual(overlayDefinition);
  assert.equal(registerAudioVisualIfAbsent(overlayDefinition), false);
  assert.throws(() => registerAudioVisualIfAbsent(makeDefinition('overlay')), /already registered/);
  assert.throws(() => registerAudioVisual(makeDefinition('overlay')), /already registered/);
  assert.ok(resolveAudioVisual('spectrum', 'shared'));
  assert.ok(resolveAudioVisual('overlay', 'shared'));
  unregisterSpectrum();
  unregisterOverlay();
});

check('canvas runtime reuses one instance per canvas and clamps long frame deltas', () => {
  let creates = 0;
  const updates = [];
  const renders = [];
  const unregister = registerAudioVisual({
    id: 'runtime',
    kind: 'overlay',
    defaultParams: { density: 0.25 },
    create: () => {
      const generation = ++creates;
      return {
        id: 'runtime',
        kind: 'overlay',
        wants: { bands: true },
        update(_frame, dt) {
          updates.push([generation, dt]);
        },
        render(_ctx, _canvas, _frame, params) {
          renders.push([generation, params.density]);
        },
      };
    },
  });

  const canvasA = {};
  const canvasB = {};
  const ctx = {};
  const firstFrame = buildAudioVizFrame({ timeMs: 100 });
  const laterFrame = buildAudioVizFrame({ timeMs: 350 });
  assert.equal(renderAudioVisualForCanvas('overlay', 'runtime', ctx, canvasA, firstFrame), true);
  assert.equal(renderAudioVisualForCanvas('overlay', 'runtime', ctx, canvasA, laterFrame), true);
  assert.equal(renderAudioVisualForCanvas('overlay', 'runtime', ctx, canvasB, laterFrame), true);
  assert.equal(creates, 2);
  assert.deepEqual(updates, [[1, 0], [1, 0.1], [2, 0]]);
  assert.deepEqual(renders, [[1, 0.25], [1, 0.25], [2, 0.25]]);
  unregister();
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-audio-frame: ${checks} checks passed`);
