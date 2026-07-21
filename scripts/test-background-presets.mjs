// v6.0 Track B Phase 4 — bundled image references and normalized layout recipes.
//
//   Run: node scripts/test-background-presets.mjs
//
// CHANGED: guard the curated catalog independently of the Studio DOM.
// WHY: preview and Apply must resolve the same image/layout payload in every context.

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-background-presets-'));
const outfile = join(outdir, 'background-presets.mjs');

await build({
  entryPoints: ['src/theme/background-layout-presets.ts'],
  absWorkingDir: root,
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'silent',
});

const {
  BACKGROUND_LAYOUT_PRESETS,
  BUNDLED_USER_BACKGROUNDS,
  BUNDLED_USER_BACKGROUND_IDS,
  getBundledUserBackground,
  isBundledUserBackgroundId,
  resolveBackgroundLayoutPreset,
} = await import(pathToFileURL(outfile).href);

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

console.log('Background presets');

check('bundled backgrounds have stable unique IDs and existing asset paths', () => {
  assert.equal(new Set(BUNDLED_USER_BACKGROUND_IDS).size, BUNDLED_USER_BACKGROUND_IDS.length);
  assert.deepEqual(BUNDLED_USER_BACKGROUND_IDS, [
    'bg-bundled-aurora',
    'bg-bundled-warm-glow',
  ]);
  for (const background of BUNDLED_USER_BACKGROUNDS) {
    assert.ok(background.assetPath.startsWith('assets/backgrounds/'));
    assert.equal(existsSync(resolve(root, 'public', background.assetPath)), true);
    assert.equal(background.width / background.height, 16 / 9);
  }
});

check('bundled reference guards reject unknown and uploaded IDs', () => {
  for (const id of BUNDLED_USER_BACKGROUND_IDS) {
    assert.equal(isBundledUserBackgroundId(id), true);
    assert.equal(getBundledUserBackground(id)?.id, id);
  }
  assert.equal(isBundledUserBackgroundId('bg-uploaded-user-image'), false);
  assert.equal(isBundledUserBackgroundId('bg-bundled-unknown'), false);
  assert.equal(getBundledUserBackground(null), null);
});

check('catalog recipes are unique and reference bundled images', () => {
  assert.equal(BACKGROUND_LAYOUT_PRESETS.length, 4);
  assert.equal(
    new Set(BACKGROUND_LAYOUT_PRESETS.map((preset) => preset.id)).size,
    BACKGROUND_LAYOUT_PRESETS.length,
  );
  for (const preset of BACKGROUND_LAYOUT_PRESETS) {
    assert.equal(isBundledUserBackgroundId(preset.backgroundId), true);
    assert.ok(preset.customPosition.x >= 0 && preset.customPosition.x <= 1);
    assert.ok(preset.customPosition.y >= 0 && preset.customPosition.y <= 1);
    assert.ok(preset.dim >= 0 && preset.dim <= 1);
  }
});

check('preset resolution applies image-layout fields through the shared normalizer', () => {
  const preset = BACKGROUND_LAYOUT_PRESETS.find((entry) => entry.id === 'aurora-thirds');
  const result = resolveBackgroundLayoutPreset(preset, {
    scaleMode: 'fit',
    position: 'bottom-right',
    customPosition: { x: 1, y: 1 },
    manualScale: 2,
    dim: 0.8,
    blur: 3,
    blendMode: 'screen',
    blendPlateSource: 'theme-tint',
    blendPlateColor: '#234567',
    holo: true,
    gifSpeed: 1.5,
    gifReactToAudio: true,
    lockToSafeText: true,
  });
  assert.equal(result.scaleMode, 'fill');
  assert.equal(result.position, 'left');
  assert.deepEqual(result.customPosition, { x: 0.33, y: 0.44 });
  assert.equal(result.manualScale, 1.16);
  assert.equal(result.dim, 0.4);
});

check('presets preserve effects and safe-text intent outside their Phase 4 scope', () => {
  const current = {
    scaleMode: 'fill',
    position: 'center',
    customPosition: { x: 0.5, y: 0.5 },
    manualScale: 1,
    dim: 0.35,
    blur: 7,
    blendMode: 'multiply',
    blendPlateSource: 'custom',
    blendPlateColor: '#123456',
    holo: true,
    gifSpeed: 0.75,
    gifReactToAudio: true,
    lockToSafeText: true,
  };
  for (const preset of BACKGROUND_LAYOUT_PRESETS) {
    const result = resolveBackgroundLayoutPreset(preset, current);
    assert.equal(result.blur, current.blur);
    assert.equal(result.blendMode, current.blendMode);
    assert.equal(result.blendPlateSource, current.blendPlateSource);
    assert.equal(result.blendPlateColor, current.blendPlateColor);
    assert.equal(result.holo, current.holo);
    assert.equal(result.gifSpeed, current.gifSpeed);
    assert.equal(result.gifReactToAudio, current.gifReactToAudio);
    assert.equal(result.lockToSafeText, current.lockToSafeText);
  }
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-background-presets: ${checks} checks passed`);
