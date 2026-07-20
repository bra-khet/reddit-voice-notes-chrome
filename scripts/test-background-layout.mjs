// v6.0 Track B Phase 0 — migration-safe background layout normalization and offset math.
//
//   Run: node scripts/test-background-layout.mjs
//
// CHANGED: cover every additive layout field plus continuous/discrete positioning parity.
// WHY: preview and capture share this pure seam, so malformed prefs must normalize identically in both paths.

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-background-layout-'));
const outfile = join(outdir, 'background-layout.mjs');

await build({
  entryPoints: ['src/theme/background-layout.ts'],
  absWorkingDir: root,
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'silent',
});

const {
  DEFAULT_USER_BACKGROUND_LAYOUT,
  MAX_USER_BACKGROUND_BLUR,
  MAX_USER_BACKGROUND_GIF_SPEED,
  MAX_USER_BACKGROUND_MANUAL_SCALE,
  MIN_USER_BACKGROUND_GIF_SPEED,
  MIN_USER_BACKGROUND_MANUAL_SCALE,
  USER_BACKGROUND_BLEND_MODES,
  backgroundPositionToCustomPosition,
  computeImageDrawSize,
  computeImageDrawOffset,
  normalizeUserBackgroundLayout,
  userBackgroundGifPlaybackRate,
  userBackgroundLayoutFromAppearance,
} = await import(pathToFileURL(outfile).href);

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

console.log('Background layout');

check('missing layout defaults to legacy pixels and guarded v6 values', () => {
  assert.deepEqual(normalizeUserBackgroundLayout(), {
    scaleMode: 'fill',
    position: 'center',
    customPosition: { x: 0.5, y: 0.5 },
    manualScale: 1,
    dim: 0.35,
    blur: 0,
    blendMode: 'source-over',
    gifSpeed: 1,
    gifReactToAudio: false,
    lockToSafeText: false,
  });
  assert.deepEqual(normalizeUserBackgroundLayout(null), DEFAULT_USER_BACKGROUND_LAYOUT);
});

check('numeric fields and custom coordinates clamp to their supported ranges', () => {
  const low = normalizeUserBackgroundLayout({
    customPosition: { x: -4, y: 5 },
    manualScale: -1,
    dim: -1,
    blur: -3,
    gifSpeed: 0,
  });
  assert.deepEqual(low.customPosition, { x: 0, y: 1 });
  assert.equal(low.manualScale, MIN_USER_BACKGROUND_MANUAL_SCALE);
  assert.equal(low.dim, 0);
  assert.equal(low.blur, 0);
  assert.equal(low.gifSpeed, MIN_USER_BACKGROUND_GIF_SPEED);

  const high = normalizeUserBackgroundLayout({
    manualScale: 20,
    dim: 4,
    blur: 99,
    gifSpeed: 8,
  });
  assert.equal(high.manualScale, MAX_USER_BACKGROUND_MANUAL_SCALE);
  assert.equal(high.dim, 1);
  assert.equal(high.blur, MAX_USER_BACKGROUND_BLUR);
  assert.equal(high.gifSpeed, MAX_USER_BACKGROUND_GIF_SPEED);
});

check('non-finite, wrong-type, and invalid enum values fall back safely', () => {
  const normalized = normalizeUserBackgroundLayout({
    scaleMode: 'stretch',
    position: 'north',
    customPosition: { x: Number.NaN, y: Number.POSITIVE_INFINITY },
    manualScale: Number.NaN,
    dim: Number.POSITIVE_INFINITY,
    blur: '12',
    blendMode: 'difference',
    gifSpeed: Number.NEGATIVE_INFINITY,
    gifReactToAudio: 'yes',
    lockToSafeText: 1,
  });
  assert.deepEqual(normalized, DEFAULT_USER_BACKGROUND_LAYOUT);
});

check('boolean fields preserve explicit true and false', () => {
  const enabled = normalizeUserBackgroundLayout({
    gifReactToAudio: true,
    lockToSafeText: true,
  });
  assert.equal(enabled.gifReactToAudio, true);
  assert.equal(enabled.lockToSafeText, true);
  const disabled = normalizeUserBackgroundLayout({
    gifReactToAudio: false,
    lockToSafeText: false,
  });
  assert.equal(disabled.gifReactToAudio, false);
  assert.equal(disabled.lockToSafeText, false);
});

