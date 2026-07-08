// v5.6.0 — Voice re-apply plan tests: chronos stage distinctness, honest
// progress banding, remux packet-counter progress, and output validation.
//
//   Run:  node scripts/test-voice-reapply-plan.mjs
//
// Only the pure plan layer is tested here (docs/v5.6.0-audio-decoupling.md §8);
// the browser-only orchestration (voice-reapply.ts / audio-remux.ts) is QA'd
// in the Studio.

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-voice-reapply-plan-'));
const outfile = join(outdir, 'bundle.mjs');

await build({
  entryPoints: [join(root, 'src/audio/voice-reapply-plan.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { '@': root },
  logLevel: 'silent',
});

const {
  AUDIO_TAIL_ALLOWANCE_SECONDS,
  AUDIO_UNDERRUN_TOLERANCE_SECONDS,
  VOICE_REAPPLY_STAGES,
  cleanAudioUnavailableMessage,
  computeRemuxProgress,
  computeVoiceReapplyProgress,
  shouldDropTailAudioPacket,
  validateAudioRemuxOutput,
  voiceReapplyStageBand,
} = await import(pathToFileURL(outfile).href);

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

console.log('chronos stages');

check('stage strings are distinct and voice-reapply-prefixed', () => {
  const stages = Object.values(VOICE_REAPPLY_STAGES);
  assert.equal(new Set(stages).size, stages.length);
  for (const stage of stages) {
    assert.match(stage, /^voice-reapply-/);
  }
});

console.log('progress banding');

check('bands are contiguous, monotonic, and cover [0,1]', () => {
  for (const hasBaked of [true, false]) {
    const order = hasBaked
      ? [
          VOICE_REAPPLY_STAGES.dsp,
          VOICE_REAPPLY_STAGES.remuxBase,
          VOICE_REAPPLY_STAGES.remuxBaked,
          VOICE_REAPPLY_STAGES.save,
        ]
      : [VOICE_REAPPLY_STAGES.dsp, VOICE_REAPPLY_STAGES.remuxBase, VOICE_REAPPLY_STAGES.save];
    let cursor = 0;
    for (const stage of order) {
      const band = voiceReapplyStageBand(stage, hasBaked);
      assert.ok(band.start >= cursor - 1e-9, `${stage} starts at/after prior end`);
      assert.ok(band.end > band.start, `${stage} band non-empty`);
      cursor = band.end;
    }
    assert.ok(Math.abs(cursor - 1) < 0.06, 'final band reaches ~1');
  }
});

check('computeVoiceReapplyProgress clamps stage ratio and stays in band', () => {
  const band = voiceReapplyStageBand(VOICE_REAPPLY_STAGES.dsp, true);
  assert.equal(computeVoiceReapplyProgress(VOICE_REAPPLY_STAGES.dsp, -1, true), band.start);
  assert.equal(computeVoiceReapplyProgress(VOICE_REAPPLY_STAGES.dsp, 2, true), band.end);
  const mid = computeVoiceReapplyProgress(VOICE_REAPPLY_STAGES.dsp, 0.5, true);
  assert.ok(mid > band.start && mid < band.end);
});

check('no baked leg: base remux band absorbs the baked band', () => {
  const withBaked = voiceReapplyStageBand(VOICE_REAPPLY_STAGES.remuxBase, true);
  const withoutBaked = voiceReapplyStageBand(VOICE_REAPPLY_STAGES.remuxBase, false);
  assert.ok(withoutBaked.end > withBaked.end);
});

console.log('remux progress (real packet counters)');

check('progress is packet-count weighted, clamped, and monotone-safe', () => {
  assert.equal(computeRemuxProgress(0, 0, 100, 50), 0);
  assert.equal(computeRemuxProgress(50, 25, 100, 50), 0.5);
  assert.equal(computeRemuxProgress(100, 50, 100, 50), 1);
  // Over-count can never push past 1; negatives never below 0.
  assert.equal(computeRemuxProgress(200, 100, 100, 50), 1);
  assert.equal(computeRemuxProgress(-5, -5, 100, 50), 0);
  // Unknown totals yield 0 (never NaN/Infinity).
  assert.equal(computeRemuxProgress(10, 10, 0, 0), 0);
});

console.log('tail rule');

check('packets beyond video end + allowance are dropped', () => {
  const videoEnd = 60;
  assert.equal(shouldDropTailAudioPacket(59.9, videoEnd), false);
  assert.equal(
    shouldDropTailAudioPacket(videoEnd + AUDIO_TAIL_ALLOWANCE_SECONDS - 0.01, videoEnd),
    false,
  );
  assert.equal(
    shouldDropTailAudioPacket(videoEnd + AUDIO_TAIL_ALLOWANCE_SECONDS, videoEnd),
    true,
  );
});

console.log('output validation');

const GOOD = {
  videoPacketsMuxed: 1440,
  audioPacketsMuxed: 2812,
  expectedVideoPackets: 1440,
  videoDurationSeconds: 60,
  audioEndSeconds: 60.02,
};

check('accepts a healthy remux', () => {
  assert.equal(validateAudioRemuxOutput(GOOD), null);
});

check('rejects video packet loss (stream copy must be exact)', () => {
  const failure = validateAudioRemuxOutput({ ...GOOD, videoPacketsMuxed: 1439 });
  assert.match(failure, /1439/);
});

check('rejects empty audio', () => {
  assert.match(validateAudioRemuxOutput({ ...GOOD, audioPacketsMuxed: 0 }), /no audio/);
});

check('rejects audio underrun beyond tolerance; allows within', () => {
  const shortEnd = GOOD.videoDurationSeconds - AUDIO_UNDERRUN_TOLERANCE_SECONDS - 0.05;
  assert.match(validateAudioRemuxOutput({ ...GOOD, audioEndSeconds: shortEnd }), /ends/);
  const okEnd = GOOD.videoDurationSeconds - AUDIO_UNDERRUN_TOLERANCE_SECONDS + 0.05;
  assert.equal(validateAudioRemuxOutput({ ...GOOD, audioEndSeconds: okEnd }), null);
});

check('rejects audio overrun beyond tail allowance (+tolerance)', () => {
  const farEnd =
    GOOD.videoDurationSeconds + AUDIO_TAIL_ALLOWANCE_SECONDS + AUDIO_UNDERRUN_TOLERANCE_SECONDS + 0.05;
  assert.match(validateAudioRemuxOutput({ ...GOOD, audioEndSeconds: farEnd }), /overruns/);
});

console.log('availability copy');

check('every unavailability reason has honest, distinct copy', () => {
  const reasons = ['no-take', 'no-stamp', 'store-empty', 'stamp-mismatch'];
  const messages = reasons.map((r) => cleanAudioUnavailableMessage(r));
  assert.equal(new Set(messages).size, messages.length);
  for (const message of messages) {
    assert.ok(message.length > 10);
  }
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-voice-reapply-plan: ${checks} checks passed`);
