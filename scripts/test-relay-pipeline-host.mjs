// v6.0 Track D — the relay slice's invariants, as a falsifiable Node suite.
//
//   Run: node scripts/test-relay-pipeline-host.mjs   (or `npm run test:relay-pipeline-host`)
//
// WHY THIS EXISTS
// ---------------
// `demo/design-studio/host/web-pipeline-host.ts` plays background.ts's relay
// slice on the hosted Studio's single-context loopback bus. Host-neutrality
// rule 6 lives here, and every way it can break fails SILENTLY:
//   - re-broadcasting a COMPLETE resolves an already-settled job → a phantom
//     second take, not an error;
//   - re-processing an offscreen-addressed cancel re-enters the same listener on
//     the same page → infinite recursion;
//   - swallowing a post-ACK dispatch failure → the client waits out its 60 s
//     stall timer and blames the wrong layer.
// None of these throw where a human would see them, and `test:host-neutrality`
// cannot catch them (they are behavioural, not a spelling). So they need a real
// behavioural test — this one.
//
// FIDELITY
// --------
// The suite bundles the REAL relay host on the REAL loopback bus (web-runtime.ts)
// and fakes only the offscreen module — the one dependency that would otherwise
// pull the 31 MB engine graph into Node. That means the recursion test actually
// exercises the bus delivering the host's own send back to the host's listener,
// which is the exact condition rule 6b guards against; a hand-rolled bus could
// silently not reproduce it.

import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.cwd());
const cacheDir = join(root, 'node_modules', '.cache', 'relay-slice-test');
rmSync(cacheDir, { recursive: true, force: true });
mkdirSync(cacheDir, { recursive: true });

const abs = (p) => join(root, p).replace(/\\/g, '/');

// ── Fake offscreen module ────────────────────────────────────────────────────
// Mirrors offscreen/main.ts's ROLE only: answer `*_OFFSCREEN` requests
// synchronously and record what it received. Behaviour is test-controlled through
// a global so a single bundle can exercise the happy path and the reject path.
const fakeOffscreenPath = join(cacheDir, 'fake-offscreen.ts');
writeFileSync(
  fakeOffscreenPath,
  `const g = globalThis as any;
g.__offscreen ??= { loads: 0, received: [], ackOk: true };
g.__offscreen.loads += 1; // top-level: counts module EVALUATIONS (ESM guarantees 1)
browser.runtime.onMessage.addListener((message: any, _sender: any, sendResponse: any) => {
  if (!message || typeof message !== 'object' || message.target !== 'offscreen') return;
  g.__offscreen.received.push(message);
  // Real offscreen answers a *_CANCEL by setting a flag, with no response.
  if (typeof message.type === 'string' && message.type.endsWith('-cancel')) return;
  sendResponse({ ok: g.__offscreen.ackOk, jobId: message.jobId });
  return; // handled synchronously, exactly like offscreen/main.ts
});
export {};
`,
);

// ── Test entry: the real host + real bus + the message constants ─────────────
const entryPath = join(cacheDir, 'entry.ts');
writeFileSync(
  entryPath,
  `export { webRuntime, webTabs } from ${JSON.stringify(abs('demo/design-studio/host/web-runtime'))};
export { installWebPipelineHost } from ${JSON.stringify(abs('demo/design-studio/host/web-pipeline-host'))};
export * as MSG from '@/src/messaging/types';
`,
);

// Fake session-transcript IDB so Node can exercise the terminal-persist path
// without a real IndexedDB. Records every save for assertions.
const fakeSessionTranscriptPath = join(cacheDir, 'fake-session-transcript-db.ts');
writeFileSync(
  fakeSessionTranscriptPath,
  `const g = globalThis as any;
g.__sessionTranscriptSaves ??= [];
export async function saveSessionTranscript(result: unknown, jobId?: string, meta?: unknown): Promise<void> {
  g.__sessionTranscriptSaves.push({ result, jobId, meta });
}
export async function loadSessionTranscript(): Promise<null> { return null; }
export async function saveSessionTranscriptEdits(): Promise<void> {}
export async function revertSessionTranscriptEdits(): Promise<void> {}
export async function clearSessionTranscriptStore(): Promise<void> {}
export function sessionTranscriptIsDirty(): boolean { return false; }
export function sessionTranscriptIsConfirmed(): boolean { return false; }
`,
);

