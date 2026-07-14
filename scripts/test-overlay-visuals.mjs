// v6.0 Phase 1 — registry-native Sparkle/Bokeh determinism and density caps.
//
//   Run: node scripts/test-overlay-visuals.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-overlay-visuals-'));
const outfile = join(outdir, 'overlay-visuals.mjs');

await build({
  entryPoints: ['src/theme/audio-reactive/overlays/index.ts'],
  absWorkingDir: root,
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'silent',
});

const {
  BOKEH_MAX_ORBS,
  BOKEH_MIN_ORBS,
  BOKEH_VISUAL_DEFINITION,
  SPARKLE_MAX_PARTICLES,
  SPARKLE_MIN_PARTICLES,
  SPARKLE_VISUAL_DEFINITION,
  drawBokehBackdrop,
  getBokehOrbCount,
  getSparkleParticleCount,
} = await import(pathToFileURL(outfile).href);

function createGradient() {
  return { addColorStop() {} };
}

function createContext() {
  const arcs = [];
  return {
    arcs,
    fillRects: 0,
    radialGradients: 0,
    linearGradients: 0,
    save() {},
    restore() {},
    beginPath() {},
    fill() {},
    stroke() {},
    moveTo() {},
    lineTo() {},
    arc(...args) { arcs.push(args); },
    fillRect() { this.fillRects += 1; },
    createRadialGradient() {
      this.radialGradients += 1;
      return createGradient();
    },
    createLinearGradient() {
      this.linearGradients += 1;
      return createGradient();
    },
  };
}

const canvas = { width: 1280, height: 720 };
const baseParams = {
  sensitivity: 0.7,
  intensity: 0.7,
  smoothing: 0.6,
  color: ['#00e5ff', '#c084fc'],
  density: 1,
};
const frame = {
  energy: 0.42,
  bands: Array.from({ length: 32 }, (_, index) => (index + 1) / 32),
  timeMs: 4321,
};

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

console.log('Registry-native overlays');

check('definitions expose stable ids, labels, families, and hard ceilings', () => {
  assert.deepEqual(
    [SPARKLE_VISUAL_DEFINITION.id, SPARKLE_VISUAL_DEFINITION.label,
      SPARKLE_VISUAL_DEFINITION.family, SPARKLE_VISUAL_DEFINITION.maxElements],
    ['sparkle', 'Sparkle', 'twinkle-particle', 64],
  );
  assert.deepEqual(
    [BOKEH_VISUAL_DEFINITION.id, BOKEH_VISUAL_DEFINITION.label,
      BOKEH_VISUAL_DEFINITION.family, BOKEH_VISUAL_DEFINITION.maxElements],
    ['bokeh', 'Bokeh', 'soft-orb-depth', 14],
  );
});

check('density maps monotonically inside fixed Sparkle/Bokeh caps', () => {
  assert.equal(getSparkleParticleCount(-1), SPARKLE_MIN_PARTICLES);
  assert.equal(getSparkleParticleCount(1), SPARKLE_MAX_PARTICLES);
  assert.equal(getSparkleParticleCount(4), SPARKLE_MAX_PARTICLES);
  assert.ok(getSparkleParticleCount(0.5) > SPARKLE_MIN_PARTICLES);
  assert.equal(getBokehOrbCount(-1), BOKEH_MIN_ORBS);
  assert.equal(getBokehOrbCount(1), BOKEH_MAX_ORBS);
  assert.equal(getBokehOrbCount(4), BOKEH_MAX_ORBS);
});

check('Sparkle placement is deterministic for the same frame and instance seed', () => {
  const firstCtx = createContext();
  const secondCtx = createContext();
  const first = SPARKLE_VISUAL_DEFINITION.create();
  const second = SPARKLE_VISUAL_DEFINITION.create();
  first.update(frame, 0);
  second.update(frame, 0);
  first.render(firstCtx, canvas, frame, baseParams);
  second.render(secondCtx, canvas, frame, baseParams);
  assert.deepEqual(firstCtx.arcs, secondCtx.arcs);
  assert.ok(firstCtx.radialGradients <= SPARKLE_MAX_PARTICLES);
  assert.ok(firstCtx.radialGradients > 0);
});

check('Sparkle consumes band energy rather than drawing a clock-only field', () => {
  const quietFrame = { ...frame, energy: 0, bands: Array(32).fill(0) };
  const loudFrame = { ...frame, energy: 1, bands: Array(32).fill(1) };
  const quietCtx = createContext();
  const loudCtx = createContext();
  const quiet = SPARKLE_VISUAL_DEFINITION.create();
  const loud = SPARKLE_VISUAL_DEFINITION.create();
  quiet.update(quietFrame, 0);
  loud.update(loudFrame, 0);
  quiet.render(quietCtx, canvas, quietFrame, baseParams);
  loud.render(loudCtx, canvas, loudFrame, baseParams);
  assert.notDeepEqual(quietCtx.arcs, loudCtx.arcs);
});

check('Bokeh renders at most fourteen layered lenses and responds to audio', () => {
  const quietFrame = { ...frame, energy: 0, bands: Array(32).fill(0) };
  const loudFrame = { ...frame, energy: 1, bands: Array(32).fill(1) };
  const quietCtx = createContext();
  const loudCtx = createContext();
  const quiet = BOKEH_VISUAL_DEFINITION.create();
  const loud = BOKEH_VISUAL_DEFINITION.create();
  quiet.update(quietFrame, 0);
  loud.update(loudFrame, 0);
  quiet.render(quietCtx, canvas, quietFrame, baseParams);
  loud.render(loudCtx, canvas, loudFrame, baseParams);
  assert.equal(quietCtx.radialGradients, BOKEH_MAX_ORBS);
  assert.equal(loudCtx.radialGradients, BOKEH_MAX_ORBS);
  assert.notDeepEqual(quietCtx.arcs, loudCtx.arcs);
});

check('Bokeh backdrop is a bounded two-pass Canvas-2D field', () => {
  const ctx = createContext();
  drawBokehBackdrop(ctx, canvas, '#050814');
  assert.equal(ctx.linearGradients, 1);
  assert.equal(ctx.radialGradients, 1);
  assert.equal(ctx.fillRects, 2);
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-overlay-visuals: ${checks} checks passed`);
