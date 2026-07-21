// v6.0 Track B Phase 5 follow-up — recorder-session background authority.
//
//   Run: node scripts/test-recorder-background-state.mjs
//
// BUG FIX: live background position briefly reverted during an open recorder session
// Fix: prove Studio's local layout/image override wins over delayed persisted preference snapshots.
// Sync: src/recorder/recorder-background-state.ts; src/recorder/voice-recorder.ts; src/recorder/waveform.ts

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-recorder-background-state-'));
const outfile = join(outdir, 'recorder-background-state.mjs');

await build({
  entryPoints: ['src/recorder/recorder-background-state.ts'],
  absWorkingDir: root,
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'silent',
});

const { resolveRecorderBackgroundState } = await import(pathToFileURL(outfile).href);

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

console.log('Recorder background state');

const persistedAppearance = {
  customBackgroundId: 'bg-old',
  backgroundScaleMode: 'fill',
  backgroundPosition: 'center',
  backgroundLayout: {
    customPosition: { x: 0.5, y: 0.5 },
    manualScale: 1,
    blendMode: 'multiply',
  },
};

check('persisted appearance supplies the initial recorder background', () => {
  const resolved = resolveRecorderBackgroundState(persistedAppearance, {});
  assert.equal(resolved.customBackgroundId, 'bg-old');
  assert.deepEqual(resolved.layout.customPosition, { x: 0.5, y: 0.5 });
  assert.equal(resolved.layout.blendMode, 'multiply');
});

check('session layout override defeats a delayed stale preference snapshot', () => {
  const resolved = resolveRecorderBackgroundState(persistedAppearance, {
    layout: {
      customPosition: { x: 0.19, y: 0.82 },
      manualScale: 1.4,
      blendMode: 'color-dodge',
      holo: true,
    },
  });
  assert.equal(resolved.customBackgroundId, 'bg-old');
  assert.deepEqual(resolved.layout.customPosition, { x: 0.19, y: 0.82 });
  assert.equal(resolved.layout.manualScale, 1.4);
  assert.equal(resolved.layout.blendMode, 'color-dodge');
  assert.equal(resolved.layout.holo, true);
});

check('explicit null image override wins and malformed local layout still normalizes', () => {
  const resolved = resolveRecorderBackgroundState(persistedAppearance, {
    customBackgroundId: null,
    layout: {
      customPosition: { x: -1, y: 3 },
      manualScale: Number.POSITIVE_INFINITY,
      holo: 'yes',
    },
  });
  assert.equal(resolved.customBackgroundId, null);
  assert.deepEqual(resolved.layout.customPosition, { x: 0, y: 1 });
  assert.equal(resolved.layout.manualScale, 1);
  assert.equal(resolved.layout.holo, false);
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-recorder-background-state: ${checks} checks passed`);
