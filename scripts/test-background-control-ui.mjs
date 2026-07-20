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

const { mountBackgroundLayoutControls, renderBackgroundLayoutFields } = await bundle(
  'src/ui/design-studio/background-layout-controls.ts',
  'background-layout-controls',
);
const { physicalSliderValueFromPointer } = await bundle(
  'src/ui/design-studio/physical-slider.ts',
  'physical-slider',
);

const { document, window } = parseHTML(`<main>${renderBackgroundLayoutFields()}</main>`);
globalThis.window = window;
globalThis.document = document;
globalThis.HTMLElement = window.HTMLElement;
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

check('Y up pair places fine 0.01 before coarse 0.05', () => {
  // BUG FIX: Y-axis upward nudge order
  // Fix: Lock the fine-before-coarse DOM order requested by operator QA.
  // Sync: src/ui/design-studio/background-layout-controls.ts
  const deltas = [...document.querySelectorAll('.studio__precision-nudge-pair--up [data-background-nudge-delta]')]
    .map((button) => Number(button.getAttribute('data-background-nudge-delta')));
  assert.deepEqual(deltas, [-0.01, -0.05]);
});

check('Y slider declares vertical semantics while X and zoom remain horizontal', () => {
  const ySlider = document.querySelector('[data-background-position-slider="y"]');
  assert.equal(ySlider.getAttribute('aria-orientation'), 'vertical');
  // BUG FIX: Y-axis slider keyboard direction
  // Fix: Pin the per-control inversion marker while leaving pointer geometry unchanged.
  // Sync: src/ui/design-studio/physical-slider.ts; src/ui/design-studio/background-layout-controls.ts
  assert.equal(ySlider.getAttribute('data-keyboard-inverted'), 'true');
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

check('Phase 4 contact sheet renders four explicit image-layout recipes', () => {
  const cards = [...document.querySelectorAll('[data-background-preset]')];
  assert.equal(cards.length, 4);
  assert.ok(cards.every((card) => card.querySelector('.studio__background-preset-thumb img')));
  assert.ok(document.querySelector('[data-background-preset-apply][disabled]'));
  assert.ok(document.querySelector('[data-background-preset-status][aria-live="polite"]'));
});

check('Phase 5 darkroom controls expose treatment, motion, and in-canvas sampling', () => {
  assert.ok(document.querySelector('[data-background-dim-slider]'));
  assert.ok(document.querySelector('[data-background-blur-toggle]'));
  assert.ok(document.querySelector('[data-background-blur-slider]'));
  assert.equal(document.querySelectorAll('[data-background-blend-mode] option').length, 8);
  assert.ok(document.querySelector('[data-background-holo]'));
  assert.ok(document.querySelector('[data-background-gif-speed-slider]'));
  assert.ok(document.querySelector('[data-background-gif-react]'));
  assert.ok(document.querySelector('[data-background-eyedropper]'));
});

check('preset safety, Apply, treatment controls, and sampler emit guarded changes', () => {
  const changes = [];
  let gestures = 0;
  let sampledHex = null;
  let sampleAttempt = 0;
  const samplingChanges = [];
  const sampleCanvas = document.createElement('canvas');
  const sampleSurface = document.createElement('div');
  document.querySelector('main').append(sampleSurface);
  sampleCanvas.width = 200;
  sampleCanvas.height = 100;
  sampleCanvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 100, height: 50 });
  sampleCanvas.getContext = () => ({
    getImageData: () => {
      sampleAttempt += 1;
      return {
        data: new Uint8ClampedArray(
          sampleAttempt <= 3 ? [12, 34, 56, 0] : [12, 34, 56, 255],
        ),
      };
    },
  });
  const handle = mountBackgroundLayoutControls(
    document.querySelector('main'),
    (patch, options) => changes.push({ patch, options }),
    {
      onGestureStart: () => { gestures += 1; },
      getEyeDropperCanvas: () => sampleCanvas,
      getEyeDropperSurface: () => sampleSurface,
      onColorSamplingChange: (sampling) => samplingChanges.push(sampling),
      onSampleColor: (hex) => { sampledHex = hex; },
    },
  );
  handle.sync({
    appearance: {
      customBackgroundId: 'bg-uploaded-fixture',
      backgroundLayout: {
        scaleMode: 'fill',
        position: 'center',
        customPosition: { x: 0.5, y: 0.5 },
      },
    },
  });

  const card = document.querySelector('[data-background-preset="aurora-thirds"]');
  card.dispatchEvent(new window.Event('pointerenter'));
  assert.equal(changes.at(-1).options.persist, false);
  assert.equal(changes.at(-1).options.presetPreview, true);
  assert.equal(changes.at(-1).patch.customBackgroundId, 'bg-bundled-aurora');
  assert.deepEqual(changes.at(-1).patch.backgroundLayout.customPosition, { x: 0.33, y: 0.44 });

  card.dispatchEvent(new window.Event('focus'));
  const changesBeforePointerLeave = changes.length;
  card.dispatchEvent(new window.Event('pointerleave'));
  assert.equal(changes.length, changesBeforePointerLeave);

  card.dispatchEvent(new window.Event('blur'));
  assert.equal(changes.at(-1).options.persist, false);
  assert.equal(changes.at(-1).patch.customBackgroundId, 'bg-uploaded-fixture');
  assert.deepEqual(changes.at(-1).patch.backgroundLayout.customPosition, { x: 0.5, y: 0.5 });

  card.dispatchEvent(new window.Event('pointerenter'));
  assert.equal(changes.at(-1).patch.customBackgroundId, 'bg-bundled-aurora');
  // BUG FIX: recording-time preset hover could create flash-heavy captured video
  // Fix: entering capture restores the baseline and blocks every further transient preset update.
  // Sync: background-layout-controls.ts; studio-recorder.ts; mount-clip-studio.ts
  handle.syncRecordingState(true);
  assert.equal(changes.at(-1).patch.customBackgroundId, 'bg-uploaded-fixture');
  const changesWhileRecording = changes.length;
  card.dispatchEvent(new window.Event('pointerenter'));
  assert.equal(changes.length, changesWhileRecording);
  assert.equal(card.disabled, true);
  assert.equal(document.querySelector('[data-background-preset-apply]').disabled, true);
  assert.match(document.querySelector('[data-background-preset-status]').value, /paused while recording/i);
  handle.syncRecordingState(false);
  assert.equal(card.disabled, false);

  card.dispatchEvent(new window.Event('click'));
  document.querySelector('[data-background-preset-apply]').dispatchEvent(new window.Event('click'));
  assert.equal(changes.at(-1).options.persist, true);
  assert.equal(changes.at(-1).options.presetPreview, false);
  assert.equal(changes.at(-1).patch.customBackgroundId, 'bg-bundled-aurora');
  assert.equal(gestures, 1);

  const ySlider = document.querySelector('[data-background-position-slider="y"]');
  const yBefore = changes.at(-1).patch.backgroundLayout.customPosition.y;
  const arrowUp = new window.Event('keydown', { bubbles: true, cancelable: true });
  Object.defineProperty(arrowUp, 'key', { value: 'ArrowUp' });
  ySlider.dispatchEvent(arrowUp);
  // BUG FIX: Y-axis slider keyboard direction
  // Fix: ArrowUp lowers normalized Y (moves the image up); ArrowDown restores it.
  // Sync: src/ui/design-studio/physical-slider.ts; src/ui/design-studio/background-layout-controls.ts
  assert.equal(changes.at(-1).patch.backgroundLayout.customPosition.y, yBefore - 0.01);
  const arrowDown = new window.Event('keydown', { bubbles: true, cancelable: true });
  Object.defineProperty(arrowDown, 'key', { value: 'ArrowDown' });
  ySlider.dispatchEvent(arrowDown);
  assert.equal(changes.at(-1).patch.backgroundLayout.customPosition.y, yBefore);

  const blurToggle = document.querySelector('[data-background-blur-toggle]');
  blurToggle.checked = true;
  blurToggle.dispatchEvent(new window.Event('change'));
  assert.equal(changes.at(-1).patch.backgroundLayout.blur, 6);
  const blend = document.querySelector('[data-background-blend-mode]');
  for (const option of blend.querySelectorAll('option')) {
    const selected = option.value === 'multiply';
    option.selected = selected;
    option.toggleAttribute('selected', selected);
  }
  // linkedom exposes select.value as getter-only; pin the interaction value for this DOM harness.
  Object.defineProperty(blend, 'value', { configurable: true, value: 'multiply' });
  blend.dispatchEvent(new window.Event('change'));
  assert.equal(changes.at(-1).patch.backgroundLayout.blendMode, 'multiply');
  const holo = document.querySelector('[data-background-holo]');
  holo.checked = true;
  holo.dispatchEvent(new window.Event('change'));
  assert.equal(changes.at(-1).patch.backgroundLayout.holo, true);
  const gifReact = document.querySelector('[data-background-gif-react]');
  gifReact.checked = true;
  gifReact.dispatchEvent(new window.Event('change'));
  assert.equal(changes.at(-1).patch.backgroundLayout.gifReactToAudio, true);

  const eyeDropper = document.querySelector('[data-background-eyedropper]');
  eyeDropper.dispatchEvent(new window.Event('click'));
  assert.equal(eyeDropper.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(samplingChanges, [true]);
  const dispatchSample = () => {
    const sampleEvent = new window.Event('pointerdown', { bubbles: true, cancelable: true });
    Object.defineProperties(sampleEvent, {
      clientX: { value: 60 },
      clientY: { value: 45 },
    });
    sampleSurface.dispatchEvent(sampleEvent);
    return sampleEvent;
  };
  // BUG FIX: eye-dropper clicks were captured by background pan/zoom
  // Fix: exercise the top interaction surface and keep sampling active with feedback on misses.
  // Sync: src/ui/design-studio/background-layout-controls.ts; src/ui/design-studio/background-direct-manipulation.ts
  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert.equal(dispatchSample().defaultPrevented, true);
  }
  assert.equal(sampledHex, null);
  assert.equal(eyeDropper.getAttribute('aria-pressed'), 'true');
  assert.match(document.querySelector('[data-background-sample-status]').value, /Still sampling/i);
  dispatchSample();
  assert.equal(sampledHex, '#0c2238');
  assert.equal(eyeDropper.getAttribute('aria-pressed'), 'false');
  assert.deepEqual(samplingChanges, [true, false]);
  handle.dispose();
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-background-control-ui: ${checks} checks passed`);
