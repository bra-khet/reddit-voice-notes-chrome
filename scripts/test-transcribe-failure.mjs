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

// BUG FIX: tab-close transcript completion was owned by a disposable page (BUG-038)
// Fix: bundle the background-neutral completion normalizer, which re-exports the
//      existing classifier, so terminal success/failure/cancellation is guarded.

await build({
  entryPoints: [join(root, 'src/transcription/transcribe-completion.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { '@': root },
  logLevel: 'silent',
});

const { classifyTranscribeFailure, prepareTranscribeCompletionForPersistence } = await import(
  pathToFileURL(outfile).href
);

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

console.log('\nprepareTranscribeCompletionForPersistence\n');

check('successful offscreen completion is persistable without the initiating tab', () => {
  const prepared = prepareTranscribeCompletionForPersistence(
    {
      ok: true,
      transcriptJson: JSON.stringify(result({
        text: 'survived tab close',
        segments: [{ start: 0, end: 1, text: 'survived tab close' }],
      })),
    },
    12,
  );
  assert.equal(prepared.result.text, 'survived tab close');
  assert.equal(prepared.result.segments.length, 1);
  assert.equal(prepared.meta, undefined);
});

check('timeout completion becomes a timed scaffold with terminal metadata', () => {
  const prepared = prepareTranscribeCompletionForPersistence(
    { ok: false, error: 'Transcription timed out after 120s' },
    12,
    'en',
  );
  assert.equal(prepared.meta.error.type, 'timeout');
  assert.equal(prepared.meta.isScaffolded, true);
  assert.ok(prepared.result.segments.length > 0);
  assert.equal(prepared.result.duration, 12);
});

check('inference failure becomes scaffolded instead of leaving Pending forever', () => {
  const prepared = prepareTranscribeCompletionForPersistence(
    { ok: false, error: 'worker inference failed' },
    9,
  );
  assert.equal(prepared.meta.error.type, 'inference-error');
  assert.equal(prepared.result.duration, 9);
});

check('cancelled/superseded completion is never persisted over a newer take', () => {
  assert.equal(
    prepareTranscribeCompletionForPersistence({ ok: false, error: 'cancelled' }, 9),
    null,
  );
});

check('invalid successful transcript JSON fails loudly', () => {
  assert.throws(
    () => prepareTranscribeCompletionForPersistence({ ok: true, transcriptJson: '{"text":7}' }, 9),
    /invalid transcript JSON/,
  );
});

rmSync(outdir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
