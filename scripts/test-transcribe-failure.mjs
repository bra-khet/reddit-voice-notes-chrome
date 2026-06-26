// Standalone unit check for classifyTranscribeFailure (v5.3 subtitle QoL Phase 2).
// Same zero-dep esbuild approach as test-scaffold.mjs.
//   Run:  node scripts/test-transcribe-failure.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-failure-'));
const outfile = join(outdir, 'bundle.mjs');

await build({
  entryPoints: [join(root, 'src/transcription/transcribe-failure.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { '@': root },
  logLevel: 'silent',
});

const { classifyTranscribeFailure } = await import(pathToFileURL(outfile).href);

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓', name);
  } catch (err) {
    failed++;
    console.error('  ✗', name, '\n      ', err.message);
  }
}

const result = (over = {}) => ({ text: '', segments: [], source: 'vosk', ...over });

console.log('classifyTranscribeFailure\n');

check('applied success → null', () => {
  assert.equal(
    classifyTranscribeFailure({ applied: true, fallback: false, stage: 'vosk-complete', result: result({ text: 'hi' }) }),
    null,
  );
});

check('timeout stage → timeout (even though fallback is also true)', () => {
  const r = classifyTranscribeFailure({
    applied: false,
    fallback: true,
    stage: 'Transcription timed out after 120s',
    result: result(),
  });
  assert.equal(r.type, 'timeout');
  assert.match(r.message, /timed out/i);
});

check('no-speech thrown by host (fallback:true + marker) → no-speech, NOT inference-error', () => {
  // Exact shape from QA log: host throws on empty text → caught as fallback:true.
  const r = classifyTranscribeFailure({
    applied: false,
    fallback: true,
    stage:
      'Vosk returned no speech after 5640ms audio (90240 frames @ 16000Hz (5.6s, peak=0.009, rms=0.0007)). Check PCM decode and worker pacing.',
    result: result(),
  });
  assert.equal(r.type, 'no-speech');
});

check('fallback throw (non-timeout, no marker) → inference-error', () => {
  const r = classifyTranscribeFailure({
    applied: false,
    fallback: true,
    stage: 'decode failed: bad webm',
    result: result(),
  });
  assert.equal(r.type, 'inference-error');
});

check('clean run, no segments/text → no-speech', () => {
  const r = classifyTranscribeFailure({
    applied: false,
    fallback: false,
    stage: 'vosk-complete',
    result: result(),
  });
  assert.equal(r.type, 'no-speech');
});

check('not applied but has content → empty-result (defensive)', () => {
  const r = classifyTranscribeFailure({
    applied: false,
    fallback: false,
    stage: 'vosk-complete',
    result: result({ segments: [{ start: 0, end: 1, text: 'x' }] }),
  });
  assert.equal(r.type, 'empty-result');
});

check('missing stage on fallback still classifies + gives a message', () => {
  const r = classifyTranscribeFailure({ applied: false, fallback: true, stage: '', result: result() });
  assert.equal(r.type, 'inference-error');
  assert.ok(r.message.length > 0);
});

rmSync(outdir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
