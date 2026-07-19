// v6.0 Phase 3 — registry-native Glitch with bounded signal corruption.
//
//   Run: node scripts/test-glitch-overlay.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-glitch-'));
const outfile = join(outdir, 'glitch.mjs');

await build({
  absWorkingDir: root,
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'silent',
  stdin: {
    contents: [
      "export * from './src/theme/audio-reactive/index.ts';",
      "export * from './src/theme/audio-reactive/overlays/index.ts';",
    ].join('\n'),
    loader: 'ts',
    resolveDir: root,
    sourcefile: 'glitch-test-entry.ts',
  },
});

const {
  GLITCH_ID,
  GLITCH_INVERT_MIN_INTERVAL_MS,
  GLITCH_INVERT_SOFT_SCALE,
  GLITCH_LABEL,
  GLITCH_MAX_ELEMENTS,
  GLITCH_MAX_SCANLINES,
  GLITCH_MAX_TEAR_COUNT,
  GLITCH_MAX_WAVE_ROWS,
  GLITCH_MIN_SCANLINES,
  GLITCH_VISUAL_DEFINITION,
  getAudioVisualDefinition,
  isSaturatedRed,
  registerCoreOverlayVisuals,
  resolveGlitchScanlineCount,
  sanitizeGlitchPalette,
} = await import(pathToFileURL(outfile).href);

const canvas = { width: 640, height: 360 };
const params = {
  sensitivity: 0.72,
  intensity: 0.76,
  smoothing: 0.3,
  color: ['#ff2f92', '#00eaff', '#7dff72', '#f7fbff'],
  density: 1,
  bassWeight: 0.84,
  midWeight: 1,
  trebleWeight: 1.34,
  layoutMode: 'linear',
  highContrast: false,
};
const captureEnvironment = { amplitudeMode: 'capture', reduceMotion: false };
const previewEnvironment = { amplitudeMode: 'preview', reduceMotion: false };
const frame = {
  energy: 0.42,
  bands: Array.from({ length: 32 }, (_, index) => 0.12 + ((index * 17) % 29) / 36),
  timeMs: 1000,
  transient: false,
};

function createContext() {
  const operations = [];
  const state = {};
  const stack = [];
  const ctx = {
    operations,
    save() { stack.push({ ...state }); operations.push(['save']); },
    restore() {
      const restored = stack.pop();
      if (restored) {
        for (const key of Object.keys(state)) delete state[key];
        Object.assign(state, restored);
      }
      operations.push(['restore']);
    },
    beginPath() { operations.push(['beginPath']); },
    arc(...args) { operations.push(['arc', ...args]); },
    stroke() { operations.push(['stroke', state.strokeStyle, state.lineWidth]); },
    fillRect(...args) { operations.push(['fillRect', state.fillStyle, ...args]); },
    drawImage(...args) { operations.push(['drawImage', state.filter, state.globalAlpha, ...args]); },
  };
  for (const property of [
    'fillStyle', 'strokeStyle', 'lineWidth', 'filter', 'globalAlpha',
    'globalCompositeOperation', 'imageSmoothingEnabled', 'shadowBlur',
  ]) {
    Object.defineProperty(ctx, property, {
      get() { return state[property]; },
      set(value) {
        state[property] = value;
        operations.push([property, value]);
      },
    });
  }
  return ctx;
}

function renderGlitch(
  visual,
  inputFrame = frame,
  inputParams = params,
  environment = captureEnvironment,
  dt,
) {
  const ctx = createContext();
  if (dt !== undefined) visual.update(inputFrame, dt);
  visual.render(ctx, canvas, inputFrame, inputParams, environment);
  return ctx.operations;
}

function elementOperations(operations) {
  return operations.filter(([operation]) => (
    operation === 'drawImage' || operation === 'fillRect' || operation === 'stroke'
  ));
}

function tearCopies(operations) {
  return operations.filter(([operation, , , ...args]) => operation === 'drawImage' && args.length === 9);
}

function fullSplitCopies(operations) {
  return operations.filter(([operation, , , ...args]) => operation === 'drawImage' && args.length === 3);
}

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

console.log('Glitch overlay');

