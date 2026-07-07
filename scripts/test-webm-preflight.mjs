// WebM preflight structural fallback tests (background-tab cap-stop path).
//
//   Run:  node scripts/test-webm-preflight.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-webm-preflight-'));
const outfile = join(outdir, 'bundle.mjs');

await build({
  entryPoints: [join(root, 'src/ffmpeg/webm-preflight.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { '@': root },
  logLevel: 'silent',
});

const { hasWebmEbmlMagic, webmStructuralPreflightPasses } = await import(
  pathToFileURL(outfile).href
);

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ok ${name}`);
}

check('EBML magic recognizes a WebM header', () => {
  assert.equal(hasWebmEbmlMagic(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])), true);
  assert.equal(hasWebmEbmlMagic(new Uint8Array([0x00, 0x45, 0xdf, 0xa3])), false);
});

check('structural pass accepts a long cap-stop sized blob', () => {
  const twoMinBytes = 8 * 1024 * 1024;
  assert.equal(webmStructuralPreflightPasses(twoMinBytes, 120), true);
});

check('structural pass rejects tiny blobs even with a long duration hint', () => {
  assert.equal(webmStructuralPreflightPasses(50_000, 120), false);
  assert.equal(webmStructuralPreflightPasses(2_000, 2), false);
});

check('structural pass accepts moderate blobs without a duration hint', () => {
  assert.equal(webmStructuralPreflightPasses(60_000), true);
  assert.equal(webmStructuralPreflightPasses(10_000), false);
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-webm-preflight: ${checks} checks passed`);