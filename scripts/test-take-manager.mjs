// v5.4.0 Phase 0 — TakeManager pure-layer tests: snapshot parsing/validation,
// stale-transient demotion, patch merge semantics.
//
//   Run:  node scripts/test-take-manager.mjs
//
// The storage-backed manager itself needs browser.storage (extension context);
// only the pure helpers are tested here — they carry the correctness-critical
// logic (untrusted-storage validation + crash recovery).

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-take-manager-'));
const outfile = join(outdir, 'bundle.mjs');

await build({
  entryPoints: [join(root, 'src/session/take-manager.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { '@': root },
  logLevel: 'silent',
});

const {
  ARTIFACT_STAMP_TOLERANCE_MS,
  CURRENT_TAKE_KEY,
  STALE_TRANSIENT_MS,
  createTakeId,
  isTransientTakeStatus,
  mergeTakePatch,
  normalizeStaleTake,
  parseCurrentTake,
  takeArtifactMatchesStore,
  takeFreshnessMs,
  isNewerTakeThan,
} = await import(pathToFileURL(outfile).href);

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

const NOW = 1_800_000_000_000;

function validTake(overrides = {}) {
  return {
    id: 'take-abc123-xyz',
    status: 'ready',
    source: 'reddit',
    createdAt: NOW - 60_000,
    lastUpdated: NOW - 30_000,
    meta: { durationSeconds: 42, subtitlesEnabled: true, activeProfileId: null },
    artifacts: {
      baseRecording: { savedAt: NOW - 45_000, byteLength: 1_000_000, durationSeconds: 42 },
      baseMp4: { savedAt: NOW - 31_000, byteLength: 2_000_000, durationSeconds: 42 },
    },
    ...overrides,
  };
}

console.log('parseCurrentTake');

check('valid snapshot round-trips', () => {
  const parsed = parseCurrentTake(validTake());
  assert.equal(parsed.id, 'take-abc123-xyz');
  assert.equal(parsed.status, 'ready');
  assert.equal(parsed.source, 'reddit');
  assert.equal(parsed.meta.durationSeconds, 42);
  assert.equal(parsed.meta.subtitlesEnabled, true);
  assert.equal(parsed.meta.activeProfileId, null);
  assert.equal(parsed.artifacts.baseRecording.byteLength, 1_000_000);
  assert.equal(parsed.artifacts.baseMp4.savedAt, NOW - 31_000);
  assert.equal(parsed.artifacts.bakedMp4, undefined);
});

check('rejects null / non-object / missing id / bad status', () => {
  assert.equal(parseCurrentTake(null), null);
  assert.equal(parseCurrentTake(undefined), null);
  assert.equal(parseCurrentTake('take'), null);
  assert.equal(parseCurrentTake({ ...validTake(), id: '' }), null);
  assert.equal(parseCurrentTake({ ...validTake(), id: 42 }), null);
  assert.equal(parseCurrentTake({ ...validTake(), status: 'exploded' }), null);
});

check('unknown source falls back to reddit; malformed stamps dropped', () => {
  const parsed = parseCurrentTake(
    validTake({
      source: 'mars',
      artifacts: {
        baseRecording: { savedAt: 'yesterday' },
        baseMp4: { savedAt: NOW, byteLength: 'big' },
        bakedMp4: 7,
      },
    }),
  );
  assert.equal(parsed.source, 'reddit');
  assert.equal(parsed.artifacts.baseRecording, undefined);
  assert.deepEqual(parsed.artifacts.baseMp4, {
    savedAt: NOW,
    byteLength: undefined,
    durationSeconds: undefined,
  });
  assert.equal(parsed.artifacts.bakedMp4, undefined);
});

check('missing meta/artifacts objects tolerated', () => {
  const parsed = parseCurrentTake({ id: 'take-x', status: 'draft' });
  assert.equal(parsed.status, 'draft');
  assert.deepEqual(parsed.artifacts, {});
  assert.equal(parsed.meta.durationSeconds, undefined);
});

console.log('normalizeStaleTake');

check('fresh transient statuses pass through', () => {
  const recording = parseCurrentTake(validTake({ status: 'recording', lastUpdated: NOW - 1000 }));
  assert.equal(normalizeStaleTake(recording, NOW).status, 'recording');
  const processing = parseCurrentTake(validTake({ status: 'processing', lastUpdated: NOW - 1000 }));
  assert.equal(normalizeStaleTake(processing, NOW).status, 'processing');
});

check('stale recording with artifacts demotes to draft, artifacts preserved', () => {
  const stale = parseCurrentTake(
    validTake({ status: 'recording', lastUpdated: NOW - STALE_TRANSIENT_MS - 1 }),
  );
  const normalized = normalizeStaleTake(stale, NOW);
  assert.equal(normalized.status, 'draft');
  assert.match(normalized.meta.note, /preserved/);
  assert.equal(normalized.artifacts.baseRecording.byteLength, 1_000_000);
});

check('stale recording without artifacts notes nothing was captured', () => {
  const stale = parseCurrentTake(
    validTake({ status: 'recording', lastUpdated: NOW - STALE_TRANSIENT_MS - 1, artifacts: {} }),
  );
  const normalized = normalizeStaleTake(stale, NOW);
  assert.equal(normalized.status, 'draft');
  assert.match(normalized.meta.note, /before anything/);
});

check('stable statuses never demote regardless of age', () => {
  for (const status of ['draft', 'ready', 'baked', 'error']) {
    const old = parseCurrentTake(validTake({ status, lastUpdated: NOW - 10 * STALE_TRANSIENT_MS }));
    assert.equal(normalizeStaleTake(old, NOW).status, status);
  }
  assert.equal(normalizeStaleTake(null, NOW), null);
});

console.log('mergeTakePatch');

check('meta and artifacts merge per-field; status replaces; lastUpdated bumps', () => {
  const take = parseCurrentTake(validTake());
  const merged = mergeTakePatch(
    take,
    {
      status: 'baked',
      meta: { note: 'done' },
      artifacts: { bakedMp4: { savedAt: NOW, byteLength: 3_000_000 } },
    },
    NOW,
  );
  assert.equal(merged.status, 'baked');
  assert.equal(merged.lastUpdated, NOW);
  assert.equal(merged.meta.durationSeconds, 42); // preserved
  assert.equal(merged.meta.note, 'done'); // added
  assert.equal(merged.artifacts.baseRecording.byteLength, 1_000_000); // preserved
  assert.equal(merged.artifacts.bakedMp4.byteLength, 3_000_000); // added
  assert.equal(merged.id, take.id);
});

check('empty patch only bumps lastUpdated', () => {
  const take = parseCurrentTake(validTake());
  const merged = mergeTakePatch(take, {}, NOW);
  assert.equal(merged.status, take.status);
  assert.equal(merged.lastUpdated, NOW);
  assert.deepEqual(merged.artifacts, take.artifacts);
});

console.log('takeFreshnessMs');

check('takeFreshnessMs picks the latest stamp', () => {
  const take = validTake({
    lastUpdated: NOW - 10_000,
    artifacts: {
      baseMp4: { savedAt: NOW - 5_000, byteLength: 1, durationSeconds: 10 },
      bakedMp4: { savedAt: NOW - 1_000, byteLength: 2, durationSeconds: 10 },
    },
  });
  assert.equal(takeFreshnessMs(parseCurrentTake(take)), NOW - 1_000);
});

check('isNewerTakeThan respects anchor freshness', () => {
  const older = parseCurrentTake(validTake({ lastUpdated: NOW - 60_000 }));
  const newer = parseCurrentTake(
    validTake({
      id: 'take-studio-new',
      source: 'studio',
      lastUpdated: NOW - 1_000,
      artifacts: {
        baseMp4: { savedAt: NOW - 500, byteLength: 1, durationSeconds: 12 },
      },
    }),
  );
  assert.equal(isNewerTakeThan(newer, takeFreshnessMs(older)), true);
  assert.equal(isNewerTakeThan(older, takeFreshnessMs(newer)), false);
});

console.log('helpers');

check('isTransientTakeStatus classifies correctly', () => {
  assert.equal(isTransientTakeStatus('recording'), true);
  assert.equal(isTransientTakeStatus('processing'), true);
  for (const status of ['draft', 'ready', 'baked', 'error']) {
    assert.equal(isTransientTakeStatus(status), false);
  }
});

check('createTakeId is unique and prefixed; storage key is stable', () => {
  assert.match(createTakeId(), /^take-[a-z0-9]+-[a-z0-9]+$/);
  assert.notEqual(createTakeId(), createTakeId());
  assert.equal(CURRENT_TAKE_KEY, 'rvn.take.current');
});

// H6 — stamp↔store cross-check (hardening backlog v2.0)
console.log('takeArtifactMatchesStore (H6)');

check('matches when savedAt within tolerance and byteLength equal', () => {
  const stamp = { savedAt: NOW, byteLength: 1_000_000 };
  assert.equal(
    takeArtifactMatchesStore(stamp, { savedAt: NOW + 1_500, byteLength: 1_000_000 }),
    true,
  );
});

check('rejects savedAt beyond tolerance (superseded blob)', () => {
  const stamp = { savedAt: NOW, byteLength: 1_000_000 };
  const meta = { savedAt: NOW + ARTIFACT_STAMP_TOLERANCE_MS + 1, byteLength: 1_000_000 };
  assert.equal(takeArtifactMatchesStore(stamp, meta), false);
});

check('rejects byteLength mismatch even when savedAt is close', () => {
  const stamp = { savedAt: NOW, byteLength: 1_000_000 };
  assert.equal(
    takeArtifactMatchesStore(stamp, { savedAt: NOW + 100, byteLength: 999_999 }),
    false,
  );
});

check('skips byteLength check when either side lacks it', () => {
  assert.equal(
    takeArtifactMatchesStore({ savedAt: NOW }, { savedAt: NOW + 100, byteLength: 5 }),
    true,
  );
  assert.equal(
    takeArtifactMatchesStore({ savedAt: NOW, byteLength: 5 }, { savedAt: NOW + 100 }),
    true,
  );
});

check('strict on missing input (no stamp / no meta / meta without savedAt)', () => {
  assert.equal(takeArtifactMatchesStore(undefined, { savedAt: NOW, byteLength: 1 }), false);
  assert.equal(takeArtifactMatchesStore({ savedAt: NOW }, null), false);
  assert.equal(takeArtifactMatchesStore({ savedAt: NOW }, undefined), false);
  assert.equal(takeArtifactMatchesStore({ savedAt: NOW }, { byteLength: 1 }), false);
});

check('custom tolerance is respected', () => {
  const stamp = { savedAt: NOW };
  assert.equal(takeArtifactMatchesStore(stamp, { savedAt: NOW + 900 }, 1_000), true);
  assert.equal(takeArtifactMatchesStore(stamp, { savedAt: NOW + 1_100 }, 1_000), false);
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-take-manager: ${checks} checks passed`);
