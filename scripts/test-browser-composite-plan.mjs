// v5.5.0 browser-composite plan tests — the pure, deterministic core of the
// ADR-0003 composite path: honest progress model, output validation gate,
// R13 size guard, and the fidelity-harness anchor timestamps.
//
//   Run:  node scripts/test-browser-composite-plan.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-browser-composite-plan-'));
const outfile = join(outdir, 'bundle.mjs');

await build({
  entryPoints: [join(root, 'src/composite/composite-plan.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { '@': root },
  logLevel: 'silent',
});

const {
  BROWSER_COMPOSITE_STAGES,
  BROWSER_COMPOSITE_VIDEO_BPS,
  BAKED_MP4_MAX_BYTES,
  COMPOSITE_FIDELITY_MAX_TIMESTAMPS,
  computeAudioPassthroughOffset,
  computeBrowserCompositeProgress,
  compositeOutputMayExceedStoreCap,
  estimateCompositeOutputBytes,
  rebaseAudioPassthroughTimestamp,
  selectCompositeFidelityTimestamps,
  shouldSkipAudioPassthroughPacket,
  validateCompositeOutput,
} = await import(pathToFileURL(outfile).href);

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ok ${name}`);
}

// ---- honest progress model (R8) -------------------------------------------

check('progress is 0 at start, 1 when both counters complete', () => {
  assert.equal(computeBrowserCompositeProgress(0, 0, 1440), 0);
  assert.equal(computeBrowserCompositeProgress(1440, 1440, 1440), 1);
});

check('progress weighs composited and encoded frames equally', () => {
  // Half the frames painted, none encoded yet → a quarter of the work.
  assert.equal(computeBrowserCompositeProgress(720, 0, 1440), 0.25);
  // Encoder fully caught up at the same point → half.
  assert.equal(computeBrowserCompositeProgress(720, 720, 1440), 0.5);
});

check('progress is monotonic under monotonic counters', () => {
  let prev = -1;
  for (let composited = 0; composited <= 100; composited += 7) {
    const encoded = Math.max(0, composited - 9); // encoder trails paint
    const ratio = computeBrowserCompositeProgress(composited, encoded, 100);
    assert.ok(ratio >= prev, `ratio regressed at composited=${composited}`);
    prev = ratio;
  }
});

check('progress clamps: counter overshoot and bad totals never break the meter', () => {
  assert.equal(computeBrowserCompositeProgress(2000, 2000, 1440), 1);
  assert.equal(computeBrowserCompositeProgress(10, 10, 0), 0);
  assert.equal(computeBrowserCompositeProgress(-5, -5, 100), 0);
});

// ---- output validation gate (R10) ------------------------------------------

const validBase = {
  framesComposited: 1440,
  packetsEncoded: 1440,
  expectedFrames: 1440,
  baseDurationSeconds: 60,
  outputDurationSeconds: 60,
  fps: 24,
};

check('validation passes a frame-exact, duration-exact output', () => {
  assert.equal(validateCompositeOutput(validBase), null);
});

check('validation allows duration drift up to one frame period', () => {
  assert.equal(
    validateCompositeOutput({ ...validBase, outputDurationSeconds: 60 + 1 / 24 }),
    null,
  );
});

check('validation rejects frame-count mismatch, packet mismatch, and >1-frame drift', () => {
  assert.match(
    validateCompositeOutput({ ...validBase, framesComposited: 1439 }) ?? '',
    /Composited 1439 frames/,
  );
  assert.match(
    validateCompositeOutput({ ...validBase, packetsEncoded: 1439 }) ?? '',
    /emitted 1439 packets/,
  );
  assert.match(
    validateCompositeOutput({ ...validBase, outputDurationSeconds: 60.2 }) ?? '',
    /drifts/,
  );
});

// ---- R13 size guard ---------------------------------------------------------

check('size estimate scales with duration and flags only over-cap clips', () => {
  const sixty = estimateCompositeOutputBytes(60);
  const oneTwenty = estimateCompositeOutputBytes(120);
  assert.ok(oneTwenty > sixty);
  // The pinned bitrates MUST keep the 2:00 recording cap under the 30 MB store
  // cap — this is the constraint that chose BROWSER_COMPOSITE_VIDEO_BPS.
  assert.equal(compositeOutputMayExceedStoreCap(120), false);
  assert.ok(oneTwenty < BAKED_MP4_MAX_BYTES);
  // Sanity: a clip long enough will exceed (guard actually fires).
  assert.equal(compositeOutputMayExceedStoreCap(3600), true);
});

check('video bitrate stays under the store-cap ceiling at max duration', () => {
  const audioBps = 128_000;
  const worstCaseBytes = ((BROWSER_COMPOSITE_VIDEO_BPS + audioBps) * 120) / 8;
  assert.ok(
    worstCaseBytes < BAKED_MP4_MAX_BYTES * 0.9,
    'need ≥10% headroom for container overhead at the 2:00 cap',
  );
});

// ---- fidelity anchors (R9) --------------------------------------------------

check('fidelity timestamps are frame-aligned, sorted, deduped, and in range', () => {
  const cues = [
    { start: 1.02, end: 3.51 },
    { start: 3.4, end: 6.0 }, // overlaps previous
    { start: 10, end: 12 },
  ];
  const ts = selectCompositeFidelityTimestamps(cues, 20, 24);
  assert.ok(ts.length > 0);
  for (let i = 0; i < ts.length; i += 1) {
    const frames = ts[i] * 24;
    assert.ok(Math.abs(frames - Math.round(frames)) < 1e-6, `${ts[i]} not frame-aligned`);
    assert.ok(ts[i] >= 0 && ts[i] <= 20 - 1 / 24 + 1e-9, `${ts[i]} out of range`);
    if (i > 0) assert.ok(ts[i] > ts[i - 1], 'not strictly sorted');
  }
  // Clip start and last frame always present.
  assert.equal(ts[0], 0);
  assert.ok(Math.abs(ts[ts.length - 1] - (20 - 1 / 24)) < 1e-6);
});

check('fidelity anchors include cue starts, ends, midpoints, and glow tails', () => {
  const ts = selectCompositeFidelityTimestamps([{ start: 2, end: 4 }], 10, 24);
  const has = (t) => ts.some((x) => Math.abs(x - t) < 1e-6);
  assert.ok(has(2), 'cue start');
  assert.ok(has(4), 'cue end');
  assert.ok(has(3), 'cue midpoint');
  assert.ok(has(4.3 - ((4.3 * 24) % 1) / 24) || has(Math.round(4.3 * 24) / 24), 'glow tail');
});

check('fidelity set is deterministic and capped on dense cue sets', () => {
  const dense = Array.from({ length: 200 }, (_, i) => ({
    start: i * 0.29,
    end: i * 0.29 + 0.25,
  }));
  const a = selectCompositeFidelityTimestamps(dense, 60, 24);
  const b = selectCompositeFidelityTimestamps(dense, 60, 24);
  assert.deepEqual(a, b);
  assert.ok(a.length <= COMPOSITE_FIDELITY_MAX_TIMESTAMPS);
  assert.equal(a[0], 0);
});

check('fidelity selection handles empty cues and degenerate inputs', () => {
  const ts = selectCompositeFidelityTimestamps([], 10, 24);
  assert.deepEqual(ts, [0, 10 - 1 / 24]);
  assert.deepEqual(selectCompositeFidelityTimestamps([], 0, 24), []);
  assert.deepEqual(selectCompositeFidelityTimestamps([], 10, 0), []);
});

// ---- audio passthrough timestamp rebasing ---------------------------------

check('audio offset captures AAC priming PTS from the first packet', () => {
  assert.equal(computeAudioPassthroughOffset(-0.0114375), -0.0114375);
  assert.equal(computeAudioPassthroughOffset(0), 0);
  assert.equal(computeAudioPassthroughOffset(0.023), 0);
});

check('rebased priming PTS lands on the non-negative muxer timeline', () => {
  const offset = computeAudioPassthroughOffset(-0.0114375);
  const rebased = rebaseAudioPassthroughTimestamp(-0.0114375, offset);
  assert.ok(rebased >= 0, `expected non-negative rebased PTS, got ${rebased}`);
  assert.ok(Math.abs(rebased) < 1e-9);
});

check('skip only whole priming spans that remain at or before zero', () => {
  assert.equal(shouldSkipAudioPassthroughPacket(-0.02, 0.01), true);
  assert.equal(shouldSkipAudioPassthroughPacket(0, 0.023), false);
  assert.equal(shouldSkipAudioPassthroughPacket(0.01, 0.02), false);
});

// ---- stage labels (R8: distinct semantic stages) ---------------------------

check('stage labels are distinct and all carry the browser-composite prefix', () => {
  const labels = Object.values(BROWSER_COMPOSITE_STAGES);
  assert.equal(new Set(labels).size, labels.length);
  for (const label of labels) {
    assert.ok(label.startsWith('browser-composite-'), label);
  }
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-browser-composite-plan: ${checks} checks passed`);
