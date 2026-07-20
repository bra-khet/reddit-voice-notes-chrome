// v6.0 Track B Phase 3 — Fine-position control structure and axis semantics.
//
//   Run: node scripts/test-background-control-ui.mjs
//
// CHANGED: verify the directional console independently of extension-page mounting.
// WHY: icon/axis/orientation regressions are otherwise only visible during manual browser QA.

import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-background-control-ui-'));

async function bundle(entry, name) {
  const outfile = join(outdir, `${name}.mjs`);
  await build({
    entryPoints: [entry],
    absWorkingDir: root,
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href);
}

const { renderBackgroundLayoutFields } = await bundle(
  'src/ui/design-studio/background-layout-controls.ts',
  'background-layout-controls',
);
const { physicalSliderValueFromPointer } = await bundle(
  'src/ui/design-studio/physical-slider.ts',
  'physical-slider',
);

const { document } = parseHTML(`<main>${renderBackgroundLayoutFields()}</main>`);
let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

console.log('Background control UI');

check('mini preview is embedded once inside the positioning console', () => {
  assert.equal(document.querySelectorAll('[data-preview-kind="background-precision"]').length, 1);
  assert.ok(document.querySelector('.studio__precision-stage [data-background-precision-manipulator]'));
});

check('horizontal and vertical rails occupy explicit spatial roles', () => {
  assert.ok(document.querySelector('.studio__precision-axis--horizontal [data-background-position-slider="x"]'));
  assert.ok(document.querySelector('.studio__precision-axis--vertical [data-background-position-slider="y"]'));
});

check('fine and coarse buttons use single and doubled directional assets', () => {
  const sources = [...document.querySelectorAll('[data-background-nudge-axis] img')]
    .map((image) => image.getAttribute('src'));
  assert.ok(sources.includes('/assets/design-studio-v4/icons/navigation/chevron-back-16.svg'));
  assert.ok(sources.includes('/assets/design-studio-v4/icons/navigation/chevron-enter-double-16.svg'));
  assert.ok(sources.includes('/assets/design-studio-v4/icons/navigation/chevron-up-16.svg'));
  assert.ok(sources.includes('/assets/design-studio-v4/icons/navigation/chevron-down-double-16.svg'));
});

check('Y slider declares vertical semantics while X and zoom remain horizontal', () => {
  assert.equal(
    document.querySelector('[data-background-position-slider="y"]').getAttribute('aria-orientation'),
    'vertical',
  );
  assert.equal(
    document.querySelector('[data-background-position-slider="x"]').getAttribute('aria-orientation'),
    'horizontal',
  );
  assert.equal(
    document.querySelector('[data-background-scale-slider]').getAttribute('aria-orientation'),
    'horizontal',
  );
});

check('vertical pointer mapping increases from top to bottom', () => {
  const slider = {
    dataset: { min: '0', max: '1', step: '0.01', orientation: 'vertical' },
    getBoundingClientRect: () => ({ top: 10, height: 128 }),
  };
  assert.equal(physicalSliderValueFromPointer(slider, 0, 24), 0);
  assert.equal(physicalSliderValueFromPointer(slider, 0, 74), 0.5);
  assert.equal(physicalSliderValueFromPointer(slider, 0, 124), 1);
});

check('Phase 3 mode and history controls are present', () => {
  assert.ok(document.querySelector('[data-background-snap-toggle]'));
  assert.ok(document.querySelector('[data-background-guides-toggle]'));
  assert.ok(document.querySelector('[data-background-safe-lock]'));
  assert.ok(document.querySelector('[data-background-undo][disabled]'));
  assert.ok(document.querySelector('[data-background-redo][disabled]'));
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-background-control-ui: ${checks} checks passed`);
