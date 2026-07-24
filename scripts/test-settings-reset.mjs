// Settings reset — normalized semantics and accessible choice markup.
//
//   Run: node scripts/test-settings-reset.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-settings-reset-'));
const outfile = join(outdir, 'settings-reset.mjs');

await build({
  entryPoints: [join(root, 'src/ui/design-studio/settings-reset-dialog.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { '@': root },
  logLevel: 'silent',
});

const {
  BACKGROUND_RESET_COPY,
  renderSettingsResetControl,
  resolveBackgroundResetTarget,
} = await import(pathToFileURL(outfile).href);

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

console.log('test-settings-reset');

// CHANGED: Pin the difference between reset-to-default and reset-to-blank as pure state.
// WHY: both operations share a dialog, so their persistence targets must never collapse together.
check('background default keeps media and restores every normalized layout field', () => {
  const target = resolveBackgroundResetTarget('default', 'bg-personal-1');
  assert.equal(target.customBackgroundId, 'bg-personal-1');
  assert.equal(target.backgroundScaleMode, 'fill');
  assert.equal(target.backgroundPosition, 'center');
  assert.deepEqual(target.backgroundLayout.customPosition, { x: 0.5, y: 0.5 });
  assert.equal(target.backgroundLayout.manualScale, 1);
  assert.equal(target.backgroundLayout.blur, 0);
  assert.equal(target.backgroundLayout.blendMode, 'source-over');
  assert.equal(target.backgroundLayout.holo, false);
  assert.equal(target.backgroundLayout.gifSpeed, 1);
  assert.equal(target.backgroundLayout.gifReactToAudio, false);
});

check('background blank clears only the media reference and still normalizes layout', () => {
  const target = resolveBackgroundResetTarget('blank', 'bg-personal-1');
  assert.equal(target.customBackgroundId, null);
  assert.equal(target.backgroundLayout.scaleMode, 'fill');
  assert.equal(target.backgroundLayout.position, 'center');
  assert.equal(target.backgroundLayout.lockToSafeText, false);
});

check('choice sheet states scope, preservation, and both confirmations', () => {
  const markup = renderSettingsResetControl(BACKGROUND_RESET_COPY);
  assert.match(markup, /<dialog[\s\S]*data-settings-reset-dialog="background"/);
  assert.match(markup, /Your profile, transcript, current take, and uploaded files stay untouched/);
  assert.match(markup, /value="default"/);
  assert.match(markup, /value="blank"/);
  assert.match(markup, /Restore layout/);
  assert.equal(BACKGROUND_RESET_COPY.choices[1].confirmLabel, 'Use theme background');
  assert.match(markup, /data-settings-reset-status[\s\S]*aria-live="polite"/);
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-settings-reset: ${checks} checks passed`);
