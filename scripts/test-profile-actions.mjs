// Profile actions menu — pure naming, state, and markup contract tests.
//
//   Run: node scripts/test-profile-actions.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.cwd());
const outdir = mkdtempSync(join(tmpdir(), 'rvn-profile-actions-'));
const outfile = join(outdir, 'profile-actions.mjs');

await build({
  entryPoints: [join(root, 'src/ui/design-studio/profile-actions-menu.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { '@': root },
  logLevel: 'silent',
});

const {
  nextAvailableProfileCopyName,
  nextAvailableProfileName,
  renderProfileActionsMarkup,
  resolveProfileActionsView,
} = await import(pathToFileURL(outfile).href);

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

console.log('test-profile-actions');

// CHANGED: Test the menu's user-facing naming and accessibility contract as pure behavior.
// WHY: copy numbering and action hierarchy must stay deterministic across extension and hosted mounts.
check('clone uses the first available copy number case-insensitively', () => {
  assert.equal(
    nextAvailableProfileCopyName('Ad hoc', ['AD HOC', 'Ad hoc (copy 1)', 'ad hoc (COPY 3)']),
    'Ad hoc (copy 2)',
  );
});

check('cloning an existing copy does not nest copy suffixes', () => {
  assert.equal(
    nextAvailableProfileCopyName('Studio (copy 2)', ['Studio', 'Studio (copy 1)']),
    'Studio (copy 2)',
  );
});

check('generated profile names remain within the persisted 40-character cap', () => {
  const name = nextAvailableProfileCopyName('A'.repeat(40), []);
  assert.equal(name.length, 40);
  assert.match(name, /\(copy 1\)$/);
});

check('new profile suggestion advances without colliding', () => {
  assert.equal(
    nextAvailableProfileName('New profile', ['New Profile', 'New profile 2']),
    'New profile 3',
  );
});

check('dirty state turns Clone into the existing Save-as-new pathway', () => {
  assert.deepEqual(
    resolveProfileActionsView({
      activeProfileName: 'Ad hoc',
      profileNames: ['Ad hoc'],
      hasSavedProfile: true,
      profileDirty: true,
      canAddProfile: true,
    }),
    {
      cloneLabel: 'Save as new profile',
      cloneDescription: 'Keep the original and save these edits separately',
      manageDisabled: false,
      addDisabled: false,
    },
  );
});

check('markup preserves grouped action order and dialog accessibility', () => {
  const markup = renderProfileActionsMarkup();
  const actions = [...markup.matchAll(/data-profile-action="([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(actions, ['add', 'import', 'rename', 'clone', 'export', 'delete']);
  assert.match(markup, /aria-haspopup="menu"/);
  assert.match(markup, /role="menu"/);
  assert.match(markup, /role="dialog"/);
  assert.match(markup, /aria-modal="true"/);
  assert.match(markup, /value="current"/);
  assert.match(markup, /value="defaults"/);
  assert.match(markup, /data-save-profile[\s\S]*hidden/);
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-profile-actions: ${checks} checks passed`);
