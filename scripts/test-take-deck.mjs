// v5.4.0 Phase 1 — Current Take deck model tests: state → CTA/badge matrix.
//
//   Run:  node scripts/test-take-deck.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-take-deck-'));
const outfile = join(outdir, 'bundle.mjs');

await build({
  entryPoints: [join(root, 'src/ui/design-studio/current-take-status.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { '@': root },
  logLevel: 'silent',
});

const { deriveTakeDeckModel } = await import(pathToFileURL(outfile).href);

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

const NOW = 1_800_000_000_000;

function take(status, overrides = {}) {
  return {
    id: 'take-t',
    status,
    source: 'reddit',
    createdAt: NOW,
    lastUpdated: NOW,
    meta: { durationSeconds: 65 },
    artifacts: {},
    ...overrides,
  };
}

const stamp = { savedAt: NOW, byteLength: 1000, durationSeconds: 65 };

check('null take → download disabled, record CTA, no clear', () => {
  const m = deriveTakeDeckModel(null);
  assert.equal(m.download.enabled, false);
  assert.equal(m.showClear, false);
  assert.equal(m.live, false);
  assert.match(m.stateText, /No take yet/);
});

check('recording → live pulse, download locked', () => {
  const m = deriveTakeDeckModel(take('recording'));
  assert.equal(m.live, true);
  assert.equal(m.download.enabled, false);
  assert.match(m.hint, /Reddit recorder/);
});

check('studio-sourced recording hint names the Studio', () => {
  const m = deriveTakeDeckModel(take('recording', { source: 'studio' }));
  assert.match(m.hint, /Studio recorder/);
});

check('processing → live, download shows progress label', () => {
  const m = deriveTakeDeckModel(take('processing'));
  assert.equal(m.live, true);
  assert.equal(m.download.enabled, false);
  assert.equal(m.download.label, 'Processing…');
});

check('ready with base MP4 → download enabled (base), duration chip, re-record', () => {
  const m = deriveTakeDeckModel(take('ready', { artifacts: { baseMp4: stamp } }));
  assert.equal(m.download.enabled, true);
  assert.equal(m.download.prefer, 'base');
  assert.equal(m.download.label, 'Download MP4');
  assert.equal(m.recordLabel, 'Re-record take');
  assert.equal(m.showClear, true);
  assert.ok(m.badges.some((b) => b.label === '1:05' && b.tone === 'amber'));
});

check('ready + subtitles pending → SUBS PENDING badge', () => {
  const m = deriveTakeDeckModel(
    take('ready', { meta: { durationSeconds: 65, subtitlesEnabled: true }, artifacts: { baseMp4: stamp } }),
  );
  assert.ok(m.badges.some((b) => b.label === 'SUBS PENDING' && b.tone === 'warning'));
});

check('ready without MP4 stamp → download disabled with relay hint', () => {
  const m = deriveTakeDeckModel(take('ready'));
  assert.equal(m.download.enabled, false);
  assert.match(m.hint, /relaying/);
});

check('baked → captioned download preferred, BAKED badge', () => {
  const m = deriveTakeDeckModel(
    take('baked', { artifacts: { baseMp4: stamp, bakedMp4: stamp } }),
  );
  assert.equal(m.download.prefer, 'baked');
  assert.equal(m.download.label, 'Download MP4 · captioned');
  assert.ok(m.badges.some((b) => b.label === 'BAKED' && b.tone === 'ready'));
});

check('draft with artifacts → DRAFT badge, download still possible, note surfaces', () => {
  const m = deriveTakeDeckModel(
    take('draft', {
      meta: { durationSeconds: 65, note: 'Recorder closed before processing finished.' },
      artifacts: { baseMp4: stamp },
    }),
  );
  assert.ok(m.badges.some((b) => b.label === 'DRAFT'));
  assert.equal(m.download.enabled, true);
  assert.match(m.hint, /Recorder closed/);
});

check('draft without artifacts → resume CTA, download locked', () => {
  const m = deriveTakeDeckModel(take('draft'));
  assert.equal(m.download.enabled, false);
  assert.equal(m.recordLabel, 'Resume recording');
});

check('error → failure copy from note; salvage download if artifacts exist', () => {
  const m = deriveTakeDeckModel(
    take('error', { meta: { note: 'Mic permission lost.' }, artifacts: { baseMp4: stamp } }),
  );
  assert.match(m.hint, /Mic permission lost/);
  assert.equal(m.download.enabled, true);
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-take-deck: ${checks} checks passed`);
