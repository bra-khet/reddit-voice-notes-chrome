// v5.3.10 IVF muxer/parser/concat tests — byte-level header layout, roundtrip,
// and the concat continuity guarantees the WebCodecs stitch step relies on
// (global PTS strictly increasing, stream-param agreement, frame-count rewrite).
//
//   Run:  node scripts/test-ivf.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-ivf-'));
const outfile = join(outdir, 'bundle.mjs');

await build({
  entryPoints: [join(root, 'src/encoding/ivf.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { '@': root },
  logLevel: 'silent',
});

const {
  IVF_FRAME_HEADER_BYTES,
  IVF_HEADER_BYTES,
  buildIvf,
  concatIvfSegments,
  parseIvf,
} = await import(pathToFileURL(outfile).href);

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ok ${name}`);
}

const params = { fourcc: 'VP80', width: 640, height: 360, timebaseRate: 30, timebaseScale: 1 };

function frame(ptsFrames, fill, size = 5) {
  return { ptsFrames, data: new Uint8Array(size).fill(fill) };
}

check('header layout matches the IVF spec byte-for-byte', () => {
  const bytes = buildIvf(params, [frame(0, 0xaa, 3)]);
  const view = new DataView(bytes.buffer);
  assert.equal(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]), 'DKIF');
  assert.equal(view.getUint16(4, true), 0); // version
  assert.equal(view.getUint16(6, true), IVF_HEADER_BYTES);
  assert.equal(String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]), 'VP80');
  assert.equal(view.getUint16(12, true), 640);
  assert.equal(view.getUint16(14, true), 360);
  assert.equal(view.getUint32(16, true), 30); // timebase rate (den) = fps
  assert.equal(view.getUint32(20, true), 1); // timebase scale (num)
  assert.equal(view.getUint32(24, true), 1); // frame count
  assert.equal(bytes.byteLength, IVF_HEADER_BYTES + IVF_FRAME_HEADER_BYTES + 3);
});

check('frame headers carry payload size + 64-bit little-endian PTS', () => {
  const bytes = buildIvf(params, [frame(450, 0x11, 4)]);
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(IVF_HEADER_BYTES, true), 4); // payload size
  assert.equal(view.getUint32(IVF_HEADER_BYTES + 4, true), 450); // pts lo
  assert.equal(view.getUint32(IVF_HEADER_BYTES + 8, true), 0); // pts hi
  assert.deepEqual(
    Array.from(bytes.slice(IVF_HEADER_BYTES + IVF_FRAME_HEADER_BYTES)),
    [0x11, 0x11, 0x11, 0x11],
  );
});

check('build → parse roundtrip preserves params, PTS, and payloads', () => {
  const frames = [frame(0, 1), frame(1, 2), frame(2, 3, 9)];
  const parsed = parseIvf(buildIvf(params, frames));
  assert.equal(parsed.fourcc, 'VP80');
  assert.equal(parsed.width, 640);
  assert.equal(parsed.height, 360);
  assert.equal(parsed.timebaseRate, 30);
  assert.equal(parsed.timebaseScale, 1);
  assert.equal(parsed.frameCount, 3);
  assert.deepEqual(parsed.frames.map((f) => f.ptsFrames), [0, 1, 2]);
  assert.deepEqual(Array.from(parsed.frames[2].data), Array(9).fill(3));
});

check('parse rejects truncated, unsigned, and count-mismatched streams', () => {
  assert.throws(() => parseIvf(new Uint8Array(8)), /shorter/);
  const bad = buildIvf(params, [frame(0, 1)]);
  bad[0] = 0x58; // corrupt 'DKIF'
  assert.throws(() => parseIvf(bad), /DKIF/);
  const wrongCount = buildIvf(params, [frame(0, 1)]);
  new DataView(wrongCount.buffer).setUint32(24, 7, true);
  assert.throws(() => parseIvf(wrongCount), /count mismatch/);
});

check('concat merges segments with global PTS continuity + rewritten count', () => {
  // Two 3-frame segments carrying GLOBAL frame indices, exactly as the chunk
  // encoders emit them — concat must not rebase anything.
  const seg0 = buildIvf(params, [frame(0, 1), frame(1, 1), frame(2, 1)]);
  const seg1 = buildIvf(params, [frame(3, 2), frame(4, 2), frame(5, 2)]);
  const merged = parseIvf(concatIvfSegments([seg0, seg1]));
  assert.equal(merged.frameCount, 6);
  assert.deepEqual(merged.frames.map((f) => f.ptsFrames), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(
    merged.frames.map((f) => f.data[0]),
    [1, 1, 1, 2, 2, 2],
  );
});

check('concat rejects non-monotonic PTS (overlap or gap-in-order bugs)', () => {
  const seg0 = buildIvf(params, [frame(0, 1), frame(1, 1)]);
  const overlapping = buildIvf(params, [frame(1, 2), frame(2, 2)]);
  assert.throws(() => concatIvfSegments([seg0, overlapping]), /strictly increasing/);
});

check('concat rejects stream-parameter disagreements', () => {
  const seg0 = buildIvf(params, [frame(0, 1)]);
  const vp9 = buildIvf({ ...params, fourcc: 'VP90' }, [frame(1, 2)]);
  const resized = buildIvf({ ...params, width: 320 }, [frame(1, 2)]);
  assert.throws(() => concatIvfSegments([seg0, vp9]), /disagree/);
  assert.throws(() => concatIvfSegments([seg0, resized]), /disagree/);
  assert.throws(() => concatIvfSegments([]), /at least one/);
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-ivf: ${checks} checks passed`);
