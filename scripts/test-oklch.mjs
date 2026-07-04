// Oklch conversion + rainbow hue rotation tests (v5.3.8).
//
//   Run:  node scripts/test-oklch.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-oklch-'));

await build({
  entryPoints: {
    oklch: join(root, 'src/utils/oklch.ts'),
    effects: join(root, 'src/transcription/subtitle-effects.ts'),
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outdir,
  alias: { '@': root },
  logLevel: 'silent',
});

const {
  hexToOklch,
  oklchToHex,
  oklchRotateHue,
  oklchRainbowHex,
  oklchMonochromaticGlowHex,
  RAINBOW_OKLCH_LIGHTNESS,
  RAINBOW_OKLCH_CHROMA,
} = await import(pathToFileURL(join(outdir, 'oklch.js')).href);

const { resolveCanvasOverlayGlowHex } = await import(
  pathToFileURL(join(outdir, 'effects.js')).href
);

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

function hexDistance(a, b) {
  const parse = (hex) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  return Math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2);
}

console.log('oklch conversion\n');

check('hexToOklch rejects invalid hex', () => {
  assert.equal(hexToOklch('not-a-color'), null);
});

check('white round-trip within tolerance', () => {
  const oklch = hexToOklch('#ffffff');
  assert.ok(oklch);
  assert.ok(oklch.l > 0.95);
  assert.ok(oklch.c < 0.02);
  const back = oklchToHex(oklch.l, oklch.c, oklch.h);
  assert.ok(hexDistance(back, '#ffffff') < 4);
});

check('black round-trip within tolerance', () => {
  const oklch = hexToOklch('#000000');
  assert.ok(oklch);
  assert.ok(oklch.l < 0.05);
  const back = oklchToHex(oklch.l, oklch.c, oklch.h);
  assert.ok(hexDistance(back, '#000000') < 4);
});

check('theme cyan round-trip within tolerance', () => {
  const oklch = hexToOklch('#00e5ff');
  assert.ok(oklch);
  const back = oklchToHex(oklch.l, oklch.c, oklch.h);
  assert.ok(hexDistance(back, '#00e5ff') < 12);
});

check('360° hue rotation returns to start color', () => {
  const base = '#00e5ff';
  const rotated = oklchRotateHue(base, 360);
  assert.ok(rotated);
  assert.ok(hexDistance(rotated, base) < 8);
});

check('oklchRainbowHex changes across hue angles', () => {
  const a = oklchRainbowHex(0);
  const b = oklchRainbowHex(120);
  const c = oklchRainbowHex(240);
  assert.notEqual(a, b);
  assert.notEqual(b, c);
  assert.notEqual(a, c);
});

check('rainbow anchor uses exported L/C constants', () => {
  const anchor = oklchToHex(RAINBOW_OKLCH_LIGHTNESS, RAINBOW_OKLCH_CHROMA, 0);
  assert.equal(oklchRainbowHex(0), anchor);
});

check('monochromatic pulse modulates without hue spin', () => {
  const base = '#00e5ff';
  const t0 = oklchMonochromaticGlowHex(base, 0);
  const t90 = oklchMonochromaticGlowHex(base, 90);
  assert.ok(t0);
  assert.ok(t90);
  assert.notEqual(t0, t90);
  const baseOklch = hexToOklch(base);
  const t0Oklch = hexToOklch(t0);
  assert.ok(baseOklch && t0Oklch);
  assert.ok(Math.abs(baseOklch.h - t0Oklch.h) < 2 || Math.abs(baseOklch.h - t0Oklch.h) > 358);
});

console.log('\nresolveCanvasOverlayGlowHex (Oklch paths)\n');

const rainbowStyle = {
  glow: {
    enabled: true,
    colorSource: 'rainbow',
    hueRotateMode: 'rainbow',
    hueRotateSpeed: 60,
  },
};

const monoStyle = {
  glow: {
    enabled: true,
    colorSource: 'rainbow',
    hueRotateMode: 'monochromatic',
    hueRotateSpeed: 60,
  },
};

check('rainbow glow hex advances with timestamp', () => {
  const a = resolveCanvasOverlayGlowHex(rainbowStyle, '#00e5ff', 0);
  const b = resolveCanvasOverlayGlowHex(rainbowStyle, '#00e5ff', 1);
  assert.notEqual(a, b);
});

check('monochromatic glow hex pulses with timestamp', () => {
  const a = resolveCanvasOverlayGlowHex(monoStyle, '#00e5ff', 0);
  const b = resolveCanvasOverlayGlowHex(monoStyle, '#00e5ff', 2.5);
  assert.notEqual(a, b);
});

rmSync(outdir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);