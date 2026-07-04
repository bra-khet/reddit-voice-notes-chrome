// v5.3.9 overlay concat FFmpeg argument builder tests — trim graph, per-input
// decoder/genpts flags, encode-tail parity with the alpha-normalize contract.
//
//   Run:  node scripts/test-overlay-concat-args.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-concat-args-'));
const outfile = join(outdir, 'bundle.mjs');

await build({
  entryPoints: [join(root, 'src/ffmpeg/overlay-concat-args.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { '@': root },
  logLevel: 'silent',
});

const { buildOverlayConcatArgs, buildOverlayConcatFilterGraph, overlayConcatEncodeArgs } =
  await import(pathToFileURL(outfile).href);

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ok ${name}`);
}

check('filter graph trims each chunk to its exact planned duration', () => {
  const graph = buildOverlayConcatFilterGraph([15, 15.5]);
  assert.equal(
    graph,
    '[0:v]trim=end=15.000000,setpts=PTS-STARTPTS[v0];' +
      '[1:v]trim=end=15.500000,setpts=PTS-STARTPTS[v1];' +
      '[v0][v1]concat=n=2:v=1:a=0,format=yuva420p[vout]',
  );
});

check('default args force libvpx alpha decode + genpts per input', () => {
  const args = buildOverlayConcatArgs({
    chunkFiles: ['overlay-chunk-0.webm', 'overlay-chunk-1.webm'],
    chunkDurationsSeconds: [15, 15],
    fps: 30,
    outputFile: 'out.webm',
  });
  assert.deepEqual(args.slice(0, 12), [
    '-fflags', '+genpts', '-c:v', 'libvpx', '-i', 'overlay-chunk-0.webm',
    '-fflags', '+genpts', '-c:v', 'libvpx', '-i', 'overlay-chunk-1.webm',
  ]);
  const mapIndex = args.indexOf('-map');
  assert.ok(mapIndex > 0);
  assert.equal(args[mapIndex + 1], '[vout]');
  assert.equal(args[args.length - 1], 'out.webm');
});

check('generic-decode tier omits the forced decoder but keeps genpts', () => {
  const args = buildOverlayConcatArgs({
    chunkFiles: ['a.webm', 'b.webm'],
    chunkDurationsSeconds: [10, 10],
    fps: 30,
    outputFile: 'out.webm',
    inputDecoder: null,
  });
  assert.deepEqual(args.slice(0, 8), [
    '-fflags', '+genpts', '-i', 'a.webm',
    '-fflags', '+genpts', '-i', 'b.webm',
  ]);
});

check('encode tail matches the alpha-normalize contract exactly', () => {
  // Sync: overlay-webm-finalize.ts normalizeOverlayWebmForComposite encodeTail —
  // the burn-in composite tiers assume this exact yuva420p VP8 shape.
  assert.deepEqual(overlayConcatEncodeArgs(30, 'out.webm'), [
    '-r', '30', '-an',
    '-c:v', 'libvpx', '-pix_fmt', 'yuva420p',
    '-auto-alt-ref', '0', '-lag-in-frames', '0',
    '-deadline', 'good', '-b:v', '1800k',
    '-f', 'webm', 'out.webm',
  ]);
});

check('mismatched or empty inputs throw', () => {
  assert.throws(() =>
    buildOverlayConcatArgs({
      chunkFiles: ['a.webm'],
      chunkDurationsSeconds: [1, 2],
      fps: 30,
      outputFile: 'out.webm',
    }),
  );
  assert.throws(() =>
    buildOverlayConcatArgs({
      chunkFiles: [],
      chunkDurationsSeconds: [],
      fps: 30,
      outputFile: 'out.webm',
    }),
  );
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-overlay-concat-args: ${checks} checks passed`);
