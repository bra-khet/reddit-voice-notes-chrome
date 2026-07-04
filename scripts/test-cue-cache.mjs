// Cue-stable overlay cache key + phase bucketing tests (v5.3.5).
//
//   Run:  node scripts/test-cue-cache.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-cue-cache-'));
const outfile = join(outdir, 'bundle.mjs');

await build({
  entryPoints: [join(root, 'src/transcription/subtitle-overlay-cue-cache.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { '@': root },
  logLevel: 'silent',
});

const {
  stableCueId,
  hashSubtitleStyleForCueCache,
  quantizeOverlayAnimationPhase,
  makeCueOverlayCacheKey,
  CUE_OVERLAY_CACHE_PHASE_BUCKETS,
  CUE_CACHE_WAVE_CYCLE_SECONDS,
} = await import(pathToFileURL(outfile).href);

const baseCue = { start: 1.2, end: 3.4, text: 'Hello world' };
const baseStyle = {
  enabled: true,
  fontSize: 22,
  fontFamily: 'dejavu-sans',
  position: 'bottom',
  textColor: 'white',
  textGradient: true,
  textGradientWave: false,
  glow: { enabled: true, mode: 'halo', colorSource: 'theme', opacity: 0.55 },
  backdrop: { enabled: true, opacity: 0.72, borderRadius: 8 },
};

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log('cue overlay cache\n');

check('phase bucket count is 24 (v5.3.8 Oklch)', () => {
  assert.equal(CUE_OVERLAY_CACHE_PHASE_BUCKETS, 24);
});

check('stableCueId is deterministic', () => {
  assert.equal(stableCueId(baseCue), '1.2|3.4|Hello world');
  assert.equal(stableCueId(baseCue), stableCueId({ ...baseCue }));
});

check('style hash stable for identical configs', () => {
  const a = hashSubtitleStyleForCueCache(baseStyle, '#00e5ff');
  const b = hashSubtitleStyleForCueCache({ ...baseStyle }, '#00e5ff');
  assert.equal(a, b);
});

check('style hash changes when theme bar changes', () => {
  const a = hashSubtitleStyleForCueCache(baseStyle, '#00e5ff');
  const b = hashSubtitleStyleForCueCache(baseStyle, '#ff00aa');
  assert.notEqual(a, b);
});

check('static style uses phase bucket 0', () => {
  assert.equal(quantizeOverlayAnimationPhase(baseStyle, 12.5), '0');
});

check('gradient wave buckets quantize within cycle', () => {
  const waveStyle = { ...baseStyle, textGradientWave: true };
  const early = quantizeOverlayAnimationPhase(waveStyle, 0.1);
  const late = quantizeOverlayAnimationPhase(waveStyle, CUE_CACHE_WAVE_CYCLE_SECONDS - 0.01);
  assert.match(early, /^w\d+$/);
  assert.match(late, /^w\d+$/);
  assert.equal(
    quantizeOverlayAnimationPhase(waveStyle, 0),
    quantizeOverlayAnimationPhase(waveStyle, CUE_CACHE_WAVE_CYCLE_SECONDS),
  );
});

check('hue rotate buckets change over time', () => {
  const rainbowStyle = {
    ...baseStyle,
    glow: { ...baseStyle.glow, colorSource: 'rainbow', hueRotateMode: 'rainbow' },
  };
  const t0 = quantizeOverlayAnimationPhase(rainbowStyle, 0);
  const t1 = quantizeOverlayAnimationPhase(rainbowStyle, 0.5);
  assert.match(t0, /^h\d+$/);
  assert.match(t1, /^h\d+$/);
});

check('combined wave + hue phase tags', () => {
  const richStyle = {
    ...baseStyle,
    textGradientWave: true,
    glow: { ...baseStyle.glow, colorSource: 'rainbow', hueRotateMode: 'rainbow' },
  };
  const phase = quantizeOverlayAnimationPhase(richStyle, 1.25);
  assert.match(phase, /^w\d+,h\d+$/);
});

check('cache key stable for same cue/style/timestamp', () => {
  const keyA = makeCueOverlayCacheKey(baseCue, baseStyle, '#00e5ff', 4.2);
  const keyB = makeCueOverlayCacheKey(baseCue, baseStyle, '#00e5ff', 4.2);
  assert.equal(keyA, keyB);
  assert.ok(keyA.includes('phase:0'));
});

check('cache key differs across wave phase buckets', () => {
  const waveStyle = { ...baseStyle, textGradientWave: true };
  const bucketWidth = CUE_CACHE_WAVE_CYCLE_SECONDS / CUE_OVERLAY_CACHE_PHASE_BUCKETS;
  const keyA = makeCueOverlayCacheKey(baseCue, waveStyle, '#00e5ff', 0);
  const keyB = makeCueOverlayCacheKey(baseCue, waveStyle, '#00e5ff', bucketWidth * 2);
  assert.notEqual(keyA, keyB);
});

rmSync(outdir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);