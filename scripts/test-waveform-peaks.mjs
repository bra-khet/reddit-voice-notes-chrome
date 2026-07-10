// v5.8.0 — Waveform-peaks tests: min/max range binning (time-aligned,
// out-of-range bins silent), the fixed-resolution full-clip pyramid, and
// extrema-preserving resampling (the low-zoom canvas path).
//
//   Run:  node scripts/test-waveform-peaks.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-waveform-peaks-'));

async function bundle(entry, name) {
  const outfile = join(outdir, name);
  await build({
    entryPoints: [join(root, entry)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    alias: { '@': root },
    logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href);
}

const {
  WAVEFORM_PYRAMID_PEAKS_PER_SECOND,
  computeRangePeaks,
  computeWaveformPyramid,
  resamplePeaks,
} = await bundle('src/ui/design-studio/waveform-peaks.ts', 'waveform-peaks.mjs');

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ''} (${a} ≈ ${b})`);

console.log('computeRangePeaks');

check('constant signal → every bin is (v, v)', () => {
  const data = new Float32Array(1000).fill(0.5);
  const peaks = computeRangePeaks(data, 0, 1000, 10);
  assert.equal(peaks.min.length, 10);
  for (let i = 0; i < 10; i += 1) {
    near(peaks.min[i], 0.5, `min[${i}]`);
    near(peaks.max[i], 0.5, `max[${i}]`);
  }
});

check('step signal: bins land on their halves; the boundary bin sees both', () => {
  const data = new Float32Array(1000);
  data.fill(0.1, 0, 500);
  data.fill(0.9, 500, 1000);
  const peaks = computeRangePeaks(data, 0, 1000, 4); // bins of 250 samples
  near(peaks.max[0], 0.1, 'first-half bin');
  near(peaks.max[1], 0.1, 'first-half bin');
  near(peaks.max[2], 0.9, 'second-half bin');
  near(peaks.max[3], 0.9, 'second-half bin');
  const straddle = computeRangePeaks(data, 0, 1000, 3); // middle bin straddles 500
  near(straddle.min[1], 0.1, 'straddling bin keeps the low side');
  near(straddle.max[1], 0.9, 'straddling bin keeps the high side');
});

check('negative excursions land in min; sine peaks reach ±amplitude', () => {
  const n = 4800;
  const data = new Float32Array(n);
  for (let i = 0; i < n; i += 1) data[i] = 0.8 * Math.sin((i / n) * Math.PI * 20); // 10 periods
  const peaks = computeRangePeaks(data, 0, n, 10); // one period per bin
  for (let i = 0; i < 10; i += 1) {
    assert.ok(peaks.max[i] > 0.79, `bin ${i} max near +0.8 (got ${peaks.max[i]})`);
    assert.ok(peaks.min[i] < -0.79, `bin ${i} min near -0.8 (got ${peaks.min[i]})`);
  }
});

check('a single-sample impulse survives binning (max, not average)', () => {
  const data = new Float32Array(10000);
  data[7321] = 1;
  const peaks = computeRangePeaks(data, 0, 10000, 20); // 500-sample bins
  const hit = Math.floor(7321 / 500);
  near(peaks.max[hit], 1, 'impulse bin');
  for (let i = 0; i < 20; i += 1) {
    if (i !== hit) near(peaks.max[i], 0, `bin ${i} silent`);
  }
});

check('time alignment: a range past the data end yields silent bins, never stretch', () => {
  const data = new Float32Array(1000).fill(0.7);
  // Request twice the data span — second half must be silence.
  const peaks = computeRangePeaks(data, 0, 2000, 10);
  near(peaks.max[4], 0.7, 'in-data bin');
  near(peaks.max[5], 0, 'past-end bin silent');
  near(peaks.max[9], 0, 'past-end bin silent');
  // Range starting before 0 — leading bins silent.
  const lead = computeRangePeaks(data, -1000, 1000, 10);
  near(lead.max[0], 0, 'pre-start bin silent');
  near(lead.max[4], 0, 'pre-start bin silent');
  near(lead.max[5], 0.7, 'in-data bin');
});

check('degenerate inputs are safe (empty data, inverted range, binCount floor)', () => {
  const empty = computeRangePeaks(new Float32Array(0), 0, 100, 5);
  assert.equal(empty.min.length, 5);
  near(empty.max[0], 0, 'empty data silent');
  const inverted = computeRangePeaks(new Float32Array(100).fill(1), 50, 10, 5);
  near(inverted.max[0], 0, 'inverted range silent');
  const one = computeRangePeaks(new Float32Array([0.2, -0.4, 0.3]), 0, 3, 0); // binCount floors to 1
  assert.equal(one.min.length, 1);
  near(one.min[0], -0.4, 'global min');
  near(one.max[0], 0.3, 'global max');
});

console.log('computeWaveformPyramid');

check('pyramid bins = ceil(duration × peaksPerSecond)', () => {
  assert.equal(WAVEFORM_PYRAMID_PEAKS_PER_SECOND, 50);
  const data = new Float32Array(48000 * 3).fill(0.25); // 3 s at 48 kHz
  const pyramid = computeWaveformPyramid(data, 48000);
  assert.equal(pyramid.min.length, 150);
  near(pyramid.max[75], 0.25, 'mid bin');
  const degenerate = computeWaveformPyramid(new Float32Array(0), 48000);
  assert.equal(degenerate.min.length, 1);
});

console.log('resamplePeaks');

check('downsample preserves extrema (max of maxes, min of mins)', () => {
  const src = {
    min: new Float32Array([0, -0.2, 0, 0, -0.9, 0, 0, -0.1]),
    max: new Float32Array([0.1, 0.3, 0.1, 0.1, 0.8, 0.1, 0.1, 0.2]),
  };
  const out = resamplePeaks(src, 0, 8, 2); // 4 source bins per output bin
  near(out.min[0], -0.2, 'first-half min');
  near(out.max[0], 0.3, 'first-half max');
  near(out.min[1], -0.9, 'second-half min (spike kept)');
  near(out.max[1], 0.8, 'second-half max (spike kept)');
});

check('identity slice round-trips; fractional slices stay in-window', () => {
  const src = {
    min: new Float32Array([-1, -2, -3, -4]),
    max: new Float32Array([1, 2, 3, 4]),
  };
  const same = resamplePeaks(src, 0, 4, 4);
  for (let i = 0; i < 4; i += 1) {
    near(same.min[i], src.min[i], `identity min[${i}]`);
    near(same.max[i], src.max[i], `identity max[${i}]`);
  }
  const frac = resamplePeaks(src, 1.5, 3.5, 2); // covers bins 1–2 and 2–3
  near(frac.max[0], 3, 'fractional bin covers 1..3');
  near(frac.max[1], 4, 'fractional bin covers 2..4');
});

check('out-of-range pyramid slice yields silent bins (same contract as range peaks)', () => {
  const src = { min: new Float32Array([-1, -1]), max: new Float32Array([1, 1]) };
  const out = resamplePeaks(src, 0, 8, 4); // only the first quarter has data
  near(out.max[0], 1, 'in-range');
  near(out.max[1], 0, 'past-end silent');
  near(out.max[3], 0, 'past-end silent');
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-waveform-peaks: ${checks} checks passed`);
