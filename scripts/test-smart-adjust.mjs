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
  collectMinimalFixProposals,
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
metrics.splitBudget = 20;

console.log('word-shift proposals\n');

// BUG FIX: Smart Adjust word-shift cue adjacency
// Fix: Cover the inclusive 0.2-second boundary, larger-gap suppression, and re-splice availability.
// Sync: src/transcription/smart-adjust.ts
check('shift last word to next at the 0.2-second gap boundary', () => {
  const segments = [
    { start: 0, end: 3, text: 'one two three' },
    { start: 3.2, end: 6, text: 'four' },
  ];
  const proposal = proposeShiftLastWordToNext(segments, 0, metrics);
  assert.ok(proposal);
  assert.equal(proposal.segments[0].text, 'one two');
  assert.equal(proposal.segments[1].text, 'three four');
});

check('shift first word to previous at the 0.2-second gap boundary', () => {
  const segments = [
    { start: 0, end: 3, text: 'aa' },
    { start: 3.2, end: 6, text: 'bb cc dd' },
  ];
  const proposal = proposeShiftFirstWordToPrevious(segments, 1, metrics);
  assert.ok(proposal);
  assert.equal(proposal.segments[0].text, 'aa bb');
  assert.equal(proposal.segments[1].text, 'cc dd');
});

check('word shifts allow zero-gap and overlapping cues', () => {
  const zeroGapSegments = [
    { start: 0, end: 3, text: 'one two three' },
    { start: 3, end: 6, text: 'four five six' },
  ];
  const overlappingSegments = [
    { start: 0, end: 3.1, text: 'one two three' },
    { start: 3, end: 6, text: 'four five six' },
  ];
  for (const segments of [zeroGapSegments, overlappingSegments]) {
    assert.ok(proposeShiftLastWordToNext(segments, 0, metrics));
    assert.ok(proposeShiftFirstWordToPrevious(segments, 1, metrics));
  }
});

check('word shifts are suppressed when the cue gap exceeds 0.2 seconds', () => {
  const segments = [
    { start: 0, end: 3, text: 'one two three' },
    { start: 3.201, end: 6, text: 'four five six' },
  ];
  assert.equal(proposeShiftLastWordToNext(segments, 0, metrics), null);
  assert.equal(proposeShiftFirstWordToPrevious(segments, 1, metrics), null);
});

check('large-gap word shifts are absent from minimal-fix proposals', () => {
  const segments = [
    { start: 0, end: 3, text: 'one two three' },
    { start: 4, end: 6, text: 'four five six' },
  ];
  const proposals = collectMinimalFixProposals(segments, [0, 1], metrics, metrics.fontSize);
  assert.equal(
    proposals.some(({ kind }) => kind === 'shift-word-next' || kind === 'shift-word-prev'),
    false,
  );
});

console.log('\nre-splice proposals\n');

check('full re-splice splits long original segment', () => {
  const longText = 'alpha beta gamma delta epsilon zeta';
  const tightMetrics = { ...metrics, splitBudget: 12 };
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

check('full re-splice remains available across a large inter-cue gap', () => {
  const tightMetrics = { ...metrics, splitBudget: 12 };
  const original = {
    text: 'alpha beta gamma delta second cue',
    source: 'vosk',
    segments: [
      { start: 0, end: 3, text: 'alpha beta gamma delta' },
      { start: 4, end: 6, text: 'second cue' },
    ],
  };
  const edited = {
    ...original,
    source: 'manual',
    segments: original.segments.map((segment) => ({ ...segment })),
  };
  const proposal = buildReSpliceProposal(original, edited, tightMetrics, 'full');
  assert.equal(proposal.kind, 're-splice-full');
  assert.ok(proposal.segments.length > original.segments.length);
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

check('findOverflowingCueIndices flags bake-overflow cues only', () => {
  const tightMetrics = {
    ...metrics,
    measure: (text) => text.length,
    bakeWidth: 100,
    bakeSafeInkMax: 70,
  };
  const segments = [
    { start: 0, end: 1, text: 'short' },
    { start: 1, end: 2, text: 'x'.repeat(80) },
  ];
  const indices = findOverflowingCueIndices(segments, tightMetrics);
  assert.deepEqual(indices, [1]);
});

rmSync(outdir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
