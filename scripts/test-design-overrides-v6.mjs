// v6.0 Phase 1 — guarded visual preset persistence and theme mapping.
//
//   Run: node scripts/test-design-overrides-v6.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-design-overrides-v6-'));
const outfile = join(outdir, 'design-overrides.mjs');

await build({
  entryPoints: ['src/theme/design-overrides.ts'],
  absWorkingDir: root,
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'silent',
});

const {
  applyDesignOverrides,
  designOverridesMatch,
  normalizeDesignOverrides,
} = await import(pathToFileURL(outfile).href);

const baseTheme = {
  id: 'test',
  name: 'Test',
  bars: { width: 10, spacing: 4, cornerRadius: 2, glow: 8 },
  colors: { bar: '#ffffff', glow: '#ffffff', bg: '#000000' },
  background: { type: 'solid', value: '#000000' },
};

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

console.log('DesignOverrides v6');

check('unknown preset ids and unusable values are dropped', () => {
  const normalized = normalizeDesignOverrides({
    barColor: '#ABCDEF',
    spectrumPreset: 'unknown-spectrum',
    overlayPreset: 'legacy-sparkle',
    visualizerParams: {
      sensitivity: Number.NaN,
      layoutMode: 'spiral',
      color: ['bad', '#FF0000'],
    },
    stackables: ['unknown', 'ember'],
  });
  assert.equal(normalized.barColor, '#abcdef');
  assert.equal(normalized.spectrumPreset, undefined);
  assert.equal(normalized.overlayPreset, undefined);
  assert.deepEqual(normalized.visualizerParams, { color: ['#ff0000'] });
  assert.deepEqual(normalized.stackables, ['ember']);
});

check('numeric controls clamp, palettes normalize, and valid layout/a11y values survive', () => {
  const normalized = normalizeDesignOverrides({
    barColor: '#123456',
    spectrumPreset: 'radial-spectrum',
    overlayPreset: 'bokeh',
    visualizerParams: {
      sensitivity: 4,
      intensity: -2,
      smoothing: 0.4,
      density: 0.75,
      bassWeight: 3,
      midWeight: -1,
      trebleWeight: 1.25,
      afterimageStrength: 2,
      color: ['#00FF00', '#00ff00', '#0000FF'],
      layoutMode: 'radial',
      highContrast: true,
    },
  });
  assert.deepEqual(normalized.visualizerParams, {
    sensitivity: 1,
    intensity: 0,
    smoothing: 0.4,
    density: 0.75,
    bassWeight: 2,
    midWeight: 0,
    trebleWeight: 1.25,
    afterimageStrength: 1,
    color: ['#00ff00', '#0000ff'],
    layoutMode: 'radial',
    highContrast: true,
  });
});

check('stackables are deduplicated and capped at three', () => {
  const normalized = normalizeDesignOverrides({
    barColor: '#123456',
    stackables: ['ember', 'smoke', 'ember', 'lightning', 'conway', 'unknown'],
  });
  assert.deepEqual(normalized.stackables, ['ember', 'smoke', 'lightning']);
});

check('explicit null overlay remains an intentional off state', () => {
  const normalized = normalizeDesignOverrides({
    barColor: '#123456',
    backgroundEffect: 'sparkle',
    overlayPreset: null,
  });
  const theme = applyDesignOverrides(baseTheme, normalized);
  assert.equal(theme.designEffects.overlayPreset, null);
  assert.equal(theme.designEffects.backgroundOverlay, undefined);
});

check('existing backgroundEffect values dispatch through the new registry seam', () => {
  const theme = applyDesignOverrides(baseTheme, {
    barColor: '#123456',
    backgroundEffect: 'sparkle',
  });
  assert.equal(theme.designEffects.backgroundOverlay, 'sparkle');
  assert.equal(theme.designEffects.overlayPreset, undefined);
});

check('future preset fields map into ThemeDesignEffects without a new store shape', () => {
  const theme = applyDesignOverrides(baseTheme, {
    barColor: '#123456',
    spectrumPreset: 'phosphor',
    overlayPreset: 'aurora',
    visualizerParams: { density: 0.8 },
    stackables: ['ember', 'smoke'],
  });
  assert.equal(theme.designEffects.spectrumPreset, 'phosphor');
  assert.equal(theme.designEffects.overlayPreset, 'aurora');
  assert.equal(theme.designEffects.backgroundOverlay, undefined);
  assert.deepEqual(theme.designEffects.visualizerParams, { density: 0.8 });
  assert.deepEqual(theme.designEffects.stackables, ['ember', 'smoke']);
});

check('dirty matching includes visual params and stackable order', () => {
  const left = {
    barColor: '#123456',
    visualizerParams: { density: 0.4 },
    stackables: ['ember', 'smoke'],
  };
  assert.equal(designOverridesMatch(left, { ...left }), true);
  assert.equal(designOverridesMatch(left, { ...left, visualizerParams: { density: 0.5 } }), false);
  assert.equal(designOverridesMatch(left, { ...left, stackables: ['smoke', 'ember'] }), false);
});

check('invalid bar colors still reject the complete style object', () => {
  assert.equal(normalizeDesignOverrides({ barColor: 'not-a-color', overlayPreset: 'bokeh' }), null);
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-design-overrides-v6: ${checks} checks passed`);