// Thin stand-in for the ready-key constant so the host bundle does not pull the
// full user-preferences graph into Node.
const fakeUserPrefsPath = join(cacheDir, 'fake-user-preferences.ts');
writeFileSync(
  fakeUserPrefsPath,
  `export const SESSION_TRANSCRIPT_READY_KEY = 'rvnSessionTranscriptReadyAt' as const;
`,
);

const aliasPlugin = {
  name: 'rvn-relay-test-alias',
  setup(b) {
    // The relay host's dynamic import — swap the engine for the fake.
    b.onResolve({ filter: /^@\/entrypoints\/offscreen\/main$/ }, () => ({ path: fakeOffscreenPath }));
    // Terminal-persist deps: keep the host's real logic, swap storage backends.
    b.onResolve({ filter: /^@\/src\/storage\/session-transcript-db$/ }, () => ({
      path: fakeSessionTranscriptPath,
    }));
    b.onResolve({ filter: /^@\/src\/settings\/user-preferences$/ }, () => ({
      path: fakeUserPrefsPath,
    }));
    // Repo-root `@/` alias, resolved explicitly so the temp entry does not depend
    // on esbuild finding a tsconfig for a file under node_modules/.cache.
    b.onResolve({ filter: /^@\// }, (args) => {
      const rel = args.path.slice(2);
      for (const candidate of [`${rel}.ts`, `${rel}.tsx`, join(rel, 'index.ts')]) {
        const full = resolve(root, candidate);
        if (existsSync(full)) return { path: full };
      }
      return { path: resolve(root, rel) };
    });
  },
};

const bundlePath = join(cacheDir, 'bundle.mjs');
await build({
  entryPoints: [entryPath],
  absWorkingDir: root,
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundlePath,
  logLevel: 'silent',
  // web-runtime.ts's webGetURL touches import.meta.env.BASE_URL; never called
  // here, but define it so the reference cannot throw.
  define: { 'import.meta.env.BASE_URL': '"/"' },
  plugins: [aliasPlugin],
});

// ── Environment the shim expects ─────────────────────────────────────────────
// web-runtime.ts stamps a synthetic sender { url: location.href } on every send.
globalThis.location = { href: 'https://host.example/base/', origin: 'https://host.example' };

const { webRuntime, webTabs, installWebPipelineHost, MSG } = await import(
  pathToFileURL(bundlePath).href
);

// Minimal storage.local for the terminal ready-key write. The real hosted surface
// uses web-storage.ts; the host under test only needs set/get of one key.
const storageLocal = new Map();
const storageLocalApi = {
  async get(keys) {
    const out = {};
    const list = Array.isArray(keys) ? keys : keys == null ? [...storageLocal.keys()] : [keys];
    for (const k of list) {
      if (storageLocal.has(k)) out[k] = storageLocal.get(k);
    }
    return out;
  },
  async set(items) {
    for (const [k, v] of Object.entries(items)) storageLocal.set(k, v);
  },
  async remove(keys) {
    for (const k of Array.isArray(keys) ? keys : [keys]) storageLocal.delete(k);
  },
  async clear() {
    storageLocal.clear();
  },
};

globalThis.browser = {
  runtime: webRuntime,
  tabs: webTabs,
  storage: { local: storageLocalApi },
};

// Pre-seed the offscreen record so assertions can read it before the fake module
// is lazily imported on the first dispatch. The fake's `??=` keeps this object and
// only its `loads += 1` runs on evaluation, so the single-evaluation check holds.
globalThis.__offscreen = { loads: 0, received: [], ackOk: true };
globalThis.__sessionTranscriptSaves = [];

