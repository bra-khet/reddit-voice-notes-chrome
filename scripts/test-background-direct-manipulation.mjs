// v6.0 Track B Phase 1 — direct background drag geometry.
//
//   Run: node scripts/test-background-direct-manipulation.mjs
//
// CHANGED: cover pan/focal math independently of Design Studio DOM events.
// WHY: pointer coalescing can stay a thin adapter around deterministic preview/capture geometry.

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-background-direct-'));
const outfile = join(outdir, 'background-direct.mjs');

await build({
  entryPoints: ['src/ui/design-studio/background-direct-manipulation.ts'],
  absWorkingDir: root,
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'silent',
});

const {
  computeDraggedBackgroundPosition,
  computeKeyboardAdjustedBackgroundLayout,
  computeZoomedBackgroundLayout,
} = await import(pathToFileURL(outfile).href);

const baseLayout = {
  scaleMode: 'fill',
  position: 'center',
  customPosition: { x: 0.5, y: 0.5 },
  manualScale: 1,
  dim: 0.35,
  blur: 0,
  blendMode: 'source-over',
  blendPlateSource: 'legacy',
  blendPlateColor: '#808080',
  holo: false,
  gifSpeed: 1,
  gifReactToAudio: false,
  lockToSafeText: false,
};

function drag(patch) {
  return computeDraggedBackgroundPosition({
    mode: 'pan',
    layout: baseLayout,
    startPosition: baseLayout.customPosition,
    deltaClientX: 0,
    deltaClientY: 0,
    interactionWidth: 616,
    interactionHeight: 336,
    renderedCanvasWidth: 640,
    renderedCanvasHeight: 360,
    canvasWidth: 640,
    canvasHeight: 360,
    imageSize: { width: 1000, height: 1000 },
    ...patch,
  });
}

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

console.log('Background direct manipulation');

check('fill crop follows a physical vertical image drag', () => {
  assert.deepEqual(drag({ deltaClientY: 70 }), { x: 0.5, y: 0.25 });
});

check('fill crop maps horizontal movement across the exact available span', () => {
  assert.deepEqual(drag({
    deltaClientX: -40,
    imageSize: { width: 1000, height: 500 },
  }), { x: 1, y: 0.5 });
});

check('fit letterbox positioning follows the pointer without crop inversion', () => {
  assert.deepEqual(drag({
    layout: { ...baseLayout, scaleMode: 'fit' },
    deltaClientX: 140,
  }), { x: 1, y: 0.5 });
});

check('manual scale participates in the inverted painter equation', () => {
  assert.deepEqual(drag({
    layout: { ...baseLayout, manualScale: 1.25 },
    deltaClientX: 80,
  }), { x: 0, y: 0.5 });
});

check('focal dot follows normalized pointer movement and clamps', () => {
  assert.deepEqual(drag({
    mode: 'focal',
    deltaClientX: 154,
    deltaClientY: -84,
  }), { x: 0.75, y: 0.25 });
  assert.deepEqual(drag({
    mode: 'focal',
    deltaClientX: 2000,
    deltaClientY: -2000,
  }), { x: 1, y: 0 });
});

check('an axis with no crop or letterbox span stays anchored', () => {
  assert.deepEqual(drag({
    deltaClientX: 120,
    imageSize: { width: 1600, height: 900 },
  }), { x: 0.5, y: 0.5 });
});

check('cursor-anchored zoom preserves the image point beneath the pointer', () => {
  const next = computeZoomedBackgroundLayout({
    layout: baseLayout,
    scaleFactor: 2,
    anchor: { x: 0.25, y: 0.5 },
    canvasWidth: 640,
    canvasHeight: 360,
    imageSize: { width: 1000, height: 500 },
  });
  assert.equal(next.manualScale, 2);
  assert.ok(Math.abs(next.customPosition.x - 0.3) < 1e-9);
  assert.equal(next.customPosition.y, 0.5);
});

check('zoom scale remains canonical when image metadata is unavailable', () => {
  const next = computeZoomedBackgroundLayout({
    layout: baseLayout,
    scaleFactor: 99,
    anchor: { x: 0.2, y: 0.8 },
    canvasWidth: 640,
    canvasHeight: 360,
    imageSize: null,
  });
  assert.equal(next.manualScale, 3);
  assert.deepEqual(next.customPosition, baseLayout.customPosition);
});

check('focused preview arrows use coarse movement and Shift uses fine movement', () => {
  // CHANGED: Phase 7 keyboard math is locked independently from DOM focus plumbing.
  // WHY: hero and precision frames must share exact spatial direction and step semantics.
  const left = computeKeyboardAdjustedBackgroundLayout(baseLayout, 'ArrowLeft', false);
  const upFine = computeKeyboardAdjustedBackgroundLayout(baseLayout, 'ArrowUp', true);
  assert.equal(left.layout.customPosition.x, 0.45);
  assert.equal(left.layout.customPosition.y, 0.5);
  assert.equal(upFine.layout.customPosition.x, 0.5);
  assert.equal(upFine.layout.customPosition.y, 0.49);
});

check('focused preview plus and minus adjust normalized zoom within bounds', () => {
  const zoomIn = computeKeyboardAdjustedBackgroundLayout(baseLayout, '+', false);
  const zoomOut = computeKeyboardAdjustedBackgroundLayout(zoomIn.layout, '-', false);
  assert.equal(zoomIn.layout.manualScale, 1.1);
  assert.ok(Math.abs(zoomOut.layout.manualScale - 1) < 1e-9);
  assert.equal(computeKeyboardAdjustedBackgroundLayout(baseLayout, 'Enter', false), null);
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-background-direct-manipulation: ${checks} checks passed`);
