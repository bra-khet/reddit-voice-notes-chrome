// Smart Adjust proposal builders (Phase 1).
//
//   Run:  node scripts/test-smart-adjust.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-smart-adjust-'));

async function bundle(entry, name) {
  const outfile = join(outdir, `${name}.mjs`);
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
  proposeShiftLastWordToNext,
  proposeShiftFirstWordToPrevious,
  proposeGlobalFontReduction,
  buildReSpliceProposal,
  findOverflowingCueIndices,
} = await bundle('src/transcription/smart-adjust.ts', 'adjust');

const { buildCaptionMetricsContext } = await bundle(
  'src/transcription/subtitle-caption-fit.ts',
  'fit',
);

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${error instanceof Error ? error.message : String(error)}`);
  }
}

const charMeasure = (text) => text.length;
const metrics = buildCaptionMetricsContext(undefined, charMeasure);
metrics.maxWidth = 20;

console.log('word-shift proposals\n');

check('shift last word to next when both cues fit', () => {
  const segments = [
    { start: 0, end: 3, text: 'one two three' },
    { start: 3, end: 6, text: 'four' },
  ];
  const proposal = proposeShiftLastWordToNext(segments, 0, metrics);
  assert.ok(proposal);
  assert.equal(proposal.segments[0].text, 'one two');
  assert.equal(proposal.segments[1].text, 'three four');
});

check('shift first word to previous when both cues fit', () => {
  const segments = [
    { start: 0, end: 3, text: 'aa' },
    { start: 3, end: 6, text: 'bb cc dd' },
  ];
  const proposal = proposeShiftFirstWordToPrevious(segments, 1, metrics);
  assert.ok(proposal);
  assert.equal(proposal.segments[0].text, 'aa bb');
  assert.equal(proposal.segments[1].text, 'cc dd');
});

console.log('\nre-splice proposals\n');

check('full re-splice splits long original segment', () => {
  const longText = 'alpha beta gamma delta epsilon zeta';
  const tightMetrics = { ...metrics, maxWidth: 12 };
  const original = {
    text: longText,
    source: 'vosk',
    segments: [{ start: 0, end: 8, text: longText }],
  };
  const edited = {
    text: longText,
    source: 'manual',
    segments: [{ start: 0, end: 8, text: longText }],
  };
  const proposal = buildReSpliceProposal(original, edited, tightMetrics, 'full');
  assert.ok(proposal.segments.length > 1);
});

check('preserve mode keeps hand-edited cue', () => {
  const original = {
    text: 'hello world',
    source: 'vosk',
    segments: [{ start: 0, end: 4, text: 'hello world' }],
  };
  const edited = {
    text: 'hello brave world',
    source: 'manual',
    segments: [{ start: 0, end: 4, text: 'hello brave world' }],
  };
  const proposal = buildReSpliceProposal(original, edited, metrics, 'preserve');
  assert.equal(proposal.segments.some((s) => s.text === 'hello brave world'), true);
});

console.log('\noverflow scan\n');

check('findOverflowingCueIndices flags wide cues only', () => {
  const segments = [
    { start: 0, end: 1, text: 'short' },
    { start: 1, end: 2, text: 'this one is definitely too long' },
  ];
  const indices = findOverflowingCueIndices(segments, metrics);
  assert.deepEqual(indices, [1]);
});

rmSync(outdir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);