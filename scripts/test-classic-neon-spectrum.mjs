// v6.0 Phase 2 — Classic (Neon Glow) registry migration and v5 pixel-operation parity.
//
//   Run: node scripts/test-classic-neon-spectrum.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-classic-neon-spectrum-'));
const outfile = join(outdir, 'classic-neon-spectrum.mjs');

await build({
  entryPoints: ['src/theme/audio-reactive/spectra/index.ts'],
  absWorkingDir: root,
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'silent',
});

const {
  CLASSIC_NEON_BAR_COUNT,
  CLASSIC_NEON_REDUCED_MOTION_SHAPE,
  CLASSIC_NEON_SPECTRUM_ID,
  CLASSIC_NEON_VISUAL_DEFINITION,
  registerCoreSpectrumVisuals,
} = await import(pathToFileURL(outfile).href);

const canvas = { width: 640, height: 360 };
const neutralParams = {
  sensitivity: 0.5,
  intensity: 0.5,
  smoothing: 0,
  color: '#00e5ff',
  density: 0.5,
};
const baseEnvironment = {
  alignment: 'center',
  amplitudeMode: 'preview',
  reduceMotion: false,
  bars: { width: 12, spacing: 5, cornerRadius: 6, glow: 22 },
  colors: { bar: '#00e5ff', glow: '#ff00e5aa' },
};

function createContext() {
  const operations = [];
  const ctx = {
    operations,
    beginPath() { operations.push(['beginPath']); },
    closePath() { operations.push(['closePath']); },
    fill() { operations.push(['fill']); },
    fillRect(...args) { operations.push(['fillRect', ...args]); },
    lineTo(...args) { operations.push(['lineTo', ...args]); },
    moveTo(...args) { operations.push(['moveTo', ...args]); },
    quadraticCurveTo(...args) { operations.push(['quadraticCurveTo', ...args]); },
  };
  for (const property of ['fillStyle', 'shadowColor', 'shadowBlur']) {
    Object.defineProperty(ctx, property, {
      get() { return undefined; },
      set(value) { operations.push([property, value]); },
    });
  }
  return ctx;
}

function legacyCompress(value) {
  const normalized = Math.min(1, Math.max(0, value));
  if (normalized <= 0) return 0;
  const k = 4;
  return (1 - Math.exp(-k * normalized)) / (1 - Math.exp(-k));
}

