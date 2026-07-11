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
  createTakeVoiceStamp,
  isTransientTakeStatus,
  mergeTakeEdits,
  mergeTakePatch,
  normalizeStaleTake,
  parseCurrentTake,
  takeArtifactMatchesStore,
  takeFreshnessMs,
  isNewerTakeThan,
  resolveTakeClipDurationSeconds,
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

// v5.9.0 — trim apply drops bakedMp4/baseRecording stamps in the SAME write as
// the new base stamp (roadmap §4 step 7): null = delete, mirroring edits patch.
check('artifacts patch: null deletes a stamp; add + delete ride one patch', () => {
  const take = parseCurrentTake(
    validTake({
      artifacts: {
        baseRecording: { savedAt: NOW - 45_000, byteLength: 1_000_000, durationSeconds: 42 },
        baseMp4: { savedAt: NOW - 31_000, byteLength: 2_000_000, durationSeconds: 42 },
        bakedMp4: { savedAt: NOW - 20_000, byteLength: 3_000_000, durationSeconds: 42 },
      },
    }),
  );
  const merged = mergeTakePatch(
    take,
    {
      artifacts: {
        baseMp4: { savedAt: NOW, byteLength: 900_000, durationSeconds: 30 },
        bakedMp4: null,
        baseRecording: null,
      },
    },
    NOW,
  );
  assert.equal(merged.artifacts.baseMp4.byteLength, 900_000); // replaced
  assert.equal('bakedMp4' in merged.artifacts, false); // deleted
  assert.equal('baseRecording' in merged.artifacts, false); // deleted
  // Deleting an absent stamp is a no-op, and the original take is untouched.
  assert.equal(take.artifacts.bakedMp4.byteLength, 3_000_000);
  const again = mergeTakePatch(merged, { artifacts: { bakedMp4: null } }, NOW);
  assert.equal('bakedMp4' in again.artifacts, false);
});

