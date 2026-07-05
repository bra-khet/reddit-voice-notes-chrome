// v5.3.10 WebCodecs dual-stream composite argument tests — alphamerge tier
// graphs, calibration-driven alpha range expansion, and the structural
// regression guards that keep this path normalize-free: the overlay streams
// must be DECODED ONLY (no libvpx forcing, no yuva re-encode, no second
// encoder) with the single x264 output pass the composite always ran.
//
//   Run:  node scripts/test-overlay-alphamerge-args.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-alphamerge-args-'));
const outfile = join(outdir, 'bundle.mjs');

await build({
  entryPoints: [join(root, 'src/ffmpeg/overlay-alphamerge-args.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { '@': root },
  logLevel: 'silent',
});

const {
  ALPHA_LIMITED_RANGE_EXPAND_LUT,
  buildOverlayAlphamergeArgs,
  buildOverlayAlphamergeFilterGraph,
  buildOverlayAlphamergeTiers,
} = await import(pathToFileURL(outfile).href);

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ok ${name}`);
}

check('full-range graph merges alpha luma without expansion', () => {
  const graph = buildOverlayAlphamergeFilterGraph({
    limitedRangeAlpha: false,
    unpremultiply: true,
    alphaFormat: 'gray',
  });
  assert.equal(
    graph,
    '[1:v]format=yuv420p[ovc];[2:v]format=gray[ova];' +
      '[ovc][ova]alphamerge,unpremultiply=inplace=1[ol];' +
      '[0:v][ol]overlay=0:0:shortest=1[vout]',
  );
});

check('limited-range graph expands alpha luma before alphamerge', () => {
  const graph = buildOverlayAlphamergeFilterGraph({
    limitedRangeAlpha: true,
    unpremultiply: true,
    alphaFormat: 'gray',
  });
  assert.ok(graph.includes(`[2:v]${ALPHA_LIMITED_RANGE_EXPAND_LUT},format=gray[ova]`));
  // The expansion expression must stay comma-free: commas separate filters in
  // a graph chain, and quoting workarounds are exactly the fragility we avoid.
  assert.ok(!ALPHA_LIMITED_RANGE_EXPAND_LUT.includes(','));
});

check('tier family: unpremultiply-gray, unpremultiply-yuv, premultiplied last', () => {
  const tiers = buildOverlayAlphamergeTiers(true);
  assert.deepEqual(
    tiers.map((tier) => tier.name),
    [
      'webcodecs-alphamerge-unpremultiply-gray',
      'webcodecs-alphamerge-unpremultiply-yuv',
      'webcodecs-alphamerge-premultiplied',
    ],
  );
  assert.ok(tiers[0].filterComplex.includes('unpremultiply'));
  assert.ok(tiers[1].filterComplex.includes('unpremultiply'));
  assert.ok(!tiers[1].filterComplex.includes('format=gray'));
  assert.ok(!tiers[2].filterComplex.includes('unpremultiply'));
  // Calibration flag threads into every tier.
  for (const tier of tiers) {
    assert.ok(tier.filterComplex.includes(ALPHA_LIMITED_RANGE_EXPAND_LUT));
  }
  for (const tier of buildOverlayAlphamergeTiers(false)) {
    assert.ok(!tier.filterComplex.includes(ALPHA_LIMITED_RANGE_EXPAND_LUT));
  }
});

check('args order inputs base → color IVF → alpha IVF with explicit demuxers', () => {
  const [tier] = buildOverlayAlphamergeTiers(false);
  const args = buildOverlayAlphamergeArgs({
    tier,
    baseFile: 'base.mp4',
    colorFile: 'overlay-color.ivf',
    alphaFile: 'overlay-alpha.ivf',
    outputFile: 'final.mp4',
  });
  assert.deepEqual(args.slice(0, 10), [
    '-i', 'base.mp4',
    '-f', 'ivf', '-i', 'overlay-color.ivf',
    '-f', 'ivf', '-i', 'overlay-alpha.ivf',
  ]);
  assert.equal(args[args.length - 1], 'final.mp4');
  const mapIndex = args.indexOf('-map');
  assert.equal(args[mapIndex + 1], '[vout]');
  assert.equal(args[mapIndex + 3], '0:a?');
});

check('encode tail mirrors the canvas-overlay composite exactly', () => {
  // Sync: subtitle-burnin.ts buildCanvasOverlayBurnInArgs — same output
  // contract regardless of which overlay strategy family ran.
  const [tier] = buildOverlayAlphamergeTiers(false);
  const args = buildOverlayAlphamergeArgs({
    tier,
    baseFile: 'base.mp4',
    colorFile: 'c.ivf',
    alphaFile: 'a.ivf',
    outputFile: 'final.mp4',
  });
  const tail = args.slice(args.indexOf('-c:v'));
  assert.deepEqual(tail, [
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'copy', '-movflags', '+faststart', 'final.mp4',
  ]);
});

check('REGRESSION GUARD: overlay streams are decoded, never re-encoded', () => {
  // The whole point of v5.3.10: no normalize pass, no second video encoder.
  // If these args ever grow a forced libvpx decode, a yuva420p conversion of
  // the OVERLAY output, or more than the single x264 output encoder, the
  // normalize-elimination win has been silently reverted.
  for (const tier of buildOverlayAlphamergeTiers(true)) {
    const args = buildOverlayAlphamergeArgs({
      tier,
      baseFile: 'base.mp4',
      colorFile: 'c.ivf',
      alphaFile: 'a.ivf',
      outputFile: 'final.mp4',
    });
    assert.ok(!args.includes('libvpx'), `${tier.name} forces a vpx codec`);
    assert.equal(
      args.filter((a) => a === '-c:v').length,
      1,
      `${tier.name} has more than the single x264 output encoder`,
    );
    assert.ok(!tier.filterComplex.includes('yuva420p'), `${tier.name} re-encodes to yuva`);
    assert.ok(tier.filterComplex.includes('alphamerge'), `${tier.name} lost alphamerge`);
  }
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-overlay-alphamerge-args: ${checks} checks passed`);
