// v6.0 shared visual-token contract: TypeScript and Studio CSS stay byte-identical.
//
//   Run: node scripts/test-ui-tokens.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-ui-tokens-'));
const outfile = join(outdir, 'tokens.mjs');

await build({
  entryPoints: ['src/ui/tokens.ts'],
  absWorkingDir: root,
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'silent',
});

const { CIVIDIS, CIVIDIS_CSS_VARIABLES } = await import(pathToFileURL(outfile).href);
const css = readFileSync(join(root, 'entrypoints/design-studio/studio-palette.css'), 'utf8');

assert.equal(CIVIDIS.length, 7, 'shared Cividis ramp must remain a compact seven-stop scale');
assert.equal(CIVIDIS_CSS_VARIABLES.length, CIVIDIS.length);
assert.equal(CIVIDIS[0], '#00204d');
assert.equal(CIVIDIS.at(-1), '#ffea46');

for (let index = 0; index < CIVIDIS.length; index += 1) {
  const name = CIVIDIS_CSS_VARIABLES[index];
  const color = CIVIDIS[index];
  assert.match(css, new RegExp(`${name}\\s*:\\s*${color}`, 'i'), `${name} must match tokens.ts`);
}

rmSync(outdir, { recursive: true, force: true });
console.log(`test-ui-tokens: ${CIVIDIS.length} synchronized Cividis stops passed`);
