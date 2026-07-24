// Hosted orientation chronos gate — lifecycle regression tests.
//
//   Run: npm run test:chronos-gate

import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';

const root = resolve(process.cwd());
const scratchRoot = process.env.RVN_TEST_TMPDIR || root;
const outdir = mkdtempSync(join(scratchRoot, '.tmp-chronos-gate-'));
const outfile = join(outdir, 'chronos-gate.mjs');

await build({
  entryPoints: [join(root, 'demo/src/hub/chronos-gate.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { '@': root },
  define: {
    'import.meta.env.BASE_URL': JSON.stringify('/reddit-voice-notes-chrome/'),
  },
  external: ['@ffmpeg/ffmpeg'],
  logLevel: 'silent',
});

const { window } = parseHTML(
  '<!doctype html><html><body><a href="design-studio/" data-design-studio-cta>Open Design Studio</a></body></html>',
);
const assignedUrls = [];
let resolveCacheOpen;
let cacheOpen = () =>
  new Promise((resolve) => {
    resolveCacheOpen = resolve;
  });

Object.defineProperty(window, 'location', {
  configurable: true,
  value: {
    assign(url) {
      assignedUrls.push(url);
    },
  },
});
Object.assign(globalThis, {
  window,
  document: window.document,
  caches: {
    open: (...args) => cacheOpen(...args),
  },
});

const { installDesignStudioGate } = await import(pathToFileURL(outfile).href);
installDesignStudioGate();

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

function dispatchPageShow(persisted) {
  const event = new window.Event('pageshow');
  Object.defineProperty(event, 'persisted', { value: persisted });
  window.dispatchEvent(event);
}

function clickStudioCta() {
  window.document.querySelector('[data-design-studio-cta]').click();
}

console.log('test-chronos-gate');

// BUG FIX: BFCache restoration retained the completed launch modal and its gate guard
// Fix: Model a still-pending restored page, require immediate cleanup, then prove its
// stale async completion cannot redirect and a genuinely new launch still succeeds.
clickStudioCta();
check('a genuine launch shows the warm-up dialog while work is pending', () => {
  assert.equal(window.document.querySelectorAll('.chronos').length, 1);
});

dispatchPageShow(false);
check('an ordinary pageshow does not cancel a genuine pending launch', () => {
  assert.equal(window.document.querySelectorAll('.chronos').length, 1);
});

dispatchPageShow(true);
check('BFCache restoration removes the stale warm-up dialog', () => {
  assert.equal(window.document.querySelectorAll('.chronos').length, 0);
});

resolveCacheOpen({
  match: async () => new Response('warm'),
  put: async () => undefined,
});
await new Promise((resolve) => setTimeout(resolve, 0));
check('the invalidated warm attempt cannot redirect the restored orientation', () => {
  assert.deepEqual(assignedUrls, []);
});

cacheOpen = async () => ({
  match: async () => new Response('warm'),
  put: async () => undefined,
});
clickStudioCta();
await new Promise((resolve) => setTimeout(resolve, 0));
check('a new launch can navigate and leaves no cached modal state', () => {
  assert.deepEqual(assignedUrls, ['/reddit-voice-notes-chrome/design-studio/']);
  assert.equal(window.document.querySelectorAll('.chronos').length, 0);
});

cacheOpen = async () => {
  throw new Error('offline');
};
clickStudioCta();
await new Promise((resolve) => setTimeout(resolve, 0));
check('a failed launch leaves the pending state for explicit recovery actions', () => {
  assert.equal(
    window.document.querySelector('[data-chronos-status]').textContent,
    'Could not warm the media engines.',
  );
  assert.equal(window.document.querySelector('[data-chronos-error]').hidden, false);
  assert.equal(window.document.querySelector('[data-chronos-retry]').textContent, 'Retry');
  assert.equal(window.document.querySelector('[data-chronos-open]').textContent, 'Open anyway');
});

dispatchPageShow(true);
check('restoring after a failed launch also clears the owned gate state', () => {
  assert.equal(window.document.querySelectorAll('.chronos').length, 0);
});

console.log(`\n${checks}/${checks} checks passed`);
rmSync(outdir, { recursive: true, force: true });
