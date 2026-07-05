// v5.3.10 encoded-segment model tests — cue-span overlap semantics (the future
// selective-re-encode key) and per-segment telemetry aggregation.
//
//   Run:  node scripts/test-encoded-segment.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-encoded-segment-'));
const outfile = join(outdir, 'bundle.mjs');

await build({
  entryPoints: [join(root, 'src/encoding/encoded-segment.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { '@': root },
  logLevel: 'silent',
});

const { computeSegmentCueSpan, summarizeEncodedSegments } = await import(
  pathToFileURL(outfile).href
);

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ok ${name}`);
}

const cues = [
  { start: 1, end: 4 },
  { start: 5, end: 9 },
  { start: 14, end: 16 },
];

check('cue span counts overlapping cues and reports outer bounds', () => {
  // Segment [0s, 15s) at 30fps — overlaps all three cues.
  const span = computeSegmentCueSpan(cues, 0, 450, 30);
  assert.equal(span.cueCount, 3);
  assert.equal(span.firstCueStartSeconds, 1);
  assert.equal(span.lastCueEndSeconds, 16);
});

check('half-open boundaries: a cue ending at segment start does not overlap', () => {
  // Segment [4s, 10s): cue [1,4] touches only the boundary → excluded;
  // cue [5,9] is inside → included.
  const span = computeSegmentCueSpan(cues, 120, 180, 30);
  assert.equal(span.cueCount, 1);
  assert.equal(span.firstCueStartSeconds, 5);
  assert.equal(span.lastCueEndSeconds, 9);
});

check('cue-free segments report zero count and null bounds', () => {
  // Segment [10s, 14s): the gap between cue 2 and cue 3.
  const span = computeSegmentCueSpan(cues, 300, 120, 30);
  assert.deepEqual(span, {
    cueCount: 0,
    firstCueStartSeconds: null,
    lastCueEndSeconds: null,
  });
});

check('segment summary aggregates telemetry across segments', () => {
  const meta = (index, frameCount, encodeMs) => ({
    index,
    startFrame: index * frameCount,
    frameCount,
    fps: 30,
    startSeconds: (index * frameCount) / 30,
    durationSeconds: frameCount / 30,
    cutQuality: 'cue-gap',
    encoderType: 'webcodecs',
    codec: 'vp8',
    cueSpan: { cueCount: 1, firstCueStartSeconds: 0, lastCueEndSeconds: 1 },
    paintMs: 100,
    encodeMs,
    colorBytes: 1000,
    alphaBytes: 500,
  });
  const summary = summarizeEncodedSegments([meta(0, 450, 3000), meta(1, 450, 5000)]);
  assert.deepEqual(summary, {
    segmentCount: 2,
    totalFrames: 900,
    totalColorBytes: 2000,
    totalAlphaBytes: 1000,
    totalPaintMs: 200,
    totalEncodeMs: 8000,
    maxEncodeMs: 5000,
  });
});

check('empty segment list summarizes to zeros', () => {
  assert.deepEqual(summarizeEncodedSegments([]), {
    segmentCount: 0,
    totalFrames: 0,
    totalColorBytes: 0,
    totalAlphaBytes: 0,
    totalPaintMs: 0,
    totalEncodeMs: 0,
    maxEncodeMs: 0,
  });
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-encoded-segment: ${checks} checks passed`);