check('definition is registered, band-aware, layout-capable, and hard-capped', () => {
  assert.deepEqual(
    [
      GLITCH_VISUAL_DEFINITION.id,
      GLITCH_VISUAL_DEFINITION.label,
      GLITCH_VISUAL_DEFINITION.family,
      GLITCH_VISUAL_DEFINITION.maxElements,
    ],
    [GLITCH_ID, GLITCH_LABEL, 'signal-corruption', GLITCH_MAX_ELEMENTS],
  );
  assert.equal(GLITCH_VISUAL_DEFINITION.wants.bands, true);
  assert.deepEqual(
    GLITCH_VISUAL_DEFINITION.create().supportedLayouts,
    ['linear', 'centered', 'radial'],
  );
  // Pass C: three split ghosts (burst adds a vertical chroma kick) + inversion flash.
  assert.equal(
    GLITCH_MAX_ELEMENTS,
    GLITCH_MAX_SCANLINES + 3 + GLITCH_MAX_TEAR_COUNT * 4 + GLITCH_MAX_WAVE_ROWS + 1 + 3,
  );
  registerCoreOverlayVisuals();
  registerCoreOverlayVisuals();
  assert.equal(getAudioVisualDefinition('overlay', GLITCH_ID), GLITCH_VISUAL_DEFINITION);
});

check('density resolves only the documented 12–36 scanline range', () => {
  assert.equal(resolveGlitchScanlineCount(-2), GLITCH_MIN_SCANLINES);
  assert.equal(resolveGlitchScanlineCount(2), GLITCH_MAX_SCANLINES);
  assert.equal(resolveGlitchScanlineCount(0.5), 24);
});

check('steady signal renders deterministic finite corruption below the element cap', () => {
  const first = renderGlitch(GLITCH_VISUAL_DEFINITION.create());
  const second = renderGlitch(GLITCH_VISUAL_DEFINITION.create());
  assert.deepEqual(first, second);
  assert.equal(fullSplitCopies(first).length, 2);
  assert.equal(tearCopies(first).length, 0);
  assert.ok(first.flat(Infinity).filter((value) => typeof value === 'number').every(Number.isFinite));
  assert.ok(elementOperations(first).length <= GLITCH_MAX_ELEMENTS);
});

check('explicit transients immediately create bounded chunk tears and RGB ghosts', () => {
  const operations = renderGlitch(
    GLITCH_VISUAL_DEFINITION.create(),
    { ...frame, transient: true },
  );
  assert.ok(tearCopies(operations).length >= 2);
  // Nine-argument copies now include the burst-gated wave slices as well as the tears.
  assert.ok(tearCopies(operations).length <= GLITCH_MAX_TEAR_COUNT + GLITCH_MAX_WAVE_ROWS);
  // Pass C: a burst adds the vertical chroma ghost to the two lateral ones.
  assert.equal(fullSplitCopies(operations).length, 3);
  assert.ok(operations.some(([operation, value]) => operation === 'filter' && String(value).includes('hue-rotate')));
  assert.ok(elementOperations(operations).length <= GLITCH_MAX_ELEMENTS);
});

check('preset-local spectral flux detects a live onset without a producer hint', () => {
  const visual = GLITCH_VISUAL_DEFINITION.create();
  renderGlitch(
    visual,
    { ...frame, energy: 0.03, bands: Array(32).fill(0.02), transient: false },
  );
  const operations = renderGlitch(
    visual,
    { ...frame, energy: 0.72, bands: Array(32).fill(0.86), timeMs: 1100, transient: false },
    params,
    captureEnvironment,
    0.1,
  );
  assert.ok(tearCopies(operations).length >= 2);
});

check('capture silence retains only a low-entropy scan texture', () => {
  const quiet = renderGlitch(
    GLITCH_VISUAL_DEFINITION.create(),
    { ...frame, energy: 0, bands: Array(32).fill(0), transient: false },
  );
  const voice = renderGlitch(GLITCH_VISUAL_DEFINITION.create(), frame);
  assert.equal(quiet.some(([operation]) => operation === 'drawImage'), false);
  assert.ok(quiet.filter(([operation]) => operation === 'fillRect').length >= GLITCH_MIN_SCANLINES);
  assert.ok(elementOperations(voice).length > elementOperations(quiet).length);
});

