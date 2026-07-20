// v6.0 Track B Phase 5 residual — human-visible personal-image blend plate.
//
//   Run: node scripts/test-background-blend-plate.mjs
//
// CHANGED: pin plate placement and treatment order at the shared personal-image draw seam.
// WHY: preview/capture parity and the legacy dark path must survive while creative blends gain a real destination.

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-background-blend-plate-'));
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
const theme = {
  id: 'plate-test',
  name: 'Plate test',
  colors: { bg: '#05070b', bar: '#67e8f9', glow: '#c084fc' },
  background: { type: 'solid', value: '#05070b' },
};
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
        composite: state.globalCompositeOperation,
        filter: state.filter,
      });
    },
    fillRect(...args) {
      operations.push({
        kind: 'fillRect',
        args,
        composite: state.globalCompositeOperation,
        fillStyle: state.fillStyle,
      });
    },
    createLinearGradient() {
      return { addColorStop() {} };
    },
    beginPath() {},
    rect() {},
    clip() {},
  };
  for (const property of Object.keys(state)) {
    Object.defineProperty(ctx, property, {
      get: () => state[property],
      set: (value) => { state[property] = value; },
    });
  }
  return ctx;
}

function draw(layout, image = new ImageBitmap(960, 540)) {
  const ctx = createMockContext();
  drawThemeBackground(
    ctx,
    canvas,
    theme,
    null,
    { timeMs: 0, energy: 0, bands: Array(32).fill(0) },
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

console.log('Background blend plate');

check('missing plate fields remain byte-for-byte equivalent to explicit legacy void', () => {
  const { blendPlateSource: _source, blendPlateColor: _color, ...legacyMissing } = baseLayout;
  assert.deepEqual(draw(legacyMissing), draw(baseLayout));
  const fills = draw(baseLayout).filter((operation) => operation.kind === 'fillRect');
  assert.equal(fills[0].fillStyle, theme.colors.bg);
});

check('creative plate fills once before the blended image and dim stays last', () => {
  const operations = draw({
    ...baseLayout,
    dim: 0,
    blendMode: 'multiply',
    blendPlateSource: 'mid-gray',
  });
  assert.deepEqual(operations[0], {
    kind: 'fillRect',
    args: [0, 0, 640, 360],
    composite: 'source-over',
    fillStyle: '#808080',
  });
  assert.equal(operations[1].kind, 'drawImage');
  assert.equal(operations[1].composite, 'multiply');
  assert.equal(operations.filter((operation) => operation.kind === 'fillRect').length, 1);
});

check('fit mode limits a custom plate to the personal-image rect', () => {
  const operations = draw({
    ...baseLayout,
    scaleMode: 'fit',
    dim: 0,
    blendMode: 'difference',
    blendPlateSource: 'custom',
    blendPlateColor: '#ffffff',
  }, new ImageBitmap(1000, 1000));
  const fills = operations.filter((operation) => operation.kind === 'fillRect');
  assert.deepEqual(fills[0].args, [0, 0, 640, 360]);
  assert.equal(fills[0].fillStyle, theme.background.value);
  assert.deepEqual(fills[1].args, [140, 0, 360, 360]);
  assert.equal(fills[1].fillStyle, '#ffffff');
  assert.equal(operations.find((operation) => operation.kind === 'drawImage').composite, 'difference');
});

check('holo stays inside the plated slot and dim remains the final treatment', () => {
  const operations = draw({
    ...baseLayout,
    blendMode: 'color-dodge',
    blendPlateSource: 'theme-tint',
    holo: true,
  });
  assert.equal(operations.filter((operation) => operation.kind === 'drawImage').length, 3);
  assert.notEqual(operations[0].fillStyle, theme.colors.bg);
  const fills = operations.filter((operation) => operation.kind === 'fillRect');
  assert.equal(fills.at(-1).fillStyle, 'rgba(0, 0, 0, 0.35)');
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-background-blend-plate: ${checks} checks passed`);
