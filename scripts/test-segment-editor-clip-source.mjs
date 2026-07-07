// Segment-editor clip source tests — TakeManager-backed OOB/preview resolution.
//
//   Run:  node scripts/test-segment-editor-clip-source.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-segment-editor-clip-'));
const outfile = join(outdir, 'bundle.mjs');

await build({
  entryPoints: [join(root, 'src/transcription/segment-editor-clip-source.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { '@': root },
  logLevel: 'silent',
});

const {
  segmentEditorAudioSourceCacheKey,
  selectSegmentEditorAudioSourceKind,
} = await import(pathToFileURL(outfile).href);

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ok ${name}`);
}

const NOW = 1_800_000_000_000;

function validTake(overrides = {}) {
  return {
    id: 'take-abc',
    status: 'ready',
    source: 'studio',
    createdAt: NOW - 60_000,
    lastUpdated: NOW - 30_000,
    meta: { durationSeconds: 119 },
    artifacts: {
      baseRecording: { savedAt: NOW - 45_000, byteLength: 1_000_000, durationSeconds: 119 },
      baseMp4: { savedAt: NOW - 31_000, byteLength: 2_000_000, durationSeconds: 119 },
    },
    ...overrides,
  };
}

check('prefers baseMp4 when its stamp matches the store', () => {
  const take = validTake();
  const kind = selectSegmentEditorAudioSourceKind(
    take,
    { savedAt: NOW - 31_000, byteLength: 2_000_000 },
    { savedAt: NOW - 45_000, byteLength: 1_000_000 },
  );
  assert.equal(kind, 'baseMp4');
});

check('falls back to baseRecording when baseMp4 stamp mismatches', () => {
  const take = validTake();
  const kind = selectSegmentEditorAudioSourceKind(
    take,
    { savedAt: NOW - 1_000, byteLength: 99 },
    { savedAt: NOW - 45_000, byteLength: 1_000_000 },
  );
  assert.equal(kind, 'baseRecording');
});

check('returns null when both stamps mismatch (stale single-slot store)', () => {
  const take = validTake();
  const kind = selectSegmentEditorAudioSourceKind(
    take,
    { savedAt: NOW - 1_000, byteLength: 99 },
    { savedAt: NOW - 2_000, byteLength: 50_000 },
  );
  assert.equal(kind, null);
});

check('cache key changes when take duration updates without blob swap', () => {
  const takeA = validTake({ lastUpdated: NOW - 30_000, meta: { durationSeconds: 2 } });
  const takeB = validTake({ lastUpdated: NOW - 10_000, meta: { durationSeconds: 119 } });
  const source = {
    blob: new Blob(),
    sourceKind: 'baseMp4',
    savedAt: NOW - 31_000,
    metaDurationSeconds: 119,
  };
  assert.notEqual(
    segmentEditorAudioSourceCacheKey(takeA, source),
    segmentEditorAudioSourceCacheKey(takeB, source),
  );
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-segment-editor-clip-source: ${checks} checks passed`);