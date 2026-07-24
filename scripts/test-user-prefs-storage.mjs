// v5.11.0 — structured user-preferences IDB contract tests.
//
//   Run: node scripts/test-user-prefs-storage.mjs
//
// Covers the pure split/size boundary and the thin wrapper's atomic three-store
// replace/read behavior with a minimal in-memory IndexedDB stand-in.

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const testTmpRoot = process.env.RVN_TEST_TMPDIR
  ? resolve(process.env.RVN_TEST_TMPDIR)
  : tmpdir();
const outdir = mkdtempSync(join(testTmpRoot, 'rvn-user-prefs-storage-'));
const entry = join(outdir, 'entry.ts');
const outfile = join(outdir, 'bundle.mjs');

writeFileSync(
  entry,
  [
    "export * from '@/src/storage/user-prefs-db';",
    "export { exportUserPreferencesAsJSON, importUserPreferencesFromJSON, loadUserPreferences, renameClipProfile, saveDefaultClipProfile } from '@/src/settings/user-preferences';",
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
  define: { 'import.meta.env.DEV': 'false' },
  logLevel: 'silent',
});

function createFakeIndexedDB() {
  const state = {
    failNextWrite: null,
    stores: new Map([
      ['global', new Map()],
      ['profiles', new Map()],
      ['customStyles', new Map()],
    ]),
  };

  const db = {
    objectStoreNames: { contains: (name) => state.stores.has(name) },
    close() {},
    transaction(names, mode) {
      const selected = Array.isArray(names) ? names : [names];
      const working = new Map(
        selected.map((name) => [name, new Map(state.stores.get(name))]),
      );
      const tx = {
        error: null,
        abort() {
          tx.error = new Error('aborted');
          queueMicrotask(() => tx.onabort?.());
        },
        objectStore(name) {
          const rows = working.get(name);
          return {
            clear() {
              rows.clear();
            },
            put(record) {
              rows.set(record.id, structuredClone(record));
            },
            get(key) {
              return { result: structuredClone(rows.get(key)) };
            },
            getAll() {
              return { result: [...rows.values()].map((value) => structuredClone(value)) };
            },
          };
        },
      };

      queueMicrotask(() => {
        if (mode === 'readwrite' && state.failNextWrite) {
          tx.error = state.failNextWrite;
          state.failNextWrite = null;
          tx.onerror?.();
          return;
        }
        if (mode === 'readwrite') {
          for (const [name, rows] of working) state.stores.set(name, rows);
        }
        tx.oncomplete?.();
      });
      return tx;
    },
  };

  return {
    state,
    idb: {
      open() {
        const request = {};
        queueMicrotask(() => {
          request.result = db;
          request.onsuccess?.();
        });
        return request;
      },
    },
  };
}

const { idb, state } = createFakeIndexedDB();
globalThis.indexedDB = idb;

const localValues = new Map();
globalThis.browser = {
  storage: {
    local: {
      async get(keys) {
        const requested =
          typeof keys === 'string'
            ? [keys]
            : Array.isArray(keys)
              ? keys
              : [...localValues.keys()];
        return Object.fromEntries(
          requested
            .filter((key) => localValues.has(key))
            .map((key) => [key, structuredClone(localValues.get(key))]),
        );
      },
      async set(values) {
        for (const [key, value] of Object.entries(values)) {
          localValues.set(key, structuredClone(value));
        }
      },
      async remove(keys) {
        for (const key of Array.isArray(keys) ? keys : [keys]) localValues.delete(key);
      },
    },
    onChanged: {
      addListener() {},
      removeListener() {},
    },
  },
};

const {
  USER_PREFS_DB_SCHEMA_VERSION,
  dbSnapshotFromUserPreferences,
  loadUserPrefsDbSnapshot,
  loadUserPrefsDbSnapshotDirect,
  measureUserPrefsSnapshot,
  replaceUserPrefsDbSnapshot,
  replaceUserPrefsDbSnapshotDirect,
  exportUserPreferencesAsJSON,
  importUserPreferencesFromJSON,
  loadUserPreferences,
  renameClipProfile,
  saveDefaultClipProfile,
} = await import(pathToFileURL(outfile).href);

