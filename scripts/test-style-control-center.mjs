// v6.0 Phase 4 — Style Control Center catalog, governor, and caption-safe contracts.
//
//   Run: node scripts/test-style-control-center.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-style-control-center-'));

// CHANGED: these entry points share one split bundle so Control Center registration
// and the governor exercise the same in-memory production registries.
// WHY: an isolated governor bundle would correctly see an empty registry and hide drift.
await build({
  entryPoints: {
    controls: join(root, 'src/ui/design-studio/style-controls.ts'),
    governor: join(root, 'src/theme/audio-reactive/performance-governor.ts'),
    params: join(root, 'src/theme/audio-reactive/params.ts'),
    dim: join(root, 'src/theme/audio-reactive/subtitle-safe-dim.ts'),
  },
  absWorkingDir: root,
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'node',
  outdir,
  logLevel: 'silent',
});

const controls = await import(pathToFileURL(join(outdir, 'controls.js')).href);
const governor = await import(pathToFileURL(join(outdir, 'governor.js')).href);
const params = await import(pathToFileURL(join(outdir, 'params.js')).href);
const dim = await import(pathToFileURL(join(outdir, 'dim.js')).href);

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

console.log('Style Control Center v6');

check('the panel exposes every production visual and no Bar Style contract', () => {
  const html = controls.renderStyleControlCenterFields();
  assert.equal((html.match(/data-style-spectrum="/g) ?? []).length, 6);
  assert.equal((html.match(/data-style-overlay="/g) ?? []).length, 8, 'seven overlays plus Clean stage');
  assert.equal((html.match(/data-style-stackable="/g) ?? []).length, 7);
  assert.match(html, /Visual signal chain/);
  assert.match(html, /Performance governor/);
  assert.match(html, /Caption-safe dim/);
  assert.doesNotMatch(html, /bar[ -]style/i);
});

check('caption-safe dim is a normalized, explicit boolean', () => {
  assert.deepEqual(params.normalizeVisualizerParams({ subtitleSafeDim: true }), { subtitleSafeDim: true });
  assert.deepEqual(params.normalizeVisualizerParams({ subtitleSafeDim: false }), { subtitleSafeDim: false });
  assert.equal(params.normalizeVisualizerParams({ subtitleSafeDim: 'yes' }), undefined);
});

check('detail scales estimated paint cost monotonically', () => {
  const scene = {
    spectrumPreset: 'phosphor',
    overlayPreset: 'digital-rain',
    stackables: ['ember', 'neon-glow'],
  };
  const low = governor.evaluateVisualPerformance({ ...scene, density: 0 });
  const medium = governor.evaluateVisualPerformance({ ...scene, density: 0.5 });
  const high = governor.evaluateVisualPerformance({ ...scene, density: 1 });
  assert.ok(low.estimatedCost < medium.estimatedCost);
  assert.ok(medium.estimatedCost < high.estimatedCost);
});

check('a guarded scene pauses its most expensive accent without mutating selection', () => {
  const saved = ['ember', 'conway', 'particle-burst'];
  const snapshot = governor.evaluateVisualPerformance({
    spectrumPreset: 'oscilloscope',
    overlayPreset: 'digital-rain',
    stackables: saved,
    density: 1,
  });
  assert.equal(snapshot.level, 'guarded');
  assert.equal(snapshot.suspendedStackableId, 'conway');
  assert.equal(snapshot.suspendedStackableLabel, 'Conway Life');
  assert.deepEqual(snapshot.activeStackables, ['ember', 'particle-burst']);
  assert.deepEqual(saved, ['ember', 'conway', 'particle-burst']);
  assert.ok(snapshot.effectiveCost < snapshot.estimatedCost);
});

check('lowering detail restores the saved accent automatically', () => {
  const stackables = ['ember', 'conway', 'particle-burst'];
  const guarded = governor.evaluateVisualPerformance({
    spectrumPreset: 'minimal',
    overlayPreset: null,
    stackables,
    density: 1,
  });
  const restored = governor.evaluateVisualPerformance({
    spectrumPreset: 'minimal',
    overlayPreset: null,
    stackables,
    density: 0,
  });
  assert.equal(guarded.suspendedStackableId, 'conway');
  assert.equal(restored.suspendedStackableId, null);
  assert.deepEqual(restored.activeStackables, stackables);
});

check('caption-safe dim is a no-op when disabled and bounded when enabled', () => {
  const operations = [];
  const gradient = { addColorStop: (...args) => operations.push(['stop', ...args]) };
  const ctx = new Proxy({
    createRadialGradient: (...args) => {
      operations.push(['gradient', ...args]);
      return gradient;
    },
  }, {
    get(target, property) {
      if (property in target) return target[property];
      return (...args) => operations.push([property, ...args]);
    },
    set(target, property, value) {
      operations.push([property, value]);
      target[property] = value;
      return true;
    },
  });
  const canvas = { width: 1000, height: 600 };
  dim.drawSubtitleSafeDim(ctx, canvas, false);
  assert.deepEqual(operations, []);
  dim.drawSubtitleSafeDim(ctx, canvas, true);
  assert.deepEqual(operations[0], ['save']);
  assert.ok(operations.some(([operation, x, y]) => operation === 'translate' && x === 500 && y === 432));
  assert.ok(operations.some((entry) => entry[0] === 'arc' && entry[3] === 420));
  assert.deepEqual(operations.at(-1), ['restore']);
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-style-control-center: ${checks} checks passed`);
