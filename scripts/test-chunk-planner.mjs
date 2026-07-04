// v5.3.9 overlay chunk planner tests — chunk-count heuristic, frame partition
// invariants, cue-gap boundary snapping, progress/stats aggregation.
//
//   Run:  node scripts/test-chunk-planner.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-chunk-planner-'));
const outfile = join(outdir, 'bundle.mjs');

await build({
  entryPoints: [join(root, 'src/transcription/overlay-chunk-planner.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { '@': root },
  logLevel: 'silent',
});

const {
  aggregateChunkProgress,
  mergeCueCacheStats,
  parallelCueCacheMaxEntries,
  planOverlayChunks,
  resolveParallelChunkCount,
  PARALLEL_OVERLAY_MIN_CLIP_SECONDS,
  PARALLEL_OVERLAY_MAX_CHUNKS,
} = await import(pathToFileURL(outfile).href);

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ok ${name}`);
}

function assertPartition(chunks, durationSeconds, fps) {
  const totalFrames = Math.max(1, Math.ceil(durationSeconds * fps));
  const sum = chunks.reduce((acc, c) => acc + c.frameCount, 0);
  assert.equal(sum, totalFrames, 'chunk frames must partition the serial frame count');
  let cursor = 0;
  for (const chunk of chunks) {
    assert.equal(chunk.startFrame, cursor, 'chunks must be contiguous');
    assert.ok(chunk.frameCount > 0, 'chunks must be non-empty');
    assert.ok(Math.abs(chunk.startSeconds - chunk.startFrame / fps) < 1e-9);
    assert.ok(Math.abs(chunk.durationSeconds - chunk.frameCount / fps) < 1e-9);
    cursor += chunk.frameCount;
  }
  assert.equal(chunks[chunks.length - 1].isFinal, true);
  assert.ok(chunks.slice(0, -1).every((c) => !c.isFinal));
  assert.equal(chunks[0].cutQuality, 'clip-start');
}

console.log('chunk-count heuristic');

check('short clips stay serial', () => {
  assert.equal(resolveParallelChunkCount({ durationSeconds: PARALLEL_OVERLAY_MIN_CLIP_SECONDS - 0.1 }), 1);
  assert.equal(resolveParallelChunkCount({ durationSeconds: 5, hardwareConcurrency: 16 }), 1);
});

check('typical clips scale with duration up to the hard cap', () => {
  assert.equal(resolveParallelChunkCount({ durationSeconds: 20, hardwareConcurrency: 8 }), 2);
  assert.equal(resolveParallelChunkCount({ durationSeconds: 30, hardwareConcurrency: 8 }), 2);
  assert.equal(resolveParallelChunkCount({ durationSeconds: 45, hardwareConcurrency: 8 }), 3);
  assert.equal(resolveParallelChunkCount({ durationSeconds: 60, hardwareConcurrency: 8 }), 4);
  assert.equal(
    resolveParallelChunkCount({ durationSeconds: 120, hardwareConcurrency: 16 }),
    PARALLEL_OVERLAY_MAX_CHUNKS,
  );
});

check('low-core and low-memory devices stay serial', () => {
  assert.equal(resolveParallelChunkCount({ durationSeconds: 120, hardwareConcurrency: 2 }), 1);
  assert.equal(
    resolveParallelChunkCount({ durationSeconds: 120, hardwareConcurrency: 8, deviceMemoryGb: 2 }),
    1,
  );
  assert.equal(
    resolveParallelChunkCount({ durationSeconds: 120, hardwareConcurrency: 8, deviceMemoryGb: 4 }),
    4,
  );
});

check('maxChunks override caps the plan', () => {
  assert.equal(
    resolveParallelChunkCount({ durationSeconds: 120, hardwareConcurrency: 8, maxChunks: 2 }),
    2,
  );
});

console.log('cache budget');

check('parallel cache budget divides the serial cap with a phase-cycle floor', () => {
  assert.equal(parallelCueCacheMaxEntries(1), 64);
  assert.equal(parallelCueCacheMaxEntries(2), 32);
  assert.equal(parallelCueCacheMaxEntries(4), 24); // floor(64/4)=16 < one 24-bucket cycle
});

console.log('chunk plan');

check('no-cue plan splits at ideal frame-aligned boundaries', () => {
  const chunks = planOverlayChunks({ cues: [], durationSeconds: 60, fps: 30, targetChunkCount: 4 });
  assert.equal(chunks.length, 4);
  assertPartition(chunks, 60, 30);
  assert.deepEqual(
    chunks.map((c) => c.startFrame),
    [0, 450, 900, 1350],
  );
  assert.ok(chunks.slice(1).every((c) => c.cutQuality === 'cue-gap'));
});

check('boundaries snap to the nearest cue gap', () => {
  // Ideal 2-way boundary is t=30 (frame 900), inside the first cue; the first
  // gap frame is t=31.5 (frame 945).
  const cues = [
    { start: 0, end: 31.5 },
    { start: 32, end: 60 },
  ];
  const chunks = planOverlayChunks({ cues, durationSeconds: 60, fps: 30, targetChunkCount: 2 });
  assert.equal(chunks.length, 2);
  assertPartition(chunks, 60, 30);
  assert.equal(chunks[1].startFrame, 945);
  assert.equal(chunks[1].cutQuality, 'cue-gap');
});

check('a wall-to-wall cue forces a mid-cue slice at the ideal frame', () => {
  const cues = [{ start: 0, end: 60 }];
  const chunks = planOverlayChunks({ cues, durationSeconds: 60, fps: 30, targetChunkCount: 2 });
  assert.equal(chunks.length, 2);
  assertPartition(chunks, 60, 30);
  assert.equal(chunks[1].startFrame, 900);
  assert.equal(chunks[1].cutQuality, 'mid-cue');
});

check('plan shrinks below target rather than violate the min-chunk floor', () => {
  const chunks = planOverlayChunks({ cues: [], durationSeconds: 20, fps: 30, targetChunkCount: 4 });
  assert.equal(chunks.length, 2);
  assertPartition(chunks, 20, 30);
});

check('target 1 or tiny clips return a single serial-equivalent chunk', () => {
  for (const plan of [
    planOverlayChunks({ cues: [], durationSeconds: 60, fps: 30, targetChunkCount: 1 }),
    planOverlayChunks({ cues: [], durationSeconds: 6, fps: 30, targetChunkCount: 4 }),
  ]) {
    assert.equal(plan.length, 1);
    assert.equal(plan[0].startFrame, 0);
    assert.equal(plan[0].isFinal, true);
  }
});

check('fractional durations partition ceil(duration*fps) exactly', () => {
  for (const duration of [33.37, 47.019, 119.966]) {
    const chunks = planOverlayChunks({ cues: [], durationSeconds: duration, fps: 30, targetChunkCount: 4 });
    assertPartition(chunks, duration, 30);
  }
});

console.log('aggregation');

check('aggregate progress sums frames and clamps', () => {
  assert.deepEqual(aggregateChunkProgress([10, 20, 5], 100), {
    frameIndex: 35,
    totalFrames: 100,
    ratio: 0.35,
  });
  assert.equal(aggregateChunkProgress([80, 80], 100).ratio, 1);
  assert.equal(aggregateChunkProgress([], 0).ratio, 0);
});

check('cache stats merge sums counters and recomputes hit rate', () => {
  const a = { enabled: true, phaseBuckets: 24, maxEntries: 24, hits: 90, misses: 10, lookups: 100, creates: 10, evictions: 1, uniqueKeys: 9, hitRate: 0.9 };
  const b = { enabled: true, phaseBuckets: 24, maxEntries: 24, hits: 40, misses: 60, lookups: 100, creates: 60, evictions: 5, uniqueKeys: 55, hitRate: 0.4 };
  const merged = mergeCueCacheStats([a, b]);
  assert.equal(merged.hits, 130);
  assert.equal(merged.misses, 70);
  assert.equal(merged.lookups, 200);
  assert.equal(merged.hitRate, 0.65);
  assert.equal(merged.uniqueKeys, 64);
  assert.equal(merged.enabled, true);
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-chunk-planner: ${checks} checks passed`);