check('linear, bilateral centered, and radial corruption geometries are distinct', () => {
  const transient = { ...frame, transient: true };
  const linear = renderGlitch(GLITCH_VISUAL_DEFINITION.create(), transient);
  const centered = renderGlitch(
    GLITCH_VISUAL_DEFINITION.create(),
    transient,
    { ...params, layoutMode: 'centered' },
  );
  const radial = renderGlitch(
    GLITCH_VISUAL_DEFINITION.create(),
    transient,
    { ...params, layoutMode: 'radial' },
  );
  assert.notDeepEqual(tearCopies(linear), tearCopies(centered));
  assert.notDeepEqual(tearCopies(centered), tearCopies(radial));
  assert.ok(radial.some(([operation]) => operation === 'arc'));
});

check('all nine-argument source and destination rectangles stay on-canvas', () => {
  const operations = renderGlitch(
    GLITCH_VISUAL_DEFINITION.create(),
    { ...frame, transient: true },
    { ...params, layoutMode: 'radial' },
  );
  for (const [, , , source, sx, sy, sw, sh, dx, dy, dw, dh] of tearCopies(operations)) {
    assert.equal(source, canvas);
    assert.ok(sx >= 0 && sy >= 0 && dx >= 0 && dy >= 0);
    assert.ok(sx + sw <= canvas.width + 1e-6 && dx + dw <= canvas.width + 1e-6);
    assert.ok(sy + sh <= canvas.height + 1e-6 && dy + dh <= canvas.height + 1e-6);
  }
});

check('band weighting changes displacement strength rather than merely color', () => {
  const transient = { ...frame, transient: true };
  const bass = renderGlitch(
    GLITCH_VISUAL_DEFINITION.create(),
    transient,
    { ...params, bassWeight: 2, midWeight: 0, trebleWeight: 0 },
  );
  const treble = renderGlitch(
    GLITCH_VISUAL_DEFINITION.create(),
    transient,
    { ...params, bassWeight: 0, midWeight: 0, trebleWeight: 2 },
  );
  assert.notDeepEqual(tearCopies(bass), tearCopies(treble));
});

check('synthetic preview bursts evolve deterministically on a bounded cadence', () => {
  const first = GLITCH_VISUAL_DEFINITION.create();
  const second = GLITCH_VISUAL_DEFINITION.create();
  const initial = renderGlitch(first, frame, params, previewEnvironment);
  renderGlitch(second, frame, params, previewEnvironment);
  const nextFrame = { ...frame, timeMs: 2320 };
  const firstNext = renderGlitch(first, nextFrame, params, previewEnvironment, 0.1);
  const secondNext = renderGlitch(second, nextFrame, params, previewEnvironment, 0.1);
  assert.deepEqual(firstNext, secondNext);
  assert.notDeepEqual(tearCopies(firstNext), tearCopies(initial));
  assert.ok(elementOperations(firstNext).length <= GLITCH_MAX_ELEMENTS);
});

check('High Contrast keeps hard source-over fringes and suppresses filtered ghosts', () => {
  const operations = renderGlitch(
    GLITCH_VISUAL_DEFINITION.create(),
    { ...frame, transient: true },
    { ...params, highContrast: true },
  );
  assert.equal(fullSplitCopies(operations).length, 0);
  assert.ok(tearCopies(operations).length > 0);
  assert.ok(operations.some(([operation, value]) => operation === 'globalCompositeOperation' && value === 'source-over'));
  assert.equal(
    operations.some(([operation, value]) => operation === 'filter' && String(value).includes('hue-rotate')),
    false,
  );
});

