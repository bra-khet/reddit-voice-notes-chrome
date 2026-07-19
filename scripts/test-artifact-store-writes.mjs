// H13 — artifact-store persist-before-stamp contract tests.
//
//   Run:  node scripts/test-artifact-store-writes.mjs
//
// The three single-slot artifact stores (rvnLastBaseMp4 / rvnLastBakedMp4 /
// rvnLastRecording) must fail loudly — throw on an unpersistable size and on
// any IDB failure — and return the authoritative meta of the record actually
// written. Callers stamp/signal ONLY from that meta (hardening backlog H13).
//
// Real IDB does not exist in Node, so a minimal fake indexedDB is injected:
// success path records every put; the failure path fires the transaction's
// onerror with an injected error. The size gates run BEFORE any IDB touch,
// so the boundary checks are pure.

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-artifact-stores-'));
const entry = join(outdir, 'entry.ts');
const outfile = join(outdir, 'bundle.mjs');

writeFileSync(
  entry,
  [
    "export * from '@/src/storage/last-base-mp4-db';",
    "export * from '@/src/storage/last-baked-mp4-db';",
    "export * from '@/src/storage/last-recording-db';",
    "export { takeArtifactMatchesStore } from '@/src/session/take-manager';",
    "export { MAX_RECORDING_SECONDS } from '@/src/utils/constants';",
    '',
  ].join('\n'),
);

await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { '@': root },
  logLevel: 'silent',
});

// ─── Fake indexedDB (put-recording success path + injectable tx failure) ────

function createFakeIndexedDB() {
  const state = { failNextWrite: null, puts: [] };
  const db = {
    objectStoreNames: { contains: () => true },
    transaction() {
      const tx = {};
      let pendingPut = null;
      tx.objectStore = () => ({
        put(record, key) {
          pendingPut = { record, key };
        },
        delete() {},
      });
      queueMicrotask(() => {
        if (state.failNextWrite) {
          tx.error = state.failNextWrite;
          state.failNextWrite = null;
          tx.onerror?.();
          return;
        }
        if (pendingPut) state.puts.push(pendingPut);
        tx.oncomplete?.();
      });
      return tx;
    },
  };
  const idb = {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = db;
        request.onsuccess?.();
      });
      return request;
    },
  };
  return { idb, state };
}

const { idb, state } = createFakeIndexedDB();
globalThis.indexedDB = idb;

const mod = await import(pathToFileURL(outfile).href);
const {
  saveLastBaseMp4,
  saveLastBakedMp4,
  saveLastRecording,
  LAST_BASE_MP4_MIN_BYTES,
  LAST_BASE_MP4_MAX_BYTES,
  LAST_BAKED_MP4_MIN_BYTES,
  LAST_BAKED_MP4_MAX_BYTES,
  LAST_RECORDING_MIN_BYTES,
  LAST_RECORDING_MAX_BYTES,
  takeArtifactMatchesStore,
  MAX_RECORDING_SECONDS,
} = mod;

let checks = 0;
async function check(name, fn) {
  await fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

function blobOf(bytes, type = '') {
  return new Blob([new Uint8Array(bytes)], type ? { type } : undefined);
}

async function rejects(promise, needle) {
  let caught = null;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, 'expected rejection, got resolution');
  if (needle) {
    assert.match(String(caught.message ?? caught), needle);
  }
  return caught;
}

const STORES = [
  {
    label: 'saveLastBaseMp4',
    save: saveLastBaseMp4,
    min: LAST_BASE_MP4_MIN_BYTES,
    max: LAST_BASE_MP4_MAX_BYTES,
    defaultMime: 'video/mp4',
  },
  {
    label: 'saveLastBakedMp4',
    save: saveLastBakedMp4,
    min: LAST_BAKED_MP4_MIN_BYTES,
    max: LAST_BAKED_MP4_MAX_BYTES,
    defaultMime: 'video/mp4',
  },
  {
    label: 'saveLastRecording',
    save: saveLastRecording,
    min: LAST_RECORDING_MIN_BYTES,
    max: LAST_RECORDING_MAX_BYTES,
    defaultMime: 'video/webm',
  },
];

console.log('test-artifact-store-writes (H13)');

