// v6.0 Track B Phase 3 — Fine-position control structure and axis semantics.
//
//   Run: node scripts/test-background-control-ui.mjs
//
// CHANGED: verify the directional console independently of extension-page mounting.
// WHY: icon/axis/orientation regressions are otherwise only visible during manual browser QA.

import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-background-control-ui-'));

// CHANGED: provide the `browser` global the module now needs (Track D Phase 0).
// WHY: background-layout-controls.ts used to hardcode '/assets/…' in <img src>, which
// worked in Node because it was just a string. It now resolves through
// browser.runtime.getURL so the hosted Design Studio gets a base-correct URL, and
// `browser` is a WXT auto-import that does not exist under bare Node. Mirroring the
// extension's own getURL contract keeps this harness honest — a stub that returned the
// bare path would let a root-absolute regression pass here and 404 on GitHub Pages.
const EXTENSION_ORIGIN = 'chrome-extension://rvn-test-harness/';
globalThis.browser = {
  runtime: {
    id: 'rvn-test-harness',
    getURL: (path) => `${EXTENSION_ORIGIN}${String(path).replace(/^\/+/, '')}`,
  },
};

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
const { renderPreviewBlock } = await bundle(
  'src/ui/design-studio/preview-block.ts',
  'preview-block',
);
const { shouldAnimateStudioPreview } = await bundle(
  'src/ui/design-studio/preview-loop-policy.ts',
  'preview-loop-policy',
);

const { document, window } = parseHTML(`
  <div class="studio-v4" data-test-root>
    <section class="studio__hero">${renderPreviewBlock('primary')}</section>
    <main>${renderBackgroundLayoutFields()}</main>
  </div>
`);
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
  // CHANGED: assert on the resolved URL, not a root-absolute literal (Track D Phase 0).
  // WHY: these <img src> values now come from browser.runtime.getURL. Keeping the old
  // '/assets/…' expectation would have made the test demand exactly the bug that 404s
  // under the GitHub Pages base path.
  const iconRoot = `${EXTENSION_ORIGIN}assets/design-studio-v4/icons/navigation`;
  const sources = [...document.querySelectorAll('[data-background-nudge-axis] img')]
    .map((image) => image.getAttribute('src'));
  assert.ok(sources.includes(`${iconRoot}/chevron-back-16.svg`));
  assert.ok(sources.includes(`${iconRoot}/chevron-enter-double-16.svg`));
  assert.ok(sources.includes(`${iconRoot}/chevron-up-16.svg`));
  assert.ok(sources.includes(`${iconRoot}/chevron-down-double-16.svg`));
});

check('no packaged asset is referenced by a root-absolute path', () => {
  // Track D Phase 0 host-neutrality rule, enforced at the unit level so a regression
  // fails here rather than silently 404-ing only on the hosted surface. A leading
  // slash means the extension root in an extension and the SITE root on Pages.
  const offenders = [...document.querySelectorAll('img[src]')]
    .map((image) => image.getAttribute('src'))
    .filter((src) => src.startsWith('/assets/'));
  assert.deepEqual(offenders, [], `root-absolute asset src found: ${offenders.join(', ')}`);
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

check('Phase 7 exposes keyboard help, live values, and one next-take A/B slot', () => {
  const precisionFrame = document.querySelector('[data-background-precision-manipulator]');
  assert.match(precisionFrame.getAttribute('aria-keyshortcuts'), /ArrowUp/);
  assert.equal(precisionFrame.getAttribute('aria-describedby'), 'background-position-keyboard-help');
  assert.ok(document.querySelector('[data-background-position-status][aria-live="polite"]'));
  assert.ok(document.querySelector('[data-background-center]'));
  assert.ok(document.querySelector('[data-background-variant-save][disabled]'));
  assert.ok(document.querySelector('[data-background-variant-swap][disabled]'));
  assert.equal(document.querySelector('[data-background-gif-react]').getAttribute('aria-keyshortcuts'), 'Space');
});

check('closeout seats an accessible icon reset beside the axes and retires legacy controls', () => {
  // BUG FIX: Center action and obsolete background controls were semantically separated from Fine position
  // Fix: Pin the icon reset inside the stage and the absence of the retired Fit/Fill and 3x3 UI.
  // Sync: src/ui/design-studio/background-layout-controls.ts; studio-v4-controls.css; style.css
  const center = document.querySelector('.studio__precision-center-cell [data-background-center]');
  assert.equal(center.getAttribute('aria-label'), 'Center background position');
  assert.match(center.getAttribute('title'), /Center background position \(Esc\)/);
  assert.equal(
    center.querySelector('img').getAttribute('src'),
    `${EXTENSION_ORIGIN}assets/design-studio-v4/icons/center-frame-32.svg`,
  );
  assert.equal(document.querySelectorAll('[data-background-center]').length, 1);
  assert.equal(document.querySelector('[data-scale-mode]'), null);
  assert.equal(document.querySelector('[data-background-position]'), null);
  assert.doesNotMatch(document.querySelector('[data-background-layout]').textContent, /Image sizing|Image position/);

  const centerAsset = readFileSync(
    resolve(root, 'public/assets/design-studio-v4/icons/center-frame-32.svg'),
    'utf8',
  );
  assert.match(centerAsset, /id="inward-arrows"/);
  assert.doesNotMatch(centerAsset, /<(?:rect|circle|polygon|polyline|line)\b/);
});

check('Position Preview uses bounded viewport-aware sizing instead of the 280px thumbnail cap', () => {
  // BUG FIX: Position Preview stayed thumbnail-sized at ordinary desktop zoom
  // Fix: pin the container/viewport sizing contract and the dedicated max-width override.
  // Sync: entrypoints/design-studio/studio-v4-controls.css; studio-v4-layout.css
  const controlsCss = readFileSync(resolve(root, 'entrypoints/design-studio/studio-v4-controls.css'), 'utf8');
  const layoutCss = readFileSync(resolve(root, 'entrypoints/design-studio/studio-v4-layout.css'), 'utf8');
  assert.match(controlsCss, /container:\s*background-precision\s*\/\s*inline-size/);
  assert.match(controlsCss, /min\(70cqi, calc\(180dvh - 306px\), 820px\)/);
  assert.match(controlsCss, /preview-wrap--background-precision[^{]*\{[^}]*max-width:\s*none/s);
  assert.match(layoutCss, /precision-preview-cell[^}]*preview-wrap--background-precision[^{]*\{[^}]*max-width:\s*none/s);
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
  assert.equal(document.querySelectorAll('[data-background-blend-plate-source] option').length, 6);
  assert.ok(document.querySelector('[data-background-blend-plate-swatch]'));
  assert.ok(document.querySelector('[data-background-blend-plate-picker] [data-color-panel]'));
  assert.ok(document.querySelector('[data-background-holo]'));
  assert.ok(document.querySelector('[data-background-gif-speed-slider]'));
  assert.ok(document.querySelector('[data-background-gif-react]'));
  assert.ok(document.querySelector('[data-background-eyedropper]'));
});

check('Phase 6 exposes honest crop, thirds, and Theme-only compare controls', () => {
  const aspects = [...document.querySelectorAll('[data-background-framing-aspect-button]')];
  assert.deepEqual(aspects.map((button) => button.getAttribute('data-background-framing-aspect-button')), [
    'native',
    'square',
    'vertical',
  ]);
  assert.equal(aspects[0].getAttribute('aria-pressed'), 'true');
  assert.ok(document.querySelector('button[data-background-framing-thirds]'));
  assert.ok(document.querySelector('[data-background-compare][aria-pressed="false"]'));
  assert.ok(document.querySelector('[data-background-framing-status][aria-live="polite"]'));
  assert.ok(document.querySelector('.studio__hero [data-background-framing-overlay][hidden]'));
  assert.match(document.querySelector('.studio__background-framing-help').textContent, /hide only its personal image\/GIF/i);
});

check('null-image previews retain the normal animated theme and style clock', () => {
  // BUG FIX: Theme-only compare froze when its personal GIF was the only prior RAF signal
  // Fix: lock the loop policy so hydrated null-image previews animate while unhydrated/static image views do not.
  // Sync: src/ui/design-studio/preview-loop-policy.ts; src/ui/design-studio/mount-clip-studio.ts
  assert.equal(shouldAnimateStudioPreview({
    hasActivePreferences: false,
    hasAnimatedSurface: false,
    customBackgroundId: null,
  }), false);
  assert.equal(shouldAnimateStudioPreview({
    hasActivePreferences: true,
    hasAnimatedSurface: false,
    customBackgroundId: 'bg-static',
  }), false);
  assert.equal(shouldAnimateStudioPreview({
    hasActivePreferences: true,
    hasAnimatedSurface: false,
    customBackgroundId: null,
  }), true);
  assert.equal(shouldAnimateStudioPreview({
    hasActivePreferences: true,
    hasAnimatedSurface: true,
    customBackgroundId: 'bg-animated',
  }), true);
});

check('preset safety, Apply, treatment controls, and sampler emit guarded changes', () => {
  const changes = [];
  let gestures = 0;
  let sampledHex = null;
  let sampleAttempt = 0;
  const samplingChanges = [];
  const heroCanvas = document.createElement('canvas');
  const heroSurface = document.createElement('div');
  const precisionCanvas = document.createElement('canvas');
  const precisionSurface = document.createElement('div');
  document.querySelector('main').append(heroSurface, precisionSurface);
  for (const canvas of [heroCanvas, precisionCanvas]) {
    canvas.width = 200;
    canvas.height = 100;
    canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 100, height: 50 });
  }
  heroCanvas.getContext = () => ({
    getImageData: () => {
      sampleAttempt += 1;
      return { data: new Uint8ClampedArray([12, 34, 56, 0]) };
    },
  });
  precisionCanvas.getContext = () => ({
    getImageData: () => ({ data: new Uint8ClampedArray([74, 108, 136, 255]) }),
  });
  const handle = mountBackgroundLayoutControls(
    document.querySelector('[data-test-root]'),
    (patch, options) => changes.push({ patch, options }),
    {
      onGestureStart: () => { gestures += 1; },
      getEyeDropperTargets: () => [
        { canvas: heroCanvas, surface: heroSurface },
        { canvas: precisionCanvas, surface: precisionSurface },
      ],
      getBlendPlateColor: (layout) => layout.blendPlateSource === 'custom'
        ? layout.blendPlateColor
        : '#52647a',
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
  assert.equal(document.querySelector('[data-background-variant-save]').disabled, false);

  const card = document.querySelector('[data-background-preset="aurora-thirds"]');
  card.dispatchEvent(new window.Event('pointerenter'));
  assert.equal(document.querySelector('[data-background-variant-save]').disabled, true);
  assert.equal(changes.at(-1).options.persist, false);
  assert.equal(changes.at(-1).options.presetPreview, true);
  assert.equal(changes.at(-1).patch.customBackgroundId, 'bg-bundled-aurora');
  assert.deepEqual(changes.at(-1).patch.backgroundLayout.customPosition, { x: 0.33, y: 0.44 });

  card.dispatchEvent(new window.Event('focus'));
  const changesBeforePointerLeave = changes.length;
  card.dispatchEvent(new window.Event('pointerleave'));
  assert.equal(changes.length, changesBeforePointerLeave);

  card.dispatchEvent(new window.Event('blur'));
  assert.equal(document.querySelector('[data-background-variant-save]').disabled, false);
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

  const framingOverlay = document.querySelector('[data-background-framing-overlay]');
  const squareGuide = document.querySelector('[data-background-framing-aspect-button="square"]');
  squareGuide.dispatchEvent(new window.Event('click'));
  assert.equal(squareGuide.getAttribute('aria-pressed'), 'true');
  assert.equal(framingOverlay.dataset.backgroundFramingAspect, 'square');
  assert.equal(framingOverlay.hidden, false);
  const thirdsToggle = document.querySelector('button[data-background-framing-thirds]');
  thirdsToggle.dispatchEvent(new window.Event('click'));
  assert.equal(thirdsToggle.getAttribute('aria-pressed'), 'true');
  assert.equal(framingOverlay.querySelector('[data-background-framing-thirds]').hidden, false);

  card.dispatchEvent(new window.Event('click'));
  document.querySelector('[data-background-preset-apply]').dispatchEvent(new window.Event('click'));
  assert.equal(changes.at(-1).options.persist, true);
  assert.equal(changes.at(-1).options.presetPreview, false);
  assert.equal(changes.at(-1).patch.customBackgroundId, 'bg-bundled-aurora');
  assert.equal(gestures, 1);

  const compare = document.querySelector('[data-background-compare]');
  card.dispatchEvent(new window.Event('pointerenter'));
  const changesBeforeCompare = changes.length;
  compare.dispatchEvent(new window.Event('click'));
  assert.equal(changes.length, changesBeforeCompare + 1);
  assert.equal(compare.getAttribute('aria-pressed'), 'true');
  assert.equal(changes.at(-1).options.persist, false);
  assert.equal(changes.at(-1).options.comparePreview, true);
  assert.equal(changes.at(-1).patch.customBackgroundId, null);
  assert.equal(card.disabled, true);
  assert.match(
    document.querySelector('[data-background-framing-status]').value,
    /current theme & style only.*personal image hidden.*export unchanged/i,
  );
  // BUG FIX: disabled preset cards could still desynchronize Theme-only compare through hover/focus handlers
  // Fix: prove every pointer, keyboard-focus, click, and Apply path is inert until finishCompare runs.
  // Sync: src/ui/design-studio/background-layout-controls.ts
  const changesDuringCompare = changes.length;
  for (const eventName of ['pointerenter', 'focus', 'click', 'pointerleave', 'blur']) {
    card.dispatchEvent(new window.Event(eventName));
  }
  document.querySelector('[data-background-preset-apply]').dispatchEvent(new window.Event('click'));
  assert.equal(changes.length, changesDuringCompare);
  assert.equal(compare.getAttribute('aria-pressed'), 'true');
  assert.equal(changes.at(-1).patch.customBackgroundId, null);
  compare.dispatchEvent(new window.Event('click'));
  assert.equal(compare.getAttribute('aria-pressed'), 'false');
  assert.equal(changes.at(-1).patch.customBackgroundId, 'bg-bundled-aurora');
  assert.deepEqual(changes.at(-1).patch.backgroundLayout.customPosition, { x: 0.33, y: 0.44 });

  compare.dispatchEvent(new window.Event('click'));
  assert.equal(changes.at(-1).patch.customBackgroundId, null);
  // CHANGED: recording entry must retire Theme-only compare before capture can begin.
  // WHY: this structural gate prevents transient comparison frames from entering the output video.
  handle.syncRecordingState(true);
  assert.equal(compare.getAttribute('aria-pressed'), 'false');
  assert.equal(compare.disabled, true);
  assert.equal(changes.at(-1).patch.customBackgroundId, 'bg-bundled-aurora');
  handle.syncRecordingState(false);
  assert.equal(compare.disabled, false);

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
  assert.match(ySlider.getAttribute('aria-valuetext'), /Vertical position/);
  assert.match(document.querySelector('[data-background-position-status]').value, /Y position changed.*X .*Y .*zoom/i);

  const variantSave = document.querySelector('[data-background-variant-save]');
  const variantSwap = document.querySelector('[data-background-variant-swap]');
  variantSave.dispatchEvent(new window.Event('click'));
  assert.equal(variantSave.textContent.trim(), 'Replace variant');
  assert.equal(variantSwap.disabled, false);
  document.querySelector('[data-background-center]').dispatchEvent(new window.Event('click'));
  assert.deepEqual(changes.at(-1).patch.backgroundLayout.customPosition, { x: 0.5, y: 0.5 });
  variantSwap.dispatchEvent(new window.Event('click'));
  assert.deepEqual(changes.at(-1).patch.backgroundLayout.customPosition, { x: 0.33, y: 0.44 });
  assert.match(document.querySelector('[data-background-variant-status]').value, /previous view is now the alternate/i);

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
  const plate = document.querySelector('[data-background-blend-plate-source]');
  for (const option of plate.querySelectorAll('option')) {
    const selected = option.value === 'custom';
    option.selected = selected;
    option.toggleAttribute('selected', selected);
  }
  Object.defineProperty(plate, 'value', { configurable: true, value: 'custom' });
  plate.dispatchEvent(new window.Event('change'));
  assert.equal(changes.at(-1).patch.backgroundLayout.blendPlateSource, 'custom');
  assert.equal(document.querySelector('[data-background-blend-plate-custom]').hidden, false);
  const plateHex = document.querySelector('[data-background-blend-plate-picker] [data-color-hex]');
  // BUG FIX: exact HEX input drifted after integer HSV round-trip
  // Fix: pin verbatim six-digit custom plate commits through the shared picker.
  // Sync: src/ui/design-studio/color-picker.ts
  plateHex.value = '#123456';
  plateHex.dispatchEvent(new window.Event('change'));
  assert.equal(changes.at(-1).patch.backgroundLayout.blendPlateColor, '#123456');
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
  const dispatchSample = (surface = heroSurface) => {
    const sampleEvent = new window.Event('pointerdown', { bubbles: true, cancelable: true });
    Object.defineProperties(sampleEvent, {
      clientX: { value: 60 },
      clientY: { value: 45 },
    });
    surface.dispatchEvent(sampleEvent);
    return sampleEvent;
  };
  // BUG FIX: precision mini was locked by sampling but could not produce a sample
  // Fix: miss on the hero, then prove the mini resolves and samples its own bitmap.
  // Sync: src/ui/design-studio/background-layout-controls.ts; src/ui/design-studio/mount-clip-studio.ts
  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert.equal(dispatchSample().defaultPrevented, true);
  }
  assert.equal(sampledHex, null);
  assert.equal(eyeDropper.getAttribute('aria-pressed'), 'true');
  assert.match(document.querySelector('[data-background-sample-status]').value, /Still sampling/i);
  dispatchSample(precisionSurface);
  assert.equal(sampledHex, '#4a6c88');
  assert.equal(eyeDropper.getAttribute('aria-pressed'), 'false');
  assert.deepEqual(samplingChanges, [true, false]);
  handle.dispose();
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-background-control-ui: ${checks} checks passed`);
