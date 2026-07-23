// v6.0 Track D §3.6 — the workflow banner suppresses Reddit-only affordances on a
// host that cannot attach, and is byte-identical to the extension when it can.
//
//   Run: node scripts/test-workflow-banner-host.mjs   (or `npm run test:workflow-banner-host`)
//
// The load-bearing requirement (§3.6): suppress the CTA rather than leave a dead
// button. So the primary assertions are on the presence/absence of the
// `data-wf-switch-reddit` control, with the honest copy carried in the text.

import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';

const root = resolve(process.cwd());
const cacheDir = join(root, 'node_modules', '.cache', 'banner-host-test');
rmSync(cacheDir, { recursive: true, force: true });
mkdirSync(cacheDir, { recursive: true });

const abs = (p) => join(root, p).replace(/\\/g, '/');
const entryPath = join(cacheDir, 'entry.ts');
writeFileSync(
  entryPath,
  `export { mountWorkflowBanner } from ${JSON.stringify(abs('src/ui/design-studio/workflow-phase-banner'))};
export { setStudioHostCapabilities } from ${JSON.stringify(abs('src/ui/design-studio/host-capabilities'))};
`,
);

const bundlePath = join(cacheDir, 'bundle.mjs');
await build({
  entryPoints: [entryPath],
  absWorkingDir: root,
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundlePath,
  logLevel: 'silent',
  plugins: [
    {
      name: 'rvn-alias',
      setup(b) {
        b.onResolve({ filter: /^@\// }, (args) => {
          const rel = args.path.slice(2);
          for (const candidate of [`${rel}.ts`, `${rel}.tsx`, join(rel, 'index.ts')]) {
            const full = resolve(root, candidate);
            if (existsSync(full)) return { path: full };
          }
          return { path: resolve(root, rel) };
        });
      },
    },
  ],
});

// workflow-state.ts's onWorkflowPhaseChanged registers a storage.onChanged listener
// at mount; nothing else in the banner touches browser.* unless a button is clicked.
globalThis.browser = {
  storage: { onChanged: { addListener() {}, removeListener() {} } },
  runtime: { getURL: (p) => `chrome-extension://test/${String(p).replace(/^\/+/, '')}` },
};

const { mountWorkflowBanner, setStudioHostCapabilities } = await import(
  pathToFileURL(bundlePath).href
);

function render(phase, status) {
  const { document } = parseHTML(
    '<!doctype html><html><body><div id="root"><div data-workflow-banner></div></div></body></html>',
  );
  globalThis.document = document;
  const rootEl = document.querySelector('#root');
  mountWorkflowBanner(rootEl, phase, status);
  return rootEl.querySelector('[data-workflow-banner]').innerHTML;
}

const CAPTURE = { hasSessionRecording: false, hasTranscriptCues: false, bakedForSession: false, transcriptDelivery: 'idle' };
const BAKED = { hasSessionRecording: true, hasTranscriptCues: true, bakedForSession: true, transcriptDelivery: 'idle' };

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${error.message.split('\n').join('\n      ')}`);
  }
}

// ── Extension default (no hostCapabilities ⇒ redditAttach true) ──────────────
test('DEFAULT capture: renders the Reddit CTA button and copy', () => {
  setStudioHostCapabilities(undefined);
  const html = render('capture', CAPTURE);
  assert.match(html, /data-wf-switch-reddit/, 'the extension keeps the Reddit CTA');
  assert.match(html, /Record on Reddit instead/);
  assert.match(html, /record on your Reddit tab/);
});

test('DEFAULT polish+baked: renders the Attach on Reddit button', () => {
  setStudioHostCapabilities({});
  const html = render('polish', BAKED);
  assert.match(html, /data-wf-switch-reddit/);
  assert.match(html, /Attach on Reddit/);
  assert.match(html, /attach it on Reddit/);
});

// ── Hosted (redditAttach false) ──────────────────────────────────────────────
test('HOSTED capture: NO Reddit CTA button, no "Reddit tab" alternative', () => {
  setStudioHostCapabilities({ redditAttach: false });
  const html = render('capture', CAPTURE);
  assert.doesNotMatch(html, /data-wf-switch-reddit/, '§3.6: suppress the CTA, do not leave a dead button');
  assert.doesNotMatch(html, /record on your Reddit tab/);
  assert.match(html, /press Record in the Current Take deck/);
});

test('HOSTED polish+baked: NO CTA button; copy points at installing the extension', () => {
  setStudioHostCapabilities({ redditAttach: false });
  const html = render('polish', BAKED);
  assert.doesNotMatch(html, /data-wf-switch-reddit/);
  assert.doesNotMatch(html, /attach it on Reddit/);
  assert.match(html, /install the extension/);
});

test('HOSTED explainer: says the hosted Studio cannot post on its own', () => {
  setStudioHostCapabilities({ redditAttach: false });
  const html = render('polish', BAKED);
  assert.match(html, /can't post to Reddit on its own/);
});

// ── Toggle back proves the flag is not sticky in the wrong direction ─────────
test('re-enabling restores the extension CTA (flag is not one-way)', () => {
  setStudioHostCapabilities({ redditAttach: false });
  render('capture', CAPTURE);
  setStudioHostCapabilities({ redditAttach: true });
  const html = render('capture', CAPTURE);
  assert.match(html, /data-wf-switch-reddit/);
});

rmSync(cacheDir, { recursive: true, force: true });
const total = passed + failures.length;
if (failures.length > 0) {
  console.error(`\n✗ workflow-banner-host: ${failures.length}/${total} failed`);
  process.exit(1);
}
console.log(`\n✓ workflow-banner-host: ${passed}/${total} passed`);