await check('exported persistability bounds hold their documented values', () => {
  assert.equal(LAST_BASE_MP4_MIN_BYTES, 256);
  assert.equal(LAST_BASE_MP4_MAX_BYTES, 40 * 1024 * 1024);
  assert.equal(LAST_BAKED_MP4_MIN_BYTES, 256);
  assert.equal(LAST_BAKED_MP4_MAX_BYTES, 40 * 1024 * 1024);
  assert.equal(LAST_RECORDING_MIN_BYTES, 256);
  assert.equal(LAST_RECORDING_MAX_BYTES, 18 * 1024 * 1024);
});

for (const { label, save, min, max, defaultMime } of STORES) {
  console.log(`\n${label} (bounds ${min}..${max})`);

  await check('rejects one byte below the minimum, without touching IDB', async () => {
    const before = state.puts.length;
    await rejects(save(blobOf(min - 1), 10), /not persistable/);
    assert.equal(state.puts.length, before, 'no record must be written');
  });

  await check('rejects one byte above the maximum, without touching IDB', async () => {
    const before = state.puts.length;
    await rejects(save(blobOf(max + 1), 10), /not persistable/);
    assert.equal(state.puts.length, before, 'no record must be written');
  });

  await check('persists exactly at the minimum bound and returns authoritative meta', async () => {
    const before = state.puts.length;
    const meta = await save(blobOf(min), 12.5);
    assert.equal(state.puts.length, before + 1, 'exactly one record written');
    const { record } = state.puts[state.puts.length - 1];
    assert.equal(meta.byteLength, min);
    assert.equal(meta.byteLength, record.byteLength);
    assert.equal(meta.savedAt, record.savedAt, 'meta.savedAt IS the stored savedAt');
    assert.equal(meta.mimeType, defaultMime, 'empty blob type falls back to the store default');
    assert.equal(meta.durationSeconds, 12.5);
  });

  await check('persists exactly at the maximum bound', async () => {
    const meta = await save(blobOf(max, 'video/x-test'), 5);
    assert.equal(meta.byteLength, max);
    assert.equal(meta.mimeType, 'video/x-test', 'explicit blob type is preserved');
  });

  await check('clamps negative duration to 0', async () => {
    const meta = await save(blobOf(min), -3);
    assert.equal(meta.durationSeconds, 0);
  });

  await check('clamps oversized duration to MAX_RECORDING_SECONDS', async () => {
    const meta = await save(blobOf(min), MAX_RECORDING_SECONDS + 100);
    assert.equal(meta.durationSeconds, MAX_RECORDING_SECONDS);
  });

  await check('normalizes non-finite duration to 0 (never NaN in a stamp)', async () => {
    const meta = await save(blobOf(min), Number.NaN);
    assert.equal(meta.durationSeconds, 0);
    const { record } = state.puts[state.puts.length - 1];
    assert.ok(Number.isFinite(record.durationSeconds), 'stored duration must be finite');
  });

  await check('a stamp built from the returned meta passes H6 verification', async () => {
    const meta = await save(blobOf(min + 8), 30);
    const { record } = state.puts[state.puts.length - 1];
    const stamp = { savedAt: meta.savedAt, byteLength: meta.byteLength };
    const storeMeta = { savedAt: record.savedAt, byteLength: record.byteLength };
    assert.equal(takeArtifactMatchesStore(stamp, storeMeta), true);
  });

  await check('injected IDB write failure rejects and leaves the prior record + stamp intact', async () => {
    // Persist A and stamp it from the returned meta (the H13 caller pattern).
    const metaA = await save(blobOf(min + 16), 20);
    const stampA = { savedAt: metaA.savedAt, byteLength: metaA.byteLength };
    const putsAfterA = state.puts.length;

    // B's write fails inside IDB — the save MUST reject with that error…
    state.failNextWrite = new Error('injected quota failure');
    await rejects(save(blobOf(min + 32), 20), /injected quota failure/);

    // …no new record lands, and A's stamp still verifies against the store
    // (the "forced IDB rejection leaves the old stamp untouched" hook).
    assert.equal(state.puts.length, putsAfterA, 'failed write must not add a record');
    const { record } = state.puts[state.puts.length - 1];
    assert.equal(record.byteLength, min + 16, 'store still holds A');
    assert.equal(
      takeArtifactMatchesStore(stampA, {
        savedAt: record.savedAt,
        byteLength: record.byteLength,
      }),
      true,
      'the old stamp must still describe the stored record',
    );
  });
}

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-artifact-store-writes: ${checks} checks passed`);
