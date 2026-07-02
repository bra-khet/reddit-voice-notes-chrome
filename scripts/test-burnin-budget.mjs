// Standalone check for the burn-in filtergraph budget + degradation chain (v5.3 fix).
// Bundles the pure burn-in builder with esbuild (resolving @/) and asserts the
// drawtext layer count stays under the ffmpeg.wasm ceiling and that empty scaffold
// slots are never baked.
//
//   Run:  node scripts/test-burnin-budget.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-burnin-'));
const outfile = join(outdir, 'bundle.mjs');

await build({
  entryPoints: [join(root, 'src/ffmpeg/subtitle-burnin.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { '@': root },
  logLevel: 'silent',
});

const {
  buildBurnInStrategies,
  buildCanvasOverlayStrategy,
  shouldPreferCanvasOverlay,
  subtitleStyleHasCanvasOnlyEffects,
} = await import(pathToFileURL(outfile).href);

const SOFT_HYPHEN = '­';
const MAX_LAYERS = 64; // mirrors MAX_BURNIN_DRAWTEXT_LAYERS

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓', name);
  } catch (err) {
    failed++;
    console.error('  ✗', name, '\n      ', err.message);
  }
}

/** Count drawtext layers in a strategy's -vf argument. */
function drawtextCount(strategy) {
  const vf = strategy.args[strategy.args.indexOf('-vf') + 1];
  return (vf.match(/drawtext=/g) ?? []).length;
}

function style(overrides = {}) {
  return {
    enabled: true,
    fontFamily: 'dejavu-sans',
    fontSize: 22,
    position: 'bottom',
    textColor: 'white',
    backdrop: { enabled: true, opacity: 0.72, borderRadius: 8 },
    glow: { enabled: false, mode: 'halo', colorSource: 'theme', opacity: 0.55, blurRadius: 2 },
    ...overrides,
  };
}

/** N filled cues, 1s each. */
function cues(n) {
  return Array.from({ length: n }, (_, i) => ({ start: i, end: i + 1, text: `word${i}` }));
}

console.log('burn-in filtergraph budget + degradation\n');

check('plain style → single strategy (all tiers dedupe to one filter)', () => {
  const strategies = buildBurnInStrategies({ segments: cues(5), style: style(), videoDurationSeconds: 5 });
  assert.equal(strategies.length, 1);
  assert.equal(drawtextCount(strategies[0]), 10); // 5 cues × (plate + text)
});

check('empty scaffold slots (soft hyphen) are never baked', () => {
  const segments = [
    { start: 0, end: 3, text: SOFT_HYPHEN },
    { start: 3, end: 6, text: 'hello' },
    { start: 6, end: 9, text: `  ${SOFT_HYPHEN} ` },
  ];
  const strategies = buildBurnInStrategies({ segments, style: style(), videoDurationSeconds: 9 });
  assert.equal(drawtextCount(strategies[0]), 2); // only the one real cue (plate + text)
});

check('all-blank input throws (nothing usable to burn in)', () => {
  const segments = [
    { start: 0, end: 3, text: SOFT_HYPHEN },
    { start: 3, end: 6, text: '   ' },
  ];
  assert.throws(() => buildBurnInStrategies({ segments, style: style(), videoDurationSeconds: 6 }));
});

check('glow halo, few cues → soft-halo tier runs first with glow layers', () => {
  const strategies = buildBurnInStrategies({
    segments: cues(2),
    style: style({ glow: { enabled: true, mode: 'halo', colorSource: 'theme', opacity: 0.55, blurRadius: 2 } }),
    videoDurationSeconds: 2,
  });
  const first = strategies[0];
  assert.equal(first.name, 'drawtext-glow');
  assert.ok(drawtextCount(first) > 4, 'glow adds ring layers beyond plate+text');
  assert.ok(drawtextCount(first) <= MAX_LAYERS, 'still within budget');
});

check('glow halo, many cues → first within budget + degrades to cheaper ring', () => {
  const strategies = buildBurnInStrategies({
    segments: cues(10),
    style: style({ glow: { enabled: true, mode: 'halo', colorSource: 'theme', opacity: 0.55, blurRadius: 2 } }),
    videoDurationSeconds: 10,
  });
  assert.ok(strategies.length >= 1);
  assert.ok(
    drawtextCount(strategies[0]) <= MAX_LAYERS,
    `first attempt must be within budget (got ${drawtextCount(strategies[0])})`,
  );
  // The single-ring halo (10 cues × ~11 layers) is over budget, so a cheaper tier runs first.
  assert.notEqual(strategies[0].name, 'drawtext-glow');
});

check('every emitted strategy that is kept stays within budget (unless it is the sole floor)', () => {
  const strategies = buildBurnInStrategies({
    segments: cues(4),
    style: style({ glow: { enabled: true, mode: 'halo', colorSource: 'theme', opacity: 0.55, blurRadius: 2 } }),
    videoDurationSeconds: 4,
  });
  for (const s of strategies) {
    assert.ok(drawtextCount(s) <= MAX_LAYERS, `${s.name} within budget (${drawtextCount(s)})`);
  }
});

check('canvas overlay strategy uses a single overlay filter (no drawtext)', () => {
  const overlayBytes = new Uint8Array(1024);
  const strategy = buildCanvasOverlayStrategy(overlayBytes);
  assert.equal(strategy.name, 'canvas-overlay');
  assert.equal(strategy.requiresFont, false);
  const filterComplex = strategy.args[strategy.args.indexOf('-filter_complex') + 1];
  assert.match(filterComplex, /overlay=0:0/);
  assert.equal((filterComplex.match(/drawtext=/g) ?? []).length, 0);
});

check('overlay bytes + prefer → canvas strategy first, drawtext fallbacks remain', () => {
  const overlayBytes = new Uint8Array(2048);
  const strategies = buildBurnInStrategies({
    segments: cues(3),
    style: style(),
    videoDurationSeconds: 3,
    useCanvasOverlay: true,
    canvasOverlayBytes: overlayBytes,
  });
  assert.equal(strategies[0].name, 'canvas-overlay');
  assert.ok(strategies.length >= 2, 'drawtext fallback tiers still emitted');
});

check('no overlay bytes → drawtext only (unchanged path)', () => {
  const strategies = buildBurnInStrategies({
    segments: cues(3),
    style: style({ glow: { enabled: true, mode: 'halo', colorSource: 'rainbow', opacity: 0.55 } }),
    videoDurationSeconds: 3,
    useCanvasOverlay: true,
  });
  assert.ok(strategies.every((s) => s.name !== 'canvas-overlay'));
});

check('shouldPreferCanvasOverlay — rainbow glow and 7+ glow cues', () => {
  assert.ok(
    shouldPreferCanvasOverlay({
      segments: cues(2),
      style: style({ glow: { enabled: true, mode: 'halo', colorSource: 'rainbow', opacity: 0.55 } }),
      videoDurationSeconds: 2,
    }),
  );
  assert.ok(
    shouldPreferCanvasOverlay({
      segments: cues(8),
      style: style({ glow: { enabled: true, mode: 'halo', colorSource: 'theme', opacity: 0.55 } }),
      videoDurationSeconds: 8,
    }),
  );
  assert.ok(subtitleStyleHasCanvasOnlyEffects(style({ textGradientWave: true })));
});

rmSync(outdir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
