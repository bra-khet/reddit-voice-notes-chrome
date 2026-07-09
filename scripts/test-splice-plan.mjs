// v5.7.0 Phase 2b — Splice-plan tests: keyframe alignment (on- AND off-grid),
// region contiguity/coverage, GOP merge, coverage fallback, malformed keyframe
// rejection, and the two validation gates (plan + output).
//
//   Run:  node scripts/test-splice-plan.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-splice-plan-'));
const outfile = join(outdir, 'bundle.mjs');

// Bundle splice-plan + the coordinator (integration) through the '@' alias.
await build({
  entryPoints: [join(root, 'src/editing/splice-plan.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { '@': root },
  logLevel: 'silent',
});
const coordFile = join(outdir, 'coord.mjs');
await build({
  entryPoints: [join(root, 'src/editing/partial-rebake-coordinator.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: coordFile,
  alias: { '@': root },
  logLevel: 'silent',
});

const {
  PARTIAL_SPLICE_STAGES,
  alignFrameToKeyframeStart,
  alignFrameToKeyframeEnd,
  planSplice,
  scanKeyframes,
  diagnoseKeyframeScanFailure,
  selectSpliceFidelityAnchors,
  validateSplicePlan,
  validateSpliceOutput,
  computeSpliceProgress,
  computeSpliceReencodeRatio,
  computeSpliceAssembleRatio,
  spliceStageBand,
} = await import(pathToFileURL(outfile).href);
const { planPartialRebake, PARTIAL_REBAKE_PLAN_STAGE } = await import(
  pathToFileURL(coordFile).href
);

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

/** Every region must be contiguous, cover [0,frameCount), and pass validation. */
function assertWellFormed(plan, frameCount, keyframeFrames) {
  assert.equal(validateSplicePlan(plan.regions, frameCount, keyframeFrames), null);
  assert.equal(plan.regions[0].startFrame, 0);
  assert.equal(plan.regions[plan.regions.length - 1].endFrame, frameCount);
  const reencode = plan.regions
    .filter((r) => r.kind === 'reencode')
    .reduce((s, r) => s + (r.endFrame - r.startFrame), 0);
  assert.equal(reencode, plan.reencodeFrameCount);
  assert.equal(plan.keepFrameCount + plan.reencodeFrameCount, frameCount);
}

// GOP size 5, keyframes at 0,5,10,15; last GOP [15,20). Small so it hand-verifies.
const KF = [0, 5, 10, 15];
const FRAMES = 20;

console.log('alignFrameToKeyframeStart / End');

check('start aligns down to enclosing GOP keyframe', () => {
  assert.equal(alignFrameToKeyframeStart(6, KF), 5);
  assert.equal(alignFrameToKeyframeStart(5, KF), 5);
  assert.equal(alignFrameToKeyframeStart(0, KF), 0);
  assert.equal(alignFrameToKeyframeStart(19, KF), 15);
});

check('end aligns up to next GOP keyframe, EOS in the final GOP', () => {
  assert.equal(alignFrameToKeyframeEnd(8, KF, FRAMES), 10);
  assert.equal(alignFrameToKeyframeEnd(10, KF, FRAMES), 10);
  assert.equal(alignFrameToKeyframeEnd(16, KF, FRAMES), FRAMES); // no kf ≥16 → EOS
});

console.log('planSplice — region construction');

check('single dirty span expands to its enclosing GOP', () => {
  const plan = planSplice({
    spans: [{ startFrame: 6, frameCount: 2 }], // [6,8)
    keyframeFrames: KF,
    frameCount: FRAMES,
  });
  assert.equal(plan.strategy, 'partial');
  assert.deepEqual(plan.regions, [
    { kind: 'keep', startFrame: 0, endFrame: 5 },
    { kind: 'reencode', startFrame: 5, endFrame: 10 },
    { kind: 'keep', startFrame: 10, endFrame: 20 },
  ]);
  assert.equal(plan.reencodeFrameCount, 5);
  assert.equal(plan.reencodeRegionCount, 1);
  assert.equal(plan.coverageRatio, 0.25);
  assertWellFormed(plan, FRAMES, KF);
});

check('dirty in the final GOP re-encodes through EOS (no trailing keep)', () => {
  const plan = planSplice({
    spans: [{ startFrame: 16, frameCount: 2 }], // [16,18)
    keyframeFrames: KF,
    frameCount: FRAMES,
  });
  assert.deepEqual(plan.regions, [
    { kind: 'keep', startFrame: 0, endFrame: 15 },
    { kind: 'reencode', startFrame: 15, endFrame: 20 },
  ]);
  assertWellFormed(plan, FRAMES, KF);
});

check('dirty at frame 0 emits no leading keep', () => {
  const plan = planSplice({
    spans: [{ startFrame: 1, frameCount: 2 }], // [1,3)
    keyframeFrames: KF,
    frameCount: FRAMES,
  });
  assert.equal(plan.regions[0].kind, 'reencode');
  assert.equal(plan.regions[0].startFrame, 0);
  assert.equal(plan.regions[0].endFrame, 5);
  assertWellFormed(plan, FRAMES, KF);
});

check('two spans aligning to touching GOPs merge into one reencode island', () => {
  const plan = planSplice({
    spans: [
      { startFrame: 6, frameCount: 1 }, // [6,7) → GOP [5,10)
      { startFrame: 11, frameCount: 1 }, // [11,12) → GOP [10,15)
    ],
    keyframeFrames: KF,
    frameCount: FRAMES,
  });
  assert.equal(plan.reencodeRegionCount, 1);
  assert.deepEqual(plan.regions, [
    { kind: 'keep', startFrame: 0, endFrame: 5 },
    { kind: 'reencode', startFrame: 5, endFrame: 15 },
    { kind: 'keep', startFrame: 15, endFrame: 20 },
  ]);
  assertWellFormed(plan, FRAMES, KF);
});

check('two separated spans keep two reencode islands', () => {
  const plan = planSplice({
    spans: [
      { startFrame: 1, frameCount: 1 }, // GOP [0,5)
      { startFrame: 16, frameCount: 1 }, // GOP [15,20)
    ],
    keyframeFrames: KF,
    frameCount: FRAMES,
  });
  assert.equal(plan.reencodeRegionCount, 2);
  assert.equal(plan.regions.filter((r) => r.kind === 'reencode').length, 2);
  assertWellFormed(plan, FRAMES, KF);
});

console.log('planSplice — OFF-GRID keyframes (the crux)');

check('off-grid keyframes drive alignment, not the 2s grid assumption', () => {
  // Encoder drift: GOPs are NOT uniform. A grid planner would cut at 48-frame
  // boundaries; the real cuts must be these keyframes.
  const offGrid = [0, 50, 103, 149, 210, 280, 350];
  const frames = 400;
  const plan = planSplice({
    // Pretend the planner snapped a dirty window to a 2s grid span [96,192).
    spans: [{ startFrame: 96, frameCount: 96 }],
    keyframeFrames: offGrid,
    frameCount: frames,
  });
  // [96,192): start GOP = largest kf ≤96 = 50; end = smallest kf ≥192 = 210.
  assert.equal(plan.strategy, 'partial');
  const reencode = plan.regions.find((r) => r.kind === 'reencode');
  assert.equal(reencode.startFrame, 50);
  assert.equal(reencode.endFrame, 210);
  assertWellFormed(plan, frames, offGrid);
});

console.log('planSplice — strategy fallbacks (honest)');

check('aligned coverage past threshold → full with empty regions', () => {
  const plan = planSplice({
    spans: [{ startFrame: 1, frameCount: 14 }], // [1,15) → aligns [0,15) = 75%
    keyframeFrames: KF,
    frameCount: FRAMES,
  });
  assert.equal(plan.strategy, 'full');
  assert.deepEqual(plan.regions, []);
  assert.ok(plan.coverageRatio > 0.6);
  assert.match(plan.reason, /full composite/i);
});

check('keyframes not starting at 0 → not splice-friendly → full', () => {
  const plan = planSplice({
    spans: [{ startFrame: 6, frameCount: 2 }],
    keyframeFrames: [3, 8, 13],
    frameCount: FRAMES,
  });
  assert.equal(plan.strategy, 'full');
  assert.match(plan.reason, /splice-friendly|frame 0/i);
});

check('empty / degenerate inputs → full, coverage 0 or 1', () => {
  assert.equal(planSplice({ spans: [], keyframeFrames: KF, frameCount: FRAMES }).strategy, 'full');
  assert.equal(planSplice({ spans: [], keyframeFrames: KF, frameCount: FRAMES }).coverageRatio, 0);
  const bad = planSplice({ spans: [{ startFrame: 0, frameCount: 5 }], keyframeFrames: [], frameCount: 0 });
  assert.equal(bad.strategy, 'full');
});

console.log('validateSplicePlan — the construction gate');

check('rejects a gap between regions', () => {
  const bad = [
    { kind: 'keep', startFrame: 0, endFrame: 5 },
    { kind: 'reencode', startFrame: 10, endFrame: 15 }, // gap 5..10
    { kind: 'keep', startFrame: 15, endFrame: 20 },
  ];
  assert.match(validateSplicePlan(bad, FRAMES, KF), /gap|overlap/i);
});

check('rejects a cut that is not a real keyframe', () => {
  const bad = [
    { kind: 'keep', startFrame: 0, endFrame: 6 }, // 6 is not a keyframe
    { kind: 'reencode', startFrame: 6, endFrame: 10 },
    { kind: 'keep', startFrame: 10, endFrame: 20 },
  ];
  assert.match(validateSplicePlan(bad, FRAMES, KF), /not a keyframe/i);
});

check('rejects adjacent same-kind regions (unmerged)', () => {
  const bad = [
    { kind: 'reencode', startFrame: 0, endFrame: 5 },
    { kind: 'reencode', startFrame: 5, endFrame: 10 },
    { kind: 'keep', startFrame: 10, endFrame: 20 },
  ];
  assert.match(validateSplicePlan(bad, FRAMES, KF), /share kind/i);
});

check('rejects a plan that does not reach frameCount', () => {
  const bad = [{ kind: 'reencode', startFrame: 0, endFrame: 15 }];
  assert.match(validateSplicePlan(bad, FRAMES, KF), /ends at 15, expected 20/i);
});

console.log('validateSpliceOutput — partial never lies');

const OK_OUTPUT = {
  keptPackets: 15,
  reencodedPackets: 5,
  outputVideoPackets: 20,
  expectedVideoPackets: 20,
  outputDurationSeconds: 20 / 24,
  baseDurationSeconds: 20 / 24,
  fps: 24,
};

check('matching counts + duration → null (accept)', () => {
  assert.equal(validateSpliceOutput(OK_OUTPUT), null);
});

check('kept + reencoded ≠ written → reject', () => {
  assert.match(
    validateSpliceOutput({ ...OK_OUTPUT, keptPackets: 14 }),
    /≠ 20 written/,
  );
});

check('frame count changed by the splice → reject', () => {
  assert.match(
    validateSpliceOutput({ ...OK_OUTPUT, outputVideoPackets: 19, keptPackets: 14, expectedVideoPackets: 20 }),
    /preserve frame count/i,
  );
});

check('duration drift beyond one frame → reject', () => {
  assert.match(
    validateSpliceOutput({ ...OK_OUTPUT, outputDurationSeconds: 20 / 24 + 0.5 }),
    /drifts/i,
  );
});

console.log('chronos stages + progress model');

check('splice stages are distinct strings and not reused', () => {
  const values = Object.values(PARTIAL_SPLICE_STAGES);
  assert.equal(new Set(values).size, values.length);
  assert.equal(PARTIAL_SPLICE_STAGES.scan, 'partial-splice-scan');
  assert.equal(PARTIAL_SPLICE_STAGES.reencode, 'partial-splice-reencode');
  assert.equal(PARTIAL_SPLICE_STAGES.assemble, 'partial-splice-assemble');
  // Must not collide with the plan telemetry stage.
  assert.notEqual(PARTIAL_SPLICE_STAGES.reencode, PARTIAL_REBAKE_PLAN_STAGE);
  assert.ok(!values.includes(PARTIAL_REBAKE_PLAN_STAGE));
});

check('stage bands are contiguous and cover [0,1] with reencode dominant', () => {
  assert.deepEqual(spliceStageBand(PARTIAL_SPLICE_STAGES.scan), { start: 0, end: 0.05 });
  assert.deepEqual(spliceStageBand(PARTIAL_SPLICE_STAGES.reencode), { start: 0.05, end: 0.85 });
  assert.deepEqual(spliceStageBand(PARTIAL_SPLICE_STAGES.assemble), { start: 0.85, end: 1 });
  assert.equal(computeSpliceProgress(PARTIAL_SPLICE_STAGES.scan, 1), 0.05);
  assert.equal(computeSpliceProgress(PARTIAL_SPLICE_STAGES.reencode, 0), 0.05);
  assert.equal(computeSpliceProgress(PARTIAL_SPLICE_STAGES.reencode, 1), 0.85);
  assert.equal(computeSpliceProgress(PARTIAL_SPLICE_STAGES.assemble, 1), 1);
});

check('leg ratios derive from real counters and clamp', () => {
  assert.equal(computeSpliceReencodeRatio(0, 10), 0);
  assert.equal(computeSpliceReencodeRatio(5, 10), 0.5);
  assert.equal(computeSpliceReencodeRatio(20, 10), 1); // clamp
  assert.equal(computeSpliceReencodeRatio(5, 0), 0); // unknown total
  assert.equal(computeSpliceAssembleRatio(10, 20), 0.5);
});

console.log('integration — planner → splice on aligned grid keyframes');

check('on-grid keyframes reproduce the planner spans exactly', () => {
  const durationSeconds = 60;
  const fps = 24;
  const frameCount = durationSeconds * fps; // 1440
  const keyframeIntervalSeconds = 2;
  // Encoder honored the 2s cadence: keyframes every 48 frames.
  const keyframeFrames = [];
  for (let f = 0; f < frameCount; f += keyframeIntervalSeconds * fps) keyframeFrames.push(f);

  const rebake = planPartialRebake({
    windows: [{ startSeconds: 5, endSeconds: 6 }],
    durationSeconds,
    fps,
    keyframeIntervalSeconds,
  });
  assert.equal(rebake.strategy, 'partial');

  const plan = planSplice({ spans: rebake.spans, keyframeFrames, frameCount });
  assert.equal(plan.strategy, 'partial');
  // Grid span was [4s,6s) = frames [96,144); on-grid keyframes align identically.
  const reencode = plan.regions.find((r) => r.kind === 'reencode');
  assert.equal(reencode.startFrame, 96);
  assert.equal(reencode.endFrame, 144);
  assertWellFormed(plan, frameCount, keyframeFrames);
});

console.log('scanKeyframes — splice-friendly gate');

/** Build synthetic decode-ordered packet metas at a fixed fps with given keyframe indices. */
function packetsAt(fps, count, keyIndices) {
  const keys = new Set(keyIndices);
  return Array.from({ length: count }, (_, i) => ({
    timestamp: i / fps,
    type: keys.has(i) ? 'key' : 'delta',
  }));
}

check('extracts keyframe frame indices from a well-formed stream', () => {
  const scan = scanKeyframes(packetsAt(24, 20, [0, 5, 10, 15]));
  assert.deepEqual(scan.keyframeFrames, [0, 5, 10, 15]);
  assert.equal(scan.frameCount, 20);
});

check('feeds planSplice end-to-end from scanned keyframes', () => {
  const scan = scanKeyframes(packetsAt(24, 20, [0, 5, 10, 15]));
  const plan = planSplice({
    spans: [{ startFrame: 6, frameCount: 2 }],
    keyframeFrames: scan.keyframeFrames,
    frameCount: scan.frameCount,
  });
  assert.equal(plan.strategy, 'partial');
  assert.equal(validateSplicePlan(plan.regions, scan.frameCount, scan.keyframeFrames), null);
});

check('rejects an empty track', () => {
  assert.equal(scanKeyframes([]), null);
});

check('rejects a stream whose first packet is not a keyframe', () => {
  const packets = packetsAt(24, 5, [2]); // no key at index 0
  assert.equal(scanKeyframes(packets), null);
});

check('rejects reordered (B-frame) decode order — non-increasing PTS', () => {
  const packets = [
    { timestamp: 0, type: 'key' },
    { timestamp: 2 / 24, type: 'delta' }, // P before B (decode order)
    { timestamp: 1 / 24, type: 'delta' }, // B out of order → reject
    { timestamp: 3 / 24, type: 'delta' },
  ];
  assert.equal(scanKeyframes(packets), null);
});

check('rejects duplicate timestamps (breaks 1:1 index mapping)', () => {
  const packets = [
    { timestamp: 0, type: 'key' },
    { timestamp: 1 / 24, type: 'delta' },
    { timestamp: 1 / 24, type: 'delta' },
  ];
  assert.equal(scanKeyframes(packets), null);
});

check('diagnoseKeyframeScanFailure: empty', () => {
  assert.match(diagnoseKeyframeScanFailure([]), /no video packets/);
});

check('diagnoseKeyframeScanFailure: first-not-key', () => {
  assert.match(diagnoseKeyframeScanFailure(packetsAt(24, 5, [2])), /first packet is 'delta'/);
});

check('diagnoseKeyframeScanFailure: non-monotonic PTS (alt-ref style)', () => {
  const packets = [
    { timestamp: 0, type: 'key' },
    { timestamp: 0.333, type: 'delta' }, // alt-ref with future PTS
    { timestamp: 0.041, type: 'delta' }, // then normal frame → non-monotonic
  ];
  assert.equal(scanKeyframes(packets), null);
  const reason = diagnoseKeyframeScanFailure(packets);
  assert.match(reason, /non-monotonic PTS at packet 2/);
  assert.match(reason, /alt-ref/);
});

console.log('selectSpliceFidelityAnchors — the decode-back gate probes');

// frames at 24fps for a 20-frame clip; a splice keep/reencode/keep layout.
const FT = Array.from({ length: 20 }, (_, i) => i / 24);
const REGIONS = [
  { kind: 'keep', startFrame: 0, endFrame: 5 },
  { kind: 'reencode', startFrame: 5, endFrame: 10 },
  { kind: 'keep', startFrame: 10, endFrame: 20 },
];

check('keep anchors come only from keep regions', () => {
  const sel = selectSpliceFidelityAnchors(REGIONS, FT, { maxKeepAnchorsPerRegion: 3 });
  // No keep anchor may fall inside the reencode region [5,10) (frames 5..9).
  for (const t of sel.keepAnchors) {
    const frame = Math.round(t * 24);
    assert.ok(frame < 5 || frame >= 10, `keep anchor at frame ${frame} is inside a dirty region`);
  }
  assert.ok(sel.keepAnchors.length > 0);
});

check('boundary anchors straddle the internal cut (frames 4,5 and 9,10)', () => {
  const sel = selectSpliceFidelityAnchors(REGIONS, FT);
  const frames = sel.boundaryAnchors.map((t) => Math.round(t * 24));
  for (const f of [4, 5, 9, 10]) assert.ok(frames.includes(f), `missing boundary frame ${f}`);
  // clip start + end always present.
  assert.ok(frames.includes(0));
  assert.ok(frames.includes(19));
});

check('allAnchors is the sorted unique union', () => {
  const sel = selectSpliceFidelityAnchors(REGIONS, FT);
  const union = [...new Set([...sel.keepAnchors, ...sel.boundaryAnchors])].sort((a, b) => a - b);
  assert.deepEqual(sel.allAnchors, union);
  for (let i = 1; i < sel.allAnchors.length; i += 1) {
    assert.ok(sel.allAnchors[i] > sel.allAnchors[i - 1]); // strictly ascending, deduped
  }
});

check('single all-keep region still probes (degenerate splice)', () => {
  const sel = selectSpliceFidelityAnchors(
    [{ kind: 'keep', startFrame: 0, endFrame: 20 }],
    FT,
    { maxKeepAnchorsPerRegion: 4 },
  );
  assert.ok(sel.keepAnchors.length >= 2);
  assert.deepEqual(sel.boundaryAnchors, [FT[0], FT[19]]); // no internal boundary
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-splice-plan: ${checks} checks passed`);
