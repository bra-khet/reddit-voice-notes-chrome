// v6.0 Track B Phase 5 experiment — personal-image Canvas 2D holo treatment.
//
//   Run: node scripts/test-background-holo.mjs
//
// CHANGED: verify the opt-in chromatic passes at the shared background compositor seam.
// WHY: default pixels, preview/capture timing, treatment ordering, and bounded pass count must stay explicit.

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-background-holo-'));
const outfile = join(outdir, 'backgrounds.mjs');

await build({
  entryPoints: ['src/theme/backgrounds.ts'],
  absWorkingDir: root,
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'silent',
});

globalThis.ImageBitmap = class ImageBitmap {
  constructor(width, height) {
    this.width = width;
    this.height = height;
  }
  close() {}
};

const { drawThemeBackground } = await import(pathToFileURL(outfile).href);

const canvas = { width: 640, height: 360 };
const image = new ImageBitmap(960, 540);
const theme = {
  id: 'holo-test',
  name: 'Holo test',
  colors: { bg: '#0b1020', bar: '#67e8f9', glow: '#c084fc' },
  background: { type: 'solid', value: '#0b1020' },
};
const baseLayout = {
  scaleMode: 'fill',
  position: 'center',
  customPosition: { x: 0.5, y: 0.5 },
  manualScale: 1,
  dim: 0.35,
  blur: 0,
  blendMode: 'source-over',
  holo: false,
  gifSpeed: 1,
  gifReactToAudio: false,
  lockToSafeText: false,
};

function createMockContext() {
  const operations = [];
  const stack = [];
  const state = {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    filter: 'none',
    fillStyle: '#000000',
  };
  const ctx = {
    operations,
    save() { stack.push({ ...state }); },
    restore() { Object.assign(state, stack.pop()); },
    drawImage(_image, ...args) {
      operations.push({
        kind: 'drawImage',
        args,
        alpha: state.globalAlpha,
        composite: state.globalCompositeOperation,
        filter: state.filter,
      });
    },
    createLinearGradient(...args) {
      const gradient = { args, stops: [] };
      operations.push({ kind: 'gradient', gradient });
      return {
        addColorStop(offset, color) { gradient.stops.push([offset, color]); },
      };
    },
    beginPath() {},
    rect(...args) { operations.push({ kind: 'rect', args }); },
    clip() { operations.push({ kind: 'clip' }); },
    fillRect(...args) {
      operations.push({
        kind: 'fillRect',
        args,
        alpha: state.globalAlpha,
        composite: state.globalCompositeOperation,
        fillStyle: typeof state.fillStyle === 'string' ? state.fillStyle : 'gradient',
      });
    },
  };
  for (const property of Object.keys(state)) {
    Object.defineProperty(ctx, property, {
      get: () => state[property],
      set: (value) => { state[property] = value; },
    });
  }
  return ctx;
}

function draw(layout, { timeMs = 0, energy = 0 } = {}) {
  const ctx = createMockContext();
  drawThemeBackground(
    ctx,
    canvas,
    theme,
    null,
    { timeMs, energy, bands: Array(32).fill(energy) },
    image,
    layout,
  );
  return ctx.operations;
}

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

console.log('Background holo');

check('default layout preserves the single legacy personal-image pass', () => {
  const operations = draw(baseLayout);
  assert.equal(operations.filter((operation) => operation.kind === 'drawImage').length, 1);
  assert.equal(operations.some((operation) => operation.kind === 'gradient'), false);
});

check('holo adds exactly two chromatic image passes and one clipped sheen', () => {
  const operations = draw({ ...baseLayout, holo: true, blur: 4 }, { timeMs: 2500, energy: 0.6 });
  const imagePasses = operations.filter((operation) => operation.kind === 'drawImage');
  assert.equal(imagePasses.length, 3);
  assert.equal(imagePasses[0].composite, 'source-over');
  assert.equal(imagePasses[0].filter, 'blur(4px)');
  assert.ok(imagePasses.slice(1).every((operation) => operation.composite === 'screen'));
  assert.ok(imagePasses.slice(1).every((operation) => /hue-rotate/.test(operation.filter)));
  assert.equal(operations.filter((operation) => operation.kind === 'gradient').length, 1);
  assert.equal(operations.filter((operation) => operation.kind === 'clip').length, 1);
  assert.ok(operations.some(
    (operation) => operation.kind === 'fillRect' && operation.composite === 'soft-light',
  ));
});

check('shared time and energy modulate bounded geometry without changing pass count', () => {
  const quiet = draw({ ...baseLayout, holo: true }, { timeMs: 0, energy: 0 });
  const active = draw({ ...baseLayout, holo: true }, { timeMs: 6000, energy: 1 });
  const quietImages = quiet.filter((operation) => operation.kind === 'drawImage');
  const activeImages = active.filter((operation) => operation.kind === 'drawImage');
  assert.equal(quietImages.length, activeImages.length);
  assert.notDeepEqual(quietImages[1].args, activeImages[1].args);
  assert.ok(activeImages[1].alpha <= 0.121);
  assert.notDeepEqual(
    quiet.find((operation) => operation.kind === 'gradient').gradient.args,
    active.find((operation) => operation.kind === 'gradient').gradient.args,
  );
});

check('time zero is deterministic and dim remains the final personal-image treatment', () => {
  const layout = { ...baseLayout, holo: true, blendMode: 'color-burn' };
  const first = draw(layout, { timeMs: 0, energy: 0.2 });
  const second = draw(layout, { timeMs: 0, energy: 0.2 });
  assert.deepEqual(first, second);
  assert.equal(first.find((operation) => operation.kind === 'drawImage').composite, 'color-burn');
  const fills = first.filter((operation) => operation.kind === 'fillRect');
  assert.equal(fills.at(-1).fillStyle, 'rgba(0, 0, 0, 0.35)');
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-background-holo: ${checks} checks passed`);