function legacyBarColor(baseColor, normalized) {
  if (baseColor.startsWith('#') && (baseColor.length === 7 || baseColor.length === 4)) {
    const alpha = 0.35 + normalized * 0.65;
    const hex = baseColor.length === 4
      ? `#${baseColor[1]}${baseColor[1]}${baseColor[2]}${baseColor[2]}${baseColor[3]}${baseColor[3]}`
      : baseColor;
    const red = parseInt(hex.slice(1, 3), 16);
    const green = parseInt(hex.slice(3, 5), 16);
    const blue = parseInt(hex.slice(5, 7), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }
  return baseColor;
}

function legacyFillRoundedRect(ctx, x, y, width, height, radius) {
  const resolvedRadius = Math.min(radius, width / 2, height / 2);
  if (resolvedRadius <= 0) {
    ctx.fillRect(x, y, width, height);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + resolvedRadius, y);
  ctx.lineTo(x + width - resolvedRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + resolvedRadius);
  ctx.lineTo(x + width, y + height - resolvedRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - resolvedRadius, y + height);
  ctx.lineTo(x + resolvedRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - resolvedRadius);
  ctx.lineTo(x, y + resolvedRadius);
  ctx.quadraticCurveTo(x, y, x + resolvedRadius, y);
  ctx.closePath();
  ctx.fill();
}

function legacyLevels(frame, environment) {
  if (environment.reduceMotion) {
    const uniform = legacyCompress(frame.energy);
    return CLASSIC_NEON_REDUCED_MOTION_SHAPE.map((shape) =>
      legacyCompress(Math.min(1, uniform * shape)));
  }
  let peak = 0;
  if (environment.amplitudeMode === 'capture') {
    for (const band of frame.bands) peak = Math.max(peak, band);
  }
  const peakScale = peak > 1 / 255 ? 1 / peak : 1;
  return Array.from({ length: CLASSIC_NEON_BAR_COUNT }, (_, index) => {
    const band = Math.min(1, Math.max(0, frame.bands[index] ?? 0));
    const normalized = environment.amplitudeMode === 'capture' ? band * peakScale : band;
    return legacyCompress(normalized);
  });
}

function renderLegacy(ctx, frame, environment) {
  const levels = legacyLevels(frame, environment);
  const totalWidth = CLASSIC_NEON_BAR_COUNT * environment.bars.width
    + (CLASSIC_NEON_BAR_COUNT - 1) * environment.bars.spacing;
  const startX = Math.max(0, (canvas.width - totalWidth) / 2);
  const centerY = canvas.height / 2;
  const maxBarHeight = canvas.height * 0.7;

  for (let index = 0; index < CLASSIC_NEON_BAR_COUNT; index += 1) {
    const normalized = levels[index] ?? 0;
    const barHeight = Math.max(4, normalized * maxBarHeight);
    const x = startX + index * (environment.bars.width + environment.bars.spacing);
    const y = environment.alignment === 'top'
      ? 0
      : environment.alignment === 'bottom'
        ? canvas.height - barHeight
        : centerY - barHeight / 2;
    ctx.fillStyle = legacyBarColor(environment.colors.bar, normalized);
    ctx.shadowColor = environment.colors.glow;
    ctx.shadowBlur = normalized * environment.bars.glow;
    legacyFillRoundedRect(
      ctx,
      x,
      y,
      environment.bars.width,
      barHeight,
      environment.bars.cornerRadius,
    );
  }
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
}

function renderClassic(frame, environment, params = neutralParams, instance) {
  const ctx = createContext();
  const visual = instance ?? CLASSIC_NEON_VISUAL_DEFINITION.create();
  visual.render(ctx, canvas, frame, params, { spectrum: environment });
  return { ctx, visual };
}

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

console.log('Classic (Neon Glow) spectrum');

check('definition is a capped linear spectrum with stable discovery metadata', () => {
  assert.deepEqual(
    [
      CLASSIC_NEON_VISUAL_DEFINITION.id,
      CLASSIC_NEON_VISUAL_DEFINITION.label,
      CLASSIC_NEON_VISUAL_DEFINITION.family,
      CLASSIC_NEON_VISUAL_DEFINITION.maxElements,
    ],
    [CLASSIC_NEON_SPECTRUM_ID, 'Classic (Neon Glow)', 'bar-spectrum', 32],
  );
  const visual = CLASSIC_NEON_VISUAL_DEFINITION.create();
  assert.deepEqual(visual.supportedLayouts, ['linear']);
  assert.equal(CLASSIC_NEON_VISUAL_DEFINITION.wants.bands, true);
  registerCoreSpectrumVisuals();
  registerCoreSpectrumVisuals();
});

const previewFrame = {
  energy: 0.32,
  bands: Array.from({ length: 32 }, (_, index) => ((index * 17) % 29) / 29),
  timeMs: 1000,
};

check('neutral preview emits the exact v5 canvas operation stream', () => {
  const expected = createContext();
  renderLegacy(expected, previewFrame, baseEnvironment);
  const actual = renderClassic(previewFrame, baseEnvironment).ctx;
  assert.deepEqual(actual.operations, expected.operations);
});

check('neutral live capture preserves per-frame peak normalization pixel operations', () => {
  const environment = { ...baseEnvironment, alignment: 'bottom', amplitudeMode: 'capture' };
  const frame = {
    energy: 0.44,
    bands: Array.from({ length: 32 }, (_, index) => ((index + 3) * 7 % 43) / 255),
    timeMs: 2000,
  };
  const expected = createContext();
  renderLegacy(expected, frame, environment);
  const actual = renderClassic(frame, environment).ctx;
  assert.deepEqual(actual.operations, expected.operations);
});

check('neutral reduced-motion capture preserves the fixed energy silhouette', () => {
  const environment = {
    ...baseEnvironment,
    alignment: 'top',
    amplitudeMode: 'capture',
    reduceMotion: true,
  };
  const frame = { ...previewFrame, energy: 0.61, timeMs: 3000 };
  const expected = createContext();
  renderLegacy(expected, frame, environment);
  const actual = renderClassic(frame, environment).ctx;
  assert.deepEqual(actual.operations, expected.operations);
});

check('Classic controls alter the visual while remaining bounded to 32 bars', () => {
  const neutral = renderClassic(previewFrame, baseEnvironment).ctx.operations;
  const tuned = renderClassic(previewFrame, baseEnvironment, {
    ...neutralParams,
    sensitivity: 1,
    intensity: 0.8,
    density: 0.9,
  }).ctx.operations;
  assert.notDeepEqual(tuned, neutral);
  assert.equal(tuned.filter(([operation]) => operation === 'fill').length, 32);
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-classic-neon-spectrum: ${checks} checks passed`);