check('invert flashes stay under the photosensitive general-flash threshold by default', () => {
  // Pass D follow-up (HIGH PRIORITY): the DEFAULT path must be safe on its own —
  // reduced-motion is not the safety mechanism. Hard transients every 150 ms try
  // to chain full-field inverts well above 3 Hz; the rate limit must space
  // FULL-strength hits >= GLITCH_INVERT_MIN_INTERVAL_MS while refused hits fall
  // back to softened washes so the effect stays alive.
  assert.ok(GLITCH_INVERT_MIN_INTERVAL_MS >= 334, 'floor bounds full flashes to <= 3 per rolling second');
  assert.ok(GLITCH_INVERT_SOFT_SCALE <= 0.3, 'soft fallback stays under the flash-luminance threshold');
  const visual = GLITCH_VISUAL_DEFINITION.create();
  const loud = { ...frame, energy: 0.72, bands: frame.bands.map((band) => Math.min(1, band + 0.3)) };
  renderGlitch(visual, loud);
  const fullFillTimes = [];
  let softCount = 0;
  for (let step = 1; step <= 48; step += 1) {
    const timeMs = 1000 + step * 50;
    const ops = renderGlitch(
      visual,
      { ...loud, timeMs, transient: step % 3 === 0 },
      params,
      captureEnvironment,
      0.05,
    );
    for (const [operation, fillStyle, x, y, w, h] of ops) {
      if (operation !== 'fillRect' || x !== 0 || y !== 0 || w !== canvas.width || h !== canvas.height) continue;
      const alpha = Number(/([\d.]+)\)$/.exec(String(fillStyle))?.[1] ?? 0);
      if (alpha >= 0.045) fullFillTimes.push(timeMs);
      else if (alpha > 0.004) softCount += 1;
    }
  }
  assert.ok(fullFillTimes.length > 0, 'full-strength inverts still occur when the interval allows');
  assert.ok(softCount > 0, 'rate-limited hits fall back to softened washes');
  // Collapse consecutive full fills of one continuous wash into engagement starts,
  // then verify no rolling one-second window holds more than three flashes.
  const engagementStarts = fullFillTimes.filter(
    (time, index) => index === 0 || time - fullFillTimes[index - 1] > 100,
  );
  for (const start of engagementStarts) {
    const inWindow = engagementStarts.filter((t) => t >= start && t < start + 1000).length;
    assert.ok(inWindow <= 3, `full inverts in one second: ${inWindow}`);
  }
});

check('saturated red never reaches dynamic glitch elements', () => {
  assert.equal(isSaturatedRed('#ff0000'), true);
  assert.equal(isSaturatedRed('#d40b0b'), true);
  assert.equal(isSaturatedRed('#ff2f92'), false, 'the magenta identity is preserved');
  assert.equal(isSaturatedRed('#00eaff'), false);
  const sanitized = sanitizeGlitchPalette(['#ff0000', '#ff2f92', '#00eaff']);
  assert.notEqual(sanitized[0], '#ff0000');
  assert.equal(isSaturatedRed(sanitized[0]), false, 'remapped red is desaturated');
  assert.equal(sanitized[1], '#ff2f92');
  assert.equal(sanitized[2], '#00eaff');
  assert.deepEqual(
    sanitizeGlitchPalette(GLITCH_VISUAL_DEFINITION.defaultParams.color),
    [...GLITCH_VISUAL_DEFINITION.defaultParams.color],
    'built-in colors pass through untouched',
  );
  // A pure-red user palette must render without a single saturated-red style.
  const ops = renderGlitch(
    GLITCH_VISUAL_DEFINITION.create(),
    { ...frame, transient: true },
    { ...params, color: ['#ff0000'] },
  );
  for (const [operation, style] of ops) {
    if (operation !== 'fillStyle' && operation !== 'strokeStyle') continue;
    const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(String(style));
    if (!match) continue;
    const [red, green, blue] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const sum = red + green + blue;
    assert.ok(!(red >= 140 && sum > 0 && red / sum >= 0.72), `saturated red drawn: ${style}`);
  }
});

check('reduced motion is time-independent and never copies retained canvas pixels', () => {
  const visual = GLITCH_VISUAL_DEFINITION.create();
  const reduced = { amplitudeMode: 'preview', reduceMotion: true };
  const first = renderGlitch(visual, { ...frame, timeMs: 0 }, params, reduced, 0);
  const second = renderGlitch(visual, { ...frame, timeMs: 9000 }, params, reduced, 0.1);
  assert.deepEqual(second, first);
  assert.equal(first.some(([operation]) => operation === 'drawImage'), false);
  assert.ok(elementOperations(first).length <= GLITCH_MAX_ELEMENTS);
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-glitch-overlay: ${checks} checks passed`);