check('artifacts patch: explicit undefined no longer clobbers a real stamp', () => {
  const take = parseCurrentTake(validTake());
  const merged = mergeTakePatch(take, { artifacts: { baseMp4: undefined } }, NOW);
  assert.equal(merged.artifacts.baseMp4.byteLength, 2_000_000); // preserved
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

console.log('resolveTakeClipDurationSeconds');

check('prefers take.meta.durationSeconds over artifact stamps', () => {
  const take = validTake({
    meta: { durationSeconds: 119 },
    artifacts: {
      baseRecording: { savedAt: NOW, durationSeconds: 2 },
      baseMp4: { savedAt: NOW, durationSeconds: 2 },
    },
  });
  assert.equal(resolveTakeClipDurationSeconds(take), 119);
});

check('falls back to artifact duration when meta is absent', () => {
  const take = validTake({
    meta: {},
    artifacts: { baseMp4: { savedAt: NOW, durationSeconds: 87 } },
  });
  assert.equal(resolveTakeClipDurationSeconds(take), 87);
});

check('returns null for missing/invalid take', () => {
  assert.equal(resolveTakeClipDurationSeconds(null), null);
  assert.equal(resolveTakeClipDurationSeconds(validTake({ meta: {}, artifacts: {} })), null);
});

console.log('recordArtifact processing promotion (logic)');

check('baseMp4 stamp on processing take should promote to ready', () => {
  const take = validTake({ status: 'processing' });
  const patch = { artifacts: { baseMp4: { savedAt: NOW, byteLength: 2_000_000, durationSeconds: 120 } } };
  if (take.status === 'processing') {
    patch.status = 'ready';
  }
  const next = mergeTakePatch(take, patch);
  assert.equal(next.status, 'ready');
  assert.equal(next.artifacts.baseMp4.byteLength, 2_000_000);
});

// ─── v5.6.0 — voice stamp + edits (audio decoupling) ─────────────────────────

console.log('v5.6.0 voice stamp + edits');

const VOICE_STAMP = {
  intentKey: '{"kind":"character","characterPresetId":"gremlin"}',
  config: { enabled: true, characterPresetId: 'gremlin', intensity: 10, turbo: false },
  appliedAt: NOW - 20_000,
  origin: 'capture',
  revision: 0,
};

check('voice stamp round-trips; fallback flag preserved', () => {
  const parsed = parseCurrentTake(validTake({ voice: { ...VOICE_STAMP, fallback: true } }));
  assert.equal(parsed.voice.intentKey, VOICE_STAMP.intentKey);
  assert.equal(parsed.voice.origin, 'capture');
  assert.equal(parsed.voice.revision, 0);
  assert.equal(parsed.voice.fallback, true);
  assert.equal(parsed.voice.config.characterPresetId, 'gremlin');
});

check('malformed voice stamp drops silently, never the snapshot', () => {
  for (const bad of [
    { ...VOICE_STAMP, intentKey: '' },
    { ...VOICE_STAMP, origin: 'timetravel' },
    { ...VOICE_STAMP, revision: -1 },
    { ...VOICE_STAMP, config: 'gremlin' },
    'gremlin',
  ]) {
    const parsed = parseCurrentTake(validTake({ voice: bad }));
    assert.notEqual(parsed, null);
    assert.equal(parsed.voice, undefined);
  }
});

check('edits.trim round-trips; invalid trim drops', () => {
  const parsed = parseCurrentTake(validTake({ edits: { trim: { inSeconds: 2, outSeconds: 30 } } }));
  assert.deepEqual(parsed.edits, { trim: { inSeconds: 2, outSeconds: 30 } });
  for (const bad of [
    { trim: { inSeconds: 30, outSeconds: 2 } },
    { trim: { inSeconds: -1, outSeconds: 2 } },
    { trim: { inSeconds: 'start', outSeconds: 2 } },
    { trim: 7 },
  ]) {
    const dropped = parseCurrentTake(validTake({ edits: bad }));
    assert.notEqual(dropped, null);
    assert.equal(dropped.edits, undefined);
  }
});

check('mergeTakePatch: voice replaces atomically; absent patch keeps prior', () => {
  const take = parseCurrentTake(validTake({ voice: VOICE_STAMP }));
  const reapplied = { ...VOICE_STAMP, origin: 'reapply', revision: 1, appliedAt: NOW };
  const next = mergeTakePatch(take, { voice: reapplied }, NOW);
  assert.equal(next.voice.revision, 1);
  assert.equal(next.voice.origin, 'reapply');
  const kept = mergeTakePatch(take, { status: 'baked' }, NOW);
  assert.equal(kept.voice.revision, 0);
});

check('mergeTakePatch: edits merge per-field; null clears trim', () => {
  const take = parseCurrentTake(validTake({ edits: { trim: { inSeconds: 1, outSeconds: 10 } } }));
  const moved = mergeTakePatch(take, { edits: { trim: { inSeconds: 3, outSeconds: 9 } } }, NOW);
  assert.deepEqual(moved.edits.trim, { inSeconds: 3, outSeconds: 9 });
  const cleared = mergeTakePatch(take, { edits: { trim: null } }, NOW);
  assert.equal(cleared.edits, undefined);
});

check('mergeTakeEdits standalone semantics', () => {
  assert.equal(mergeTakeEdits(undefined, undefined), undefined);
  assert.deepEqual(mergeTakeEdits(undefined, { trim: { inSeconds: 0, outSeconds: 5 } }), {
    trim: { inSeconds: 0, outSeconds: 5 },
  });
  assert.equal(mergeTakeEdits({ trim: { inSeconds: 0, outSeconds: 5 } }, { trim: null }), undefined);
});

check('createTakeVoiceStamp: capture resets provenance, reapply increments', () => {
  const captureStamp = createTakeVoiceStamp({
    intentKey: 'k1',
    config: { enabled: true },
    origin: 'capture',
    now: NOW,
  });
  assert.equal(captureStamp.revision, 0);
  assert.equal(captureStamp.fallback, undefined);

  const first = createTakeVoiceStamp({
    intentKey: 'k2',
    config: { enabled: true },
    origin: 'reapply',
    previous: captureStamp,
    now: NOW,
  });
  assert.equal(first.revision, 1);
  const second = createTakeVoiceStamp({
    intentKey: 'k3',
    config: { enabled: true },
    origin: 'reapply',
    previous: first,
    now: NOW,
  });
  assert.equal(second.revision, 2);
  // Legacy takes (no prior stamp) still get a monotonic start.
  const orphan = createTakeVoiceStamp({
    intentKey: 'k4',
    config: { enabled: true },
    origin: 'reapply',
    previous: null,
    now: NOW,
  });
  assert.equal(orphan.revision, 1);

  const fallbackStamp = createTakeVoiceStamp({
    intentKey: 'k5',
    config: { enabled: true },
    origin: 'capture',
    fallback: true,
    now: NOW,
  });
  assert.equal(fallbackStamp.fallback, true);
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-take-manager: ${checks} checks passed`);