// A passive "Studio" observer: it never responds (returns undefined), so it never
// wins the response race — it only counts what the bus delivers. A re-broadcast
// shows up here as a second delivery of the same message.
const studioSeen = [];
webRuntime.onMessage.addListener((message) => {
  studioSeen.push(message);
  return;
});

installWebPipelineHost();

// ── Harness ──────────────────────────────────────────────────────────────────
let passed = 0;
const failures = [];
const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle(n = 4) {
  for (let i = 0; i < n; i += 1) await tick();
}
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  ✗ ${name}\n      ${error.message.split('\n').join('\n      ')}`);
  }
}
const off = () => globalThis.__offscreen;
const resetReceived = () => {
  off().received.length = 0;
};
// Valid base64 length for N bytes (content is never decoded by the validators).
const payload = (bytes) => 'A'.repeat(Math.ceil(bytes / 3) * 4);

// ── A. START → ACK → *_OFFSCREEN dispatch, all three families ────────────────
await test('transcode START → ACK ok, then one *_OFFSCREEN dispatch with the payload', async () => {
  resetReceived();
  const jobId = 'tc-happy';
  const voiceEffect = { kind: 'pitch', amount: 3 };
  const ack = await browser.runtime.sendMessage({
    type: MSG.MSG_TRANSCODE_START,
    jobId,
    webmBase64: payload(300),
    webmByteLength: 300,
    voiceEffect,
  });
  assert.equal(ack.type, MSG.MSG_TRANSCODE_ACK);
  assert.equal(ack.ok, true);
  assert.equal(ack.jobId, jobId);
  await settle();
  const sent = off().received.filter((m) => m.type === MSG.MSG_TRANSCODE_OFFSCREEN);
  assert.equal(sent.length, 1, 'expected exactly one offscreen dispatch');
  assert.equal(sent[0].target, 'offscreen');
  assert.equal(sent[0].jobId, jobId);
  assert.equal(sent[0].webmByteLength, 300);
  assert.ok(sent[0].webmBase64, 'payload forwarded');
  assert.deepEqual(sent[0].voiceEffect, voiceEffect, 'voiceEffect forwarded verbatim');
});

await test('burn-in START → ACK ok, then one *_OFFSCREEN dispatch with subtitle fields', async () => {
  resetReceived();
  const jobId = 'bi-happy';
  const ack = await browser.runtime.sendMessage({
    type: MSG.MSG_BURNIN_START,
    jobId,
    mp4Base64: payload(400),
    mp4ByteLength: 400,
    segmentsJson: '[{"t":0}]',
    styleJson: '{"font":"x"}',
    videoDurationSeconds: 12,
    themeBarColor: '#123456',
  });
  assert.equal(ack.type, MSG.MSG_BURNIN_ACK);
  assert.equal(ack.ok, true);
  await settle();
  const sent = off().received.filter((m) => m.type === MSG.MSG_BURNIN_OFFSCREEN);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].target, 'offscreen');
  assert.equal(sent[0].segmentsJson, '[{"t":0}]');
  assert.equal(sent[0].styleJson, '{"font":"x"}');
  assert.equal(sent[0].themeBarColor, '#123456');
});

await test('transcribe START → ACK ok, then one *_OFFSCREEN dispatch', async () => {
  resetReceived();
  const jobId = 'ts-happy';
  const ack = await browser.runtime.sendMessage({
    type: MSG.MSG_TRANSCRIBE_START,
    jobId,
    webmBase64: payload(500),
    webmByteLength: 500,
    language: 'en',
  });
  assert.equal(ack.type, MSG.MSG_TRANSCRIBE_ACK);
  assert.equal(ack.ok, true);
  await settle();
  const sent = off().received.filter((m) => m.type === MSG.MSG_TRANSCRIBE_OFFSCREEN);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].language, 'en');
});

// ── B. Validation failure → ACK ok:false with the exact message, NO dispatch ──
await test('missing jobId → ACK ok:false "Transcode request missing jobId.", no dispatch', async () => {
  resetReceived();
  const ack = await browser.runtime.sendMessage({
    type: MSG.MSG_TRANSCODE_START,
    webmBase64: payload(300),
    webmByteLength: 300,
  });
  assert.equal(ack.ok, false);
  assert.equal(ack.error, 'Transcode request missing jobId.');
  await settle();
  assert.equal(off().received.length, 0, 'a rejected START must not reach offscreen');
});

await test('truncated base64 → ACK ok:false with the per-family "at relay" message', async () => {
  resetReceived();
  const ack = await browser.runtime.sendMessage({
    type: MSG.MSG_TRANSCODE_START,
    jobId: 'tc-bad',
    webmBase64: 'AAAA',
    webmByteLength: 999999,
  });
  assert.equal(ack.ok, false);
  assert.match(ack.error, /WebM base64 length mismatch at relay \(bytes=999999, chars=4/);
  await settle();
  assert.equal(off().received.length, 0);
});

await test('burn-in missing segments → ACK ok:false with the burn-in-relay message', async () => {
  resetReceived();
  const ack = await browser.runtime.sendMessage({
    type: MSG.MSG_BURNIN_START,
    jobId: 'bi-bad',
    mp4Base64: payload(400),
    mp4ByteLength: 400,
    segmentsJson: '   ',
    styleJson: '{"font":"x"}',
  });
  assert.equal(ack.ok, false);
  assert.equal(ack.error, 'Subtitle segments JSON missing at burn-in relay.');
  await settle();
  assert.equal(off().received.length, 0);
});

// ── C. Rule 6a — PROGRESS / COMPLETE are never re-broadcast ───────────────────
await test('a COMPLETE seen by the relay is NOT re-broadcast (phantom-take guard)', async () => {
  const before = studioSeen.length;
  await browser.runtime.sendMessage({ type: MSG.MSG_TRANSCODE_COMPLETE, jobId: 'x', ok: true });
  await settle();
  const completes = studioSeen
    .slice(before)
    .filter((m) => m.type === MSG.MSG_TRANSCODE_COMPLETE);
  assert.equal(completes.length, 1, 'exactly one delivery — the send itself; no re-broadcast');
});

await test('a PROGRESS seen by the relay is NOT re-broadcast', async () => {
  const before = studioSeen.length;
  await browser.runtime.sendMessage({
    type: MSG.MSG_TRANSCODE_PROGRESS,
    jobId: 'x',
    ratio: 0.5,
    stage: 'transcoding',
  });
  await settle();
  const progress = studioSeen
    .slice(before)
    .filter((m) => m.type === MSG.MSG_TRANSCODE_PROGRESS);
  assert.equal(progress.length, 1);
});

// ── D. Rule 6b — an offscreen-addressed message is ignored (no recursion) ─────
// The load-bearing case: a cancel already addressed to offscreen. Without the
// isOffscreenTarget guard the relay would match MSG_*_CANCEL, re-send it to
// offscreen, receive its own send back on the same page, and recurse until the
// stack overflows — synchronously, so this test would throw before asserting.
await test('offscreen-addressed cancel is ignored — no infinite recursion', async () => {
  const before = studioSeen.length;
  await browser.runtime.sendMessage({
    type: MSG.MSG_TRANSCODE_CANCEL,
    target: 'offscreen',
    jobId: 'x',
  });
  await settle();
  const cancels = studioSeen.slice(before).filter((m) => m.type === MSG.MSG_TRANSCODE_CANCEL);
  assert.equal(cancels.length, 1, 'the relay must not re-relay its own offscreen-addressed cancel');
});

// ── E. Cancel relaying — including the burn-in shared-flag quirk ──────────────
await test('transcode CANCEL relays a transcode-cancel to offscreen', async () => {
  resetReceived();
  await browser.runtime.sendMessage({ type: MSG.MSG_TRANSCODE_CANCEL, jobId: 'c1' });
  await settle();
  assert.equal(off().received.length, 1);
  assert.equal(off().received[0].type, MSG.MSG_TRANSCODE_CANCEL);
  assert.equal(off().received[0].target, 'offscreen');
  assert.equal(off().received[0].jobId, 'c1');
});

await test('burn-in CANCEL relays a TRANSCODE-cancel (shared offscreen flag)', async () => {
  resetReceived();
  await browser.runtime.sendMessage({ type: MSG.MSG_BURNIN_CANCEL, jobId: 'c2' });
  await settle();
  assert.equal(off().received.length, 1);
  assert.equal(
    off().received[0].type,
    MSG.MSG_TRANSCODE_CANCEL,
    'burn-in shares the transcode cancel flag — must NOT send a burnin-cancel',
  );
  assert.equal(off().received[0].jobId, 'c2');
});

await test('transcribe CANCEL relays a transcribe-cancel to offscreen', async () => {
  resetReceived();
  await browser.runtime.sendMessage({ type: MSG.MSG_TRANSCRIBE_CANCEL, jobId: 'c3' });
  await settle();
  assert.equal(off().received.length, 1);
  assert.equal(off().received[0].type, MSG.MSG_TRANSCRIBE_CANCEL);
});

await test('a CANCEL with no jobId relays nothing', async () => {
  resetReceived();
  await browser.runtime.sendMessage({ type: MSG.MSG_TRANSCODE_CANCEL });
  await settle();
  assert.equal(off().received.length, 0);
});

// ── F2. Terminal transcribe persistence (BUG: Vosk applied but UI stays Pending) ─
// Rule 6 forbids re-broadcasting COMPLETE, but background's IDB + ready-key side
// effect is still required: the Studio panel loads captions from that path, not
// from the forkTranscribe in-memory result.
await test('transcribe COMPLETE after START persists IDB snapshot + ready key once (no re-broadcast)', async () => {
  globalThis.__sessionTranscriptSaves.length = 0;
  storageLocal.clear();
  resetReceived();
  const jobId = 'ts-persist';
  const transcript = {
    text: 'hello world',
    segments: [{ text: 'hello world', start: 0, end: 1.2 }],
    source: 'vosk',
  };
  const ack = await browser.runtime.sendMessage({
    type: MSG.MSG_TRANSCRIBE_START,
    jobId,
    webmBase64: payload(500),
    webmByteLength: 500,
    durationSeconds: 4,
    language: 'en',
  });
  assert.equal(ack.ok, true);
  await settle();

  const before = studioSeen.length;
  await browser.runtime.sendMessage({
    type: MSG.MSG_TRANSCRIBE_COMPLETE,
    jobId,
    ok: true,
    transcriptJson: JSON.stringify(transcript),
  });
  await settle(8);

  const completes = studioSeen
    .slice(before)
    .filter((m) => m.type === MSG.MSG_TRANSCRIBE_COMPLETE && m.jobId === jobId);
  assert.equal(completes.length, 1, 'exactly one COMPLETE delivery — no re-broadcast');

  assert.equal(globalThis.__sessionTranscriptSaves.length, 1, 'one terminal IDB save');
  assert.equal(globalThis.__sessionTranscriptSaves[0].jobId, jobId);
  assert.equal(globalThis.__sessionTranscriptSaves[0].result.text, 'hello world');
  assert.equal(
    typeof storageLocal.get('rvnSessionTranscriptReadyAt'),
    'number',
    'ready key must fire so subtitle-controls reloads the snapshot',
  );
});

await test('stale transcribe COMPLETE (no prior START) does not persist', async () => {
  globalThis.__sessionTranscriptSaves.length = 0;
  storageLocal.clear();
  const before = studioSeen.length;
  await browser.runtime.sendMessage({
    type: MSG.MSG_TRANSCRIBE_COMPLETE,
    jobId: 'ts-stale',
    ok: true,
    transcriptJson: JSON.stringify({ text: 'nope', segments: [], source: 'vosk' }),
  });
  await settle(4);
  assert.equal(globalThis.__sessionTranscriptSaves.length, 0);
  // Still delivered once on the bus (send itself); host must not re-broadcast.
  const completes = studioSeen
    .slice(before)
    .filter((m) => m.type === MSG.MSG_TRANSCRIBE_COMPLETE && m.jobId === 'ts-stale');
  assert.equal(completes.length, 1);
  assert.equal(storageLocal.has('rvnSessionTranscriptReadyAt'), false);
});

await test('failed transcribe COMPLETE persists a timed scaffold (graceful failure)', async () => {
  globalThis.__sessionTranscriptSaves.length = 0;
  storageLocal.clear();
  resetReceived();
  const jobId = 'ts-scaffold';
  const ack = await browser.runtime.sendMessage({
    type: MSG.MSG_TRANSCRIBE_START,
    jobId,
    webmBase64: payload(500),
    webmByteLength: 500,
    durationSeconds: 6,
    language: 'en',
  });
  assert.equal(ack.ok, true);
  await settle();

  await browser.runtime.sendMessage({
    type: MSG.MSG_TRANSCRIBE_COMPLETE,
    jobId,
    ok: false,
    error: 'no speech detected',
  });
  await settle(8);

  assert.equal(globalThis.__sessionTranscriptSaves.length, 1);
  const save = globalThis.__sessionTranscriptSaves[0];
  assert.equal(save.jobId, jobId);
  assert.ok(save.meta?.isScaffolded === true, 'scaffold flag required for graceful UI');
  assert.ok(Array.isArray(save.result?.segments) && save.result.segments.length > 0);
  assert.equal(typeof storageLocal.get('rvnSessionTranscriptReadyAt'), 'number');
});

// ── F. Post-ACK dispatch failure is SPOKEN as a terminal COMPLETE ─────────────
await test('offscreen rejecting the job → terminal COMPLETE ok:false (not silent)', async () => {
  off().ackOk = false;
  const before = studioSeen.length;
  const jobId = 'tc-reject';
  const ack = await browser.runtime.sendMessage({
    type: MSG.MSG_TRANSCODE_START,
    jobId,
    webmBase64: payload(300),
    webmByteLength: 300,
  });
  assert.equal(ack.ok, true, 'ACK is sent before dispatch, so it still succeeds');
  await settle(8);
  const completes = studioSeen
    .slice(before)
    .filter((m) => m.type === MSG.MSG_TRANSCODE_COMPLETE && m.jobId === jobId);
  assert.equal(completes.length, 1, 'the failure must be spoken as one COMPLETE');
  assert.equal(completes[0].ok, false);
  assert.match(completes[0].error, /media engine did not accept/);
  off().ackOk = true;
});

// ── G. Two sequential jobs each dispatch once; offscreen evaluated once ───────
await test('two sequential jobs each dispatch exactly once; offscreen evaluated once', async () => {
  resetReceived();
  await browser.runtime.sendMessage({
    type: MSG.MSG_TRANSCODE_START,
    jobId: 'seq-1',
    webmBase64: payload(300),
    webmByteLength: 300,
  });
  await settle();
  await browser.runtime.sendMessage({
    type: MSG.MSG_TRANSCODE_START,
    jobId: 'seq-2',
    webmBase64: payload(300),
    webmByteLength: 300,
  });
  await settle();
  const sent = off().received.filter((m) => m.type === MSG.MSG_TRANSCODE_OFFSCREEN);
  assert.equal(sent.length, 2, 'no doubled dispatch');
  assert.equal(new Set(sent.map((m) => m.jobId)).size, 2);
  // ESM caches the module, so a single evaluation is guaranteed regardless of the
  // promise memoization; this asserts the fake did not get registered twice (which
  // would double every broadcast).
  assert.equal(off().loads, 1, 'offscreen module evaluated exactly once');
});

// ── Report ────────────────────────────────────────────────────────────────────
rmSync(cacheDir, { recursive: true, force: true });
const total = passed + failures.length;
if (failures.length > 0) {
  console.error(`\n✗ relay-pipeline-host: ${failures.length}/${total} failed\n`);
  process.exit(1);
}
console.log(`\n✓ relay-pipeline-host: ${passed}/${total} passed`);