let checks = 0;
async function check(name, fn) {
  await fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

const transcriptWithSessionText = {
  transcriptionEnabled: true,
  result: {
    text: 'session-only text',
    source: 'vosk',
    language: 'en',
    segments: [{ start: 0, end: 1, text: 'session-only text' }],
  },
  style: { enabled: true },
  resultCapturedAt: 123,
};

const preferences = {
  version: 1,
  appearance: {
    activeThemeId: 'classic',
    activeProfileId: 'clip-one',
    activeCustomStyleId: 'style-one',
    savedProfiles: [
      {
        id: 'clip-one',
        name: 'Café profile',
        themeId: 'classic',
        barAlignment: 'center',
        customStyleId: 'style-one',
        voiceEffectConfig: { enabled: false, intensity: 50, turbo: false },
        transcriptConfig: transcriptWithSessionText,
      },
    ],
    savedCustomStyles: [
      {
        id: 'style-one',
        name: 'Warm',
        baseThemeId: 'classic',
        designOverrides: { barColor: '#ff8800' },
      },
    ],
  },
  audio: { rawMicCapture: false },
  notifications: { showResultToasts: true },
  voiceEffect: { enabled: false, intensity: 50, turbo: false },
  transcriptConfig: transcriptWithSessionText,
  experimental: { parallelBake: true },
};

console.log('test-user-prefs-storage (v5.11.0)');

const snapshot = dbSnapshotFromUserPreferences(preferences);

await check('uses internal schema v2 while retaining public preference version 1', () => {
  assert.equal(USER_PREFS_DB_SCHEMA_VERSION, 2);
  assert.equal(snapshot.global.schemaVersion, 2);
  assert.equal(snapshot.global.version, 1);
});

await check('splits profile and style arrays out of the global row', () => {
  assert.equal('savedProfiles' in snapshot.global.appearance, false);
  assert.equal('savedCustomStyles' in snapshot.global.appearance, false);
  assert.equal(snapshot.profiles.length, 1);
  assert.equal(snapshot.customStyles.length, 1);
});

await check('strips session transcript text from global and profile records', () => {
  assert.equal(snapshot.global.transcriptConfig.result, null);
  assert.equal(snapshot.global.transcriptConfig.resultCapturedAt, undefined);
  assert.equal(snapshot.profiles[0].transcriptConfig.result, null);
  assert.equal(snapshot.profiles[0].transcriptConfig.resultCapturedAt, undefined);
});

await check('reports exact UTF-8 row sizes and maximum record size', () => {
  const sizes = measureUserPrefsSnapshot(snapshot);
  const globalBytes = Buffer.byteLength(JSON.stringify(snapshot.global), 'utf8');
  const profileBytes = Buffer.byteLength(JSON.stringify(snapshot.profiles[0]), 'utf8');
  const styleBytes = Buffer.byteLength(JSON.stringify(snapshot.customStyles[0]), 'utf8');
  assert.deepEqual(sizes, {
    globalBytes,
    profilesBytes: profileBytes,
    customStylesBytes: styleBytes,
    totalBytes: globalBytes + profileBytes + styleBytes,
    maxRecordBytes: Math.max(globalBytes, profileBytes, styleBytes),
  });
});

await check('atomically writes and loads all three stores', async () => {
  await replaceUserPrefsDbSnapshot(snapshot);
  const loaded = await loadUserPrefsDbSnapshot();
  assert.deepEqual(loaded, snapshot);
  assert.equal(state.stores.get('global').size, 1);
  assert.equal(state.stores.get('profiles').size, 1);
  assert.equal(state.stores.get('customStyles').size, 1);
});

await check('complete replacement removes deleted profile/style rows', async () => {
  const empty = {
    ...snapshot,
    profiles: [],
    customStyles: [],
  };
  await replaceUserPrefsDbSnapshot(empty);
  const loaded = await loadUserPrefsDbSnapshot();
  assert.deepEqual(loaded, empty);
});

await check('a failed write rejects and leaves the previous snapshot intact', async () => {
  await replaceUserPrefsDbSnapshot(snapshot);
  state.failNextWrite = new Error('injected quota failure');
  await assert.rejects(
    replaceUserPrefsDbSnapshot({ ...snapshot, profiles: [] }),
    /injected quota failure/,
  );
  assert.deepEqual(await loadUserPrefsDbSnapshot(), snapshot);
});

function resetPersistence(legacy) {
  for (const rows of state.stores.values()) rows.clear();
  localValues.clear();
  if (legacy) localValues.set('rvnUserPrefs', structuredClone(legacy));
}

await check('one-time migration writes IDB + coordinator, then removes the v1 blob', async () => {
  resetPersistence(preferences);
  const migrated = await loadUserPreferences();
  const stored = await loadUserPrefsDbSnapshot();
  assert.equal(migrated.appearance.savedProfiles[0].name, 'Café profile');
  assert.equal(stored.profiles[0].name, 'Café profile');
  assert.equal(stored.customStyles[0].name, 'Warm');
  assert.equal(localValues.has('rvnUserPrefs'), false);
  assert.equal(localValues.get('rvnUserPrefs.v2').schemaVersion, 2);
  assert.equal(typeof localValues.get('rvnUserPrefs.v2').revision, 'number');
});

await check('failed first migration returns legacy prefs and keeps the retry copy', async () => {
  resetPersistence(preferences);
  state.failNextWrite = new Error('injected migration failure');
  const fallback = await loadUserPreferences();
  assert.equal(fallback.appearance.savedProfiles[0].name, 'Café profile');
  assert.equal(localValues.has('rvnUserPrefs'), true);
  assert.equal(localValues.has('rvnUserPrefs.v2'), false);
  assert.equal(await loadUserPrefsDbSnapshot(), null);

  await loadUserPreferences();
  assert.equal(localValues.has('rvnUserPrefs'), false, 'next load retries and completes migration');
  assert.equal((await loadUserPrefsDbSnapshot()).profiles.length, 1);
});

await check('export emits a versioned full snapshot and import replaces it once', async () => {
  const exported = JSON.parse(await exportUserPreferencesAsJSON());
  assert.equal(exported.type, 'rvn-user-preferences-v1');
  assert.equal(exported.preferences.version, 1);
  assert.equal(exported.preferences.appearance.savedProfiles[0].name, 'Café profile');

  const priorRevision = localValues.get('rvnUserPrefs.v2').revision;
  exported.preferences.appearance.savedProfiles[0].name = 'Imported profile';
  exported.preferences.transcriptConfig.transcriptionEnabled = false;
  exported.preferences.transcriptConfig.style.enabled = false;
  const imported = await importUserPreferencesFromJSON(JSON.stringify(exported));
  assert.equal(imported.appearance.savedProfiles[0].name, 'Imported profile');
  assert.equal((await loadUserPrefsDbSnapshot()).profiles[0].name, 'Imported profile');
  assert.equal(localValues.get('rvnSubtitlesEnabled'), false);
  assert.ok(localValues.get('rvnUserPrefs.v2').revision > priorRevision);
});

await check('invalid import is rejected without publishing a new revision', async () => {
  const priorRevision = localValues.get('rvnUserPrefs.v2').revision;
  await assert.rejects(
    importUserPreferencesFromJSON('{"type":"some-other-file"}'),
    /not a Reddit Voice Notes preferences export/,
  );
  assert.equal(localValues.get('rvnUserPrefs.v2').revision, priorRevision);
});

// CHANGED: Profile action storage tests cover clean-default creation and identity-preserving rename.
// WHY: the new menu must reuse the atomic IDB writer and never smuggle session text into profiles.
await check('default profile creation starts clean and activates the new profile', async () => {
  const created = await saveDefaultClipProfile('Fresh profile');
  const activeId = created.appearance.activeProfileId;
  const profile = created.appearance.savedProfiles.find((entry) => entry.id === activeId);
  assert.ok(profile);
  assert.equal(profile.name, 'Fresh profile');
  assert.equal(profile.themeId, 'classic');
  assert.equal(profile.customBackgroundId, null);
  assert.equal(profile.customStyleId, null);
  assert.equal(profile.voiceEffectConfig.enabled, false);
  assert.equal(profile.transcriptConfig.result, null);
  assert.equal(created.voiceEffect.enabled, false);
  assert.equal(created.transcriptConfig.transcriptionEnabled, false);
  assert.equal(localValues.get('rvnSubtitlesEnabled'), false);
  assert.equal((await loadUserPrefsDbSnapshot()).profiles.length, 2);
});

await check('rename preserves profile identity and rejects duplicate names', async () => {
  const before = await loadUserPreferences();
  const profileId = before.appearance.activeProfileId;
  const renamed = await renameClipProfile(profileId, 'Clean slate');
  assert.equal(renamed.appearance.activeProfileId, profileId);
  assert.equal(
    renamed.appearance.savedProfiles.find((profile) => profile.id === profileId).name,
    'Clean slate',
  );
  await assert.rejects(
    renameClipProfile(profileId, 'Imported profile'),
    /already exists/,
  );
});

await check('Reddit-origin wrapper access relays through background-owned direct helpers', async () => {
  let relayCalls = 0;
  globalThis.location = { origin: 'https://www.reddit.com', protocol: 'https:' };
  globalThis.browser.runtime = {
    getURL: () => 'chrome-extension://rvn-test/',
    async sendMessage(request) {
      relayCalls += 1;
      if (request.type === 'rvn/user-prefs-db-load') {
        return {
          ok: true,
          snapshotJson: JSON.stringify(await loadUserPrefsDbSnapshotDirect()),
        };
      }
      if (request.type === 'rvn/user-prefs-db-replace') {
        await replaceUserPrefsDbSnapshotDirect(JSON.parse(request.snapshotJson));
        return { ok: true };
      }
      return { ok: false, error: 'unexpected request' };
    },
  };

  const current = await loadUserPrefsDbSnapshot();
  assert.equal(current.profiles[0].name, 'Imported profile');
  await replaceUserPrefsDbSnapshot({ ...current, customStyles: [] });
  assert.equal((await loadUserPrefsDbSnapshotDirect()).customStyles.length, 0);
  assert.equal(relayCalls, 2);
  delete globalThis.location;
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-user-prefs-storage: ${checks} checks passed`);
