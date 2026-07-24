// Profile actions menu — pure naming, state, and markup contract tests.
//
//   Run: node scripts/test-profile-actions.mjs

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
      resetVisible: true,
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
  assert.match(markup, /name="profile-import-strategy" value="merge" checked/);
  assert.match(markup, /name="profile-import-strategy" value="replace"/);
  assert.match(markup, /Merge with this Studio/);
  assert.match(markup, /Replace all preferences/);
  assert.match(markup, /data-save-profile[\s\S]*hidden/);
});

check('import strategy sheet defaults to merge and keeps replacement explicit', () => {
  const markup = renderProfileActionsMarkup();
  const mergeIndex = markup.indexOf('value="merge"');
  const replaceIndex = markup.indexOf('value="replace"');
  assert.ok(mergeIndex >= 0 && mergeIndex < replaceIndex);
  assert.match(markup, /studio__profile-import-badge">Recommended/);
  assert.match(markup, /keep unmatched local profiles and styles/i);
  assert.match(markup, /local profiles and styles missing from it are removed/i);

  const mountSource = readFileSync(
    join(root, 'src/ui/design-studio/mount-clip-studio.ts'),
    'utf8',
  );
  assert.match(mountSource, /importUserPreferencesFromJSON\(json,\s*strategy\)/);
  assert.match(mountSource, /strategy === 'replace'[\s\S]*window\.confirm/);
  const css = readFileSync(join(root, 'entrypoints/design-studio/profile-actions.css'), 'utf8');
  assert.match(css, /\.studio__profile-import-option--merge:has\(input:checked\)/);
  assert.match(css, /\.studio__profile-import-option--replace:has\(input:checked\)/);
  assert.match(css, /\[data-profile-import-options\]\[hidden\]/);
});

check('semantic profile reset sits between Save and the control deck', () => {
  const markup = renderProfileActionsMarkup();
  const saveIndex = markup.indexOf('data-save-profile');
  const resetIndex = markup.indexOf('data-reset-profile');
  const menuIndex = markup.indexOf('data-profile-actions-shell');
  assert.ok(saveIndex < resetIndex && resetIndex < menuIndex);
  assert.match(markup, /data-reset-profile[\s\S]*aria-label="Reset unsaved profile changes"/);
  assert.match(markup, /studio__settings-reset-glyph studio__profile-reset-glyph/);
  assert.match(markup, /data-reset-profile[\s\S]*hidden/);
});

check('dirty save and reset remain a non-wrapping right-hand control group', () => {
  // BUG FIX: Profile actions collapsed or wrapped at intermediate widths
  // Fix: Pin the four-column row, usable Save width, fixed reset/menu keys, and removal of any second grid row.
  // Sync: entrypoints/design-studio/profile-actions.css
  const css = readFileSync(join(root, 'entrypoints/design-studio/profile-actions.css'), 'utf8');
  assert.match(
    css,
    /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(124px,\s*auto\)\s+38px\s+38px/,
  );
  assert.match(css, /\.studio__profile-save-slot\s*\{[^}]*grid-column:\s*2;[^}]*grid-row:\s*1;/s);
  assert.match(css, /\.studio__profile-save-btn\s*\{[^}]*min-width:\s*124px;[^}]*white-space:\s*nowrap;/s);
  assert.match(css, /\.studio__profile-reset-slot\s*\{[^}]*grid-column:\s*3;[^}]*grid-row:\s*1;/s);
  assert.match(css, /\.studio__profile-actions-shell\s*\{[^}]*grid-column:\s*4;[^}]*grid-row:\s*1;/s);
  assert.doesNotMatch(css, /\.studio__profile-save-slot\s*\{[^}]*grid-row:\s*2;/s);
});

check('reset callback reapplies the selected profile through the existing pathway', () => {
  const mountSource = readFileSync(
    join(root, 'src/ui/design-studio/mount-clip-studio.ts'),
    'utf8',
  );
  assert.match(
    mountSource,
    /async onReset\(\)[\s\S]*invalidateInFlightSaves\(\);[\s\S]*studioPersist\(\(\) => applyClipProfile\(profileId\)\)/,
  );
});

rmSync(outdir, { recursive: true, force: true });
console.log(`\ntest-profile-actions: ${checks} checks passed`);
