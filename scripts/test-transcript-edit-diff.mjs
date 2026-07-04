// Per-cue manual-edit diff for Smart Adjust re-splice (Phase 1).
//
//   Run:  node scripts/test-transcript-edit-diff.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-edit-diff-'));

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
  normalizeCueTextForDiff,
  findOverlappingOriginalSegment,
  isCueManuallyEdited,
  classifyEditedCueSegments,
  countManuallyEditedCues,
} = await bundle('src/transcription/transcript-edit-diff.ts', 'diff');

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

const originalSegments = [
  { start: 0, end: 3, text: 'hello world' },
  { start: 3, end: 6, text: 'second cue here' },
];

const original = {
  text: 'hello world second cue here',
  source: 'vosk',
  segments: originalSegments,
};

console.log('normalizeCueTextForDiff\n');

check('strips scaffold placeholder and collapses whitespace', () => {
  assert.equal(normalizeCueTextForDiff('  hello   world  '), 'hello world');
});

console.log('\nfindOverlappingOriginalSegment\n');

check('picks segment with maximum time overlap', () => {
  const edited = { start: 2.5, end: 5, text: 'edited' };
  const match = findOverlappingOriginalSegment(edited, originalSegments);
  assert.equal(match?.text, 'second cue here');
});

check('returns null when no temporal overlap', () => {
  const edited = { start: 10, end: 12, text: 'new' };
  assert.equal(findOverlappingOriginalSegment(edited, originalSegments), null);
});

console.log('\nisCueManuallyEdited\n');

check('unchanged text → not manually edited', () => {
  const seg = { start: 0, end: 3, text: 'hello world' };
  assert.equal(isCueManuallyEdited(seg, originalSegments), false);
});

check('changed text → manually edited', () => {
  const seg = { start: 0, end: 3, text: 'hello brave world' };
  assert.equal(isCueManuallyEdited(seg, originalSegments), true);
});

check('new cue with no overlap → manually edited', () => {
  const seg = { start: 9, end: 11, text: 'brand new' };
  assert.equal(isCueManuallyEdited(seg, originalSegments), true);
});

console.log('\nclassifyEditedCueSegments\n');

check('classifies mixed edited / untouched cues', () => {
  const edited = {
    text: 'hello brave world second cue here',
    source: 'manual',
    segments: [
      { start: 0, end: 3, text: 'hello brave world' },
      { start: 3, end: 6, text: 'second cue here' },
    ],
  };
  const rows = classifyEditedCueSegments(edited, original);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].manuallyEdited, true);
  assert.equal(rows[1].manuallyEdited, false);
  assert.equal(countManuallyEditedCues(edited, original), 1);
});

rmSync(outdir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);