check('blend mode uses the exact allow-list', () => {
  assert.deepEqual(USER_BACKGROUND_BLEND_MODES, [
    'source-over',
    'multiply',
    'overlay',
    'screen',
    'soft-light',
  ]);
  for (const blendMode of USER_BACKGROUND_BLEND_MODES) {
    assert.equal(normalizeUserBackgroundLayout({ blendMode }).blendMode, blendMode);
  }
  assert.equal(
    normalizeUserBackgroundLayout({ blendMode: 'destination-over' }).blendMode,
    'source-over',
  );
});

check('GIF playback rate honors speed and bounded audio reactivity', () => {
  assert.equal(userBackgroundGifPlaybackRate({}, 1), 1);
  assert.equal(userBackgroundGifPlaybackRate({ gifSpeed: 2 }, 0.5), 2);
  assert.equal(userBackgroundGifPlaybackRate({ gifReactToAudio: true }, 0), 0.65);
  assert.equal(userBackgroundGifPlaybackRate({ gifReactToAudio: true }, 0.5), 1);
  assert.equal(userBackgroundGifPlaybackRate({ gifReactToAudio: true }, 1), 1.35);
  assert.equal(userBackgroundGifPlaybackRate({ gifSpeed: 0.5, gifReactToAudio: true }, 5), 0.675);
});

check('all legacy discrete positions migrate to equivalent normalized anchors', () => {
  const expected = {
    'top-left': { x: 0, y: 0 },
    top: { x: 0.5, y: 0 },
    'top-right': { x: 1, y: 0 },
    left: { x: 0, y: 0.5 },
    center: { x: 0.5, y: 0.5 },
    right: { x: 1, y: 0.5 },
    'bottom-left': { x: 0, y: 1 },
    bottom: { x: 0.5, y: 1 },
    'bottom-right': { x: 1, y: 1 },
  };
  for (const [position, customPosition] of Object.entries(expected)) {
    assert.deepEqual(backgroundPositionToCustomPosition(position), customPosition);
    assert.deepEqual(normalizeUserBackgroundLayout({ position }).customPosition, customPosition);
  }
});

check('nested custom layout wins while missing nested fields fall back to legacy flats', () => {
  const migrated = userBackgroundLayoutFromAppearance({
    backgroundScaleMode: 'fit',
    backgroundPosition: 'bottom-right',
    backgroundLayout: {
      customPosition: { x: 0.2, y: 0.8 },
      dim: 0.6,
    },
  });
  assert.equal(migrated.scaleMode, 'fit');
  assert.equal(migrated.position, 'bottom-right');
  assert.deepEqual(migrated.customPosition, { x: 0.2, y: 0.8 });
  assert.equal(migrated.dim, 0.6);

  const nestedPosition = userBackgroundLayoutFromAppearance({
    backgroundPosition: 'top-left',
    backgroundLayout: { position: 'right' },
  });
  assert.equal(nestedPosition.position, 'right');
  assert.deepEqual(nestedPosition.customPosition, { x: 1, y: 0.5 });
});

check('custom offset math supports crop and letterbox space', () => {
  assert.deepEqual(
    computeImageDrawOffset(100, 100, 200, 50, 'center', { x: 0.25, y: 0.75 }),
    { dx: -25, dy: 37.5 },
  );
  assert.deepEqual(
    computeImageDrawOffset(100, 80, 40, 20, 'center', { x: 1, y: 0 }),
    { dx: 60, dy: 0 },
  );
});

check('shared fit/fill size math includes manual scale', () => {
  assert.deepEqual(computeImageDrawSize(640, 360, 1000, 1000, 'fill', 1), {
    width: 640,
    height: 640,
  });
  assert.deepEqual(computeImageDrawSize(640, 360, 1000, 1000, 'fit', 1), {
    width: 360,
    height: 360,
  });
  assert.deepEqual(computeImageDrawSize(640, 360, 1000, 1000, 'fill', 1.25), {
    width: 800,
    height: 800,
  });
});

check('discrete offset fallback remains pixel-equivalent to migrated custom anchors', () => {
  for (const position of [
    'top-left', 'top', 'top-right',
    'left', 'center', 'right',
    'bottom-left', 'bottom', 'bottom-right',
  ]) {
    const discrete = computeImageDrawOffset(160, 90, 240, 120, position);
    const continuous = computeImageDrawOffset(
      160,
      90,
      240,
      120,
      position,
      backgroundPositionToCustomPosition(position),
    );
    assert.deepEqual(continuous, discrete, `${position} migration must preserve offsets`);
  }
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-background-layout: ${checks} checks passed`);
