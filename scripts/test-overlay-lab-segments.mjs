// Overlay lab synthetic segment fixtures (v5.3.4 Phase 5.4).
//
//   Run:  node scripts/test-overlay-lab-segments.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-overlay-lab-'));
const outfile = join(outdir, 'bundle.mjs');

await build({
  entryPoints: [join(root, 'src/ui/design-studio/subtitle-overlay-lab-segments.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { '@': root },
  logLevel: 'silent',
});

const {
  buildOverlayLabSegments,
  overlayLabDurationSeconds,
  resolveOverlayLabTranscriptResult,
} = await import(pathToFileURL(outfile).href);

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
    console.error(`    ${error.message}`);
  }
}

console.log('\nOverlay lab segment fixtures\n');

check('short set has 3 cues spanning 10s', () => {
  const segments = buildOverlayLabSegments('short');
  assert.equal(segments.length, 3);
  assert.ok(segments[0].start >= 0);
  assert.ok(segments.at(-1).end <= 10);
});

check('medium set has 8 cues spanning 30s', () => {
  const segments = buildOverlayLabSegments('medium');
  assert.equal(segments.length, 8);
  assert.ok(segments.at(-1).end <= 30);
});

check('long set has 16 cues (15+) spanning 60s', () => {
  const segments = buildOverlayLabSegments('long');
  assert.equal(segments.length, 16);
  assert.ok(segments.length >= 15);
  assert.ok(segments.at(-1).end <= 60);
});

check('session set falls back to session edited result', () => {
  const session = {
    text: 'one two',
    segments: [{ start: 0, end: 2, text: 'one' }, { start: 2, end: 4, text: 'two' }],
    source: 'manual',
    duration: 4,
  };
  const resolved = resolveOverlayLabTranscriptResult('session', session);
  assert.equal(resolved, session);
});

check('session set returns null when no cues', () => {
  assert.equal(resolveOverlayLabTranscriptResult('session', null), null);
  assert.equal(resolveOverlayLabTranscriptResult('session', { text: '', segments: [], source: 'manual' }), null);
});

check('overlayLabDurationSeconds uses fixture duration for synthetic sets', () => {
  assert.equal(overlayLabDurationSeconds('short', null), 10);
  assert.equal(overlayLabDurationSeconds('medium', null), 30);
  assert.equal(overlayLabDurationSeconds('long', null), 60);
});

rmSync(outdir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);