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

// v6 Track C: the popup adopts the shared palette through a popup-only overlay
// (entrypoints/popup/popup-palette.css) instead of forking values. Three invariants:
// the overlay @imports the Studio palette (single token source), the popup entry
// actually loads the overlay, and no off-axis Reddit hex sneaks back in.
const popupPalette = readFileSync(join(root, 'entrypoints/popup/popup-palette.css'), 'utf8');
const popupMain = readFileSync(join(root, 'entrypoints/popup/main.ts'), 'utf8');

assert.match(
  popupPalette,
  /@import\s+['"]\.\.\/design-studio\/studio-palette\.css['"]/,
  'popup-palette.css must @import the Studio palette as its single token source',
);
assert.match(
  popupMain,
  /import\s+['"]\.\/popup-palette\.css['"]/,
  'popup main.ts must import the popup-palette.css overlay',
);

const BANNED_OFF_AXIS_HEXES = ['#0079d3', '#d93900', '#ff4500', '#818384', '#1a1a1b', '#272729', '#343536'];
const popupPaletteLower = popupPalette.toLowerCase();
for (const hex of BANNED_OFF_AXIS_HEXES) {
  assert.ok(
    !popupPaletteLower.includes(hex),
    `popup-palette.css must not reintroduce off-axis ${hex} (design-studio.md §10.3)`,
  );
}

rmSync(outdir, { recursive: true, force: true });
console.log(
  `test-ui-tokens: ${CIVIDIS.length} synchronized Cividis stops + popup palette adoption (${BANNED_OFF_AXIS_HEXES.length} banned hexes clean) passed`,
);
