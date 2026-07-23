// v6.0 Track D — mechanical guard for the host-neutrality rules.
//
//   Run: node scripts/test-host-neutrality.mjs   (or `npm run test:host-neutrality`)
//   Also runs automatically as the first step of the demo build (demo/package.json),
//   so a host-classification regression fails `cd demo && npm run build` — and the
//   Pages deploy — before tsc or vite. Reads its root from this file's location, and
//   resolves esbuild from demo/node_modules, so it works from either cwd and in CI
//   (where only the demo's dependencies are installed).
//
// WHY THIS EXISTS
// ---------------
// Phases 0 and 1 each cost a real bug to the same root cause: shared code that
// reasons about its own host. `user-prefs-db.ts` read https as "content script";
// `background-loader.ts` held the mirror-image protocol test; both artifact relays
// assumed a background service worker exists. Every one of those was caught by a
// human noticing a symptom in a browser, and two of the three failed SILENTLY.
//
// The rules that came out of them live in docs/architecture/extension-points.md as
// prose. Prose does not fail a build. This does.
//
// THE SCOPING TRICK
// -----------------
// The rules are not universal — `entrypoints/popup/main.ts` may hold a module-scope
// `browser.runtime.getURL()` forever, because the popup only ever runs inside the
// extension. What matters is the subset of shared source the HOSTED Studio actually
// loads, and that subset is not a directory: it is a module graph, it already spans
// src/ and entrypoints/, and Phase 2 will widen it.
//
// So resolve it rather than guess it: bundle demo/design-studio/main.ts with esbuild
// and read the metafile. Every first-party input in that graph is in scope; nothing
// else is. The guard therefore widens by itself as the hosted surface grows, which
// is the property a hand-maintained path list would not have.
//
// WHAT THIS CANNOT CATCH
// ----------------------
// Rule 7 — "a shim that faithfully RESOLVES can be worse than one that throws" —
// is not a spelling. The artifact relays contained no protocol test and no
// extension URL; they simply assumed a background service worker would answer, and
// nothing in the source says so. That class needs a behavioural test against the
// shim, not a lint. Treating a green run here as "host-neutral" would rebuild the
// same false confidence that let those recordings vanish in silence.

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Repo root, derived from this file's own location — NOT process.cwd(). The demo
 * build invokes this guard as `node ../scripts/test-host-neutrality.mjs` with cwd
 * set to demo/, so a cwd-relative root would resolve every path one level too deep.
 * scripts/ lives directly under the repo root, so `..` is the root from anywhere.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = 'demo/design-studio/main.ts';

/*
 * Resolve esbuild from demo/node_modules first. This guard is wired into the demo's
 * build (demo/package.json), and CI installs ONLY demo's dependencies — root deps
 * are never `npm ci`'d on the Pages runner. The demo is an esbuild/vite project, so
 * its tree always has esbuild; the root tree only has it when someone ran a full
 * `npm install` locally. Fall back to root, then to bare resolution, so a plain
 * `node scripts/test-host-neutrality.mjs` at the root still works during dev.
 */
function loadEsbuild() {
  for (const base of ['demo/package.json', 'package.json']) {
    try {
      return createRequire(resolve(root, base))('esbuild');
    } catch {
      // try the next candidate
    }
  }
  return createRequire(import.meta.url)('esbuild');
}

const { build } = loadEsbuild();

let checks = 0;
const failures = [];

function check(label, condition, detail) {
  checks += 1;
  if (!condition) failures.push(detail ? `${label}\n      ${detail}` : label);
}

// ── 1. Resolve the hosted Studio's real module graph ────────────────────────

/*
 * Resolve `@/…` to the repo root. Do NOT rely on root tsconfig.json paths:
 * that file only `extends` `.wxt/tsconfig.json`, which is gitignored and only
 * appears after a local WXT prepare. The Pages CI job installs demo deps only
 * and never runs WXT, so esbuild's default tsconfig walk finds a broken extend
 * and every `@/src/…` import dies with "Could not resolve" (63×) before any
 * neutrality rule runs. demo/tsconfig.json and demo/vite.config.ts already
 * define the same alias for the real build; this plugin keeps the guard in
 * lockstep without needing .wxt.
 *
 * Only return real *files*. `existsSync` is true for directories, and handing
 * esbuild a directory path yields Windows "Incorrect function" / Unix EISDIR
 * when it tries to read the module source. Prefer `foo.ts` then `foo/index.ts`.
 */
const FILE_CANDIDATES = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '/index.ts', '/index.tsx', '/index.js'];

function resolveAtAlias(specifier) {
  const base = resolve(root, specifier.slice(2)); // '@/src/x' → <root>/src/x
  try {
    if (statSync(base).isFile()) return base;
  } catch {
    // not a file (or missing) — try extensions
  }
  for (const ext of FILE_CANDIDATES) {
    const candidate = base + ext;
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // try next
    }
  }
  return undefined;
}

const aliasAt = {
  name: 'alias-at-repo-root',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^@\// }, (args) => {
      const resolved = resolveAtAlias(args.path);
      return resolved ? { path: resolved } : undefined;
    });
  },
};

/*
 * Externalize bare specifiers. We only audit first-party files, and not walking
 * into node_modules keeps this fast and immune to demo/ vs root dependency drift.
 * `@/…` is handled by aliasAt above — not a package.
 */
const externalizeBare = {
  name: 'externalize-bare',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith('@/')) return undefined;
      return { path: args.path, external: true };
    });
  },
};

const result = await build({
  entryPoints: [ENTRY],
  absWorkingDir: root,
  bundle: true,
  write: false,
  metafile: true,
  format: 'esm',
  platform: 'browser',
  logLevel: 'silent',
  // BUG FIX: hosted-studio Pages deploy host-neutrality guard
  // Fix: do not walk root tsconfig → .wxt (absent in CI). Point at demo's
  // committed tsconfig so path metadata is available without a WXT prepare;
  // the aliasAt plugin is the real `@/` resolver and does not need it.
  // Sync: demo/tsconfig.json paths "@/*"→"../*", demo/vite.config.ts alias '@'
  tsconfig: resolve(root, 'demo/tsconfig.json'),
  plugins: [aliasAt, externalizeBare],
  /*
   * Stylesheets and binary assets are emptied rather than parsed. We audit CSS
   * separately (demo/vite.config.ts already fails the BUILD on a surviving
   * root-absolute url()), and parsing them here would make esbuild try to resolve
   * `/assets/…` as a real file and abort before any rule ran.
   */
  loader: {
    '.css': 'empty',
    '.svg': 'empty',
    '.png': 'empty',
    '.jpg': 'empty',
    '.woff2': 'empty',
    '.ttf': 'empty',
  },
});

const hostedFiles = Object.keys(result.metafile.inputs)
  .filter((input) => input.startsWith('src/') || input.startsWith('entrypoints/'))
  .sort();

check(
  'hosted module graph resolves',
  hostedFiles.length > 50,
  `only ${hostedFiles.length} first-party inputs — the bundle probably failed to traverse`,
);

/*
 * Guard the guard. If Phase 1's in-page pipeline ever stops being reachable from
 * the Studio entry, every rule below would still "pass" — against a graph that no
 * longer contains the code the rules exist to police.
 */
for (const anchor of [
  'src/utils/host-origin.ts',
  'src/storage/artifact-commit.ts',
  'entrypoints/offscreen/main.ts',
]) {
  check(`graph contains ${anchor}`, hostedFiles.includes(anchor));
}

// ── 2. Strip comments so a rule cannot fire on its own documentation ────────

/*
 * Deliberately small: line comments, block comments, and the three string forms.
 * Template-literal `${…}` interpolations are treated as opaque string content,
 * which is wrong in general and harmless here — nobody writes `location.protocol`
 * inside an interpolation. A regex-literal containing a quote would also confuse
 * it; none exist in this tree. Comments become spaces so line numbers survive.
 */
function stripComments(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === '//') {
      while (i < source.length && source[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (two === '/*') {
      while (i < source.length && source.slice(i, i + 2) !== '*/') {
        out += source[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      out += '  ';
      i += 2;
      continue;
    }
    const quote = source[i];
    if (quote === '"' || quote === "'" || quote === '`') {
      out += quote;
      i += 1;
      while (i < source.length) {
        if (source[i] === '\\') {
          out += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += source[i];
        if (source[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    out += source[i];
    i += 1;
  }
  return out;
}

function linesOf(code) {
  return code.split('\n').map((text, index) => ({ line: index + 1, text }));
}

// ── 3. The rules, applied to exactly the hosted graph ───────────────────────

const RULE_1_PROTOCOL = /\blocation\s*\.\s*protocol\b/;
const RULE_1_SCHEME = /['"`](chrome|moz)-extension:/;
const RULE_2_ROOT_ABSOLUTE = /['"`]\/(assets|ffmpeg|fonts|backgrounds|icon)\//;

/*
 * Rule 3 is about EVALUATION TIME, not spelling: `browser` is installed by a
 * side-effect import, so a module-scope `const x = browser.runtime.getURL(...)`
 * in shared source runs before the shim exists. An arrow or function initializer
 * is fine — it defers. Heuristic: on a top-level declaration, flag `browser.`
 * only when it appears before any `=>` or `function` on the same line. Single-line
 * only; a multi-line module-scope initializer would slip through.
 */
const RULE_3_DECL = /^(export\s+)?(const|let|var)\s+[\w$]+[^=]*=(?<init>.*)$/;

function ruleThreeViolation(text) {
  const match = RULE_3_DECL.exec(text);
  if (!match?.groups?.init) return false;
  const init = match.groups.init;
  const browserAt = init.search(/\bbrowser\s*\./);
  if (browserAt === -1) return false;
  const deferAt = init.search(/=>|\bfunction\b/);
  return deferAt === -1 || browserAt < deferAt;
}

const RULES = [
  {
    id: 'rule 1',
    label: 'no host classification by protocol literal',
    test: (text) => RULE_1_PROTOCOL.test(text) || RULE_1_SCHEME.test(text),
    hint: 'use src/utils/host-origin.ts → isOwnStorageOrigin(), or compare against browser.runtime.getURL("") origin',
  },
  {
    id: 'rule 2',
    label: 'no root-absolute packaged-asset literal',
    test: (text) => RULE_2_ROOT_ABSOLUTE.test(text),
    hint: 'address packaged assets through browser.runtime.getURL()',
  },
  {
    id: 'rule 3',
    label: 'no module-scope browser.* evaluation',
    test: ruleThreeViolation,
    hint: 'move it into a function body — the shim is installed by a side-effect import',
  },
];

/*
 * Line rules apply to TypeScript only. In a stylesheet `url('/assets/…')` is the
 * CORRECT spelling — Vite rewrites it to the deploy base at build time — and it is
 * already guarded there: demo/vite.config.ts fails the build on any root-absolute
 * asset URL that survives into the output. Auditing CSS here would fail the four
 * legitimate font/slider references and teach the wrong lesson.
 */
const hostedSource = hostedFiles.filter((file) => file.endsWith('.ts'));

const hits = [];
for (const file of hostedSource) {
  const code = stripComments(readFileSync(resolve(root, file), 'utf8'));
  for (const { line, text } of linesOf(code)) {
    for (const rule of RULES) {
      if (rule.test(text)) hits.push({ rule, file, line, text: text.trim() });
    }
  }
}

for (const rule of RULES) {
  const ruleHits = ruleHitsFor(rule);
  check(
    `${rule.id} — ${rule.label}`,
    ruleHits.length === 0,
    ruleHits.map((hit) => `${hit.file}:${hit.line}  ${hit.text}\n      → ${rule.hint}`).join('\n      '),
  );
}

function ruleHitsFor(rule) {
  return hits.filter((hit) => hit.rule === rule);
}

// ── 4. Rule 8 — packaged multi-file assets are vendored WHOLE ───────────────

/*
 * The mirror scripts name their trees in a literal. That literal is the thing that
 * goes stale: add public/assets/overlays/ for a Phase 2 visual and the extension
 * finds it while the hosted Studio 404s — at runtime, on Pages, silently under
 * `vite preview` (missing files answer 200 text/html). Compare the declaration
 * against the real packaged tree instead of trusting either.
 */
const packagedAssets = resolve(root, 'public/assets');
if (existsSync(packagedAssets)) {
  const packagedTrees = readdirSync(packagedAssets, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const mirrorScript = readFileSync(resolve(root, 'demo/scripts/copy-studio-assets.mjs'), 'utf8');
  const declared = /const trees = \[(?<list>[^\]]*)\]/.exec(mirrorScript)?.groups?.list ?? '';
  const mirroredTrees = [...declared.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]);

  const missing = packagedTrees.filter((tree) => !mirroredTrees.includes(tree));
  check(
    'rule 8 — every packaged asset tree is mirrored into demo/public/assets',
    missing.length === 0,
    `not vendored: ${missing.join(', ')} — add to demo/scripts/copy-studio-assets.mjs`,
  );
} else {
  check('public/assets exists', false, 'packaged asset tree missing');
}

/*
 * ffmpeg is the paid-for case: esm/worker.js is a MODULE worker whose siblings are
 * fetched at runtime, so a file-by-file copy passes review and dies in the browser.
 * Assert the whole-tree copy survives, in both mirror scripts.
 */
for (const script of ['demo/scripts/copy-ffmpeg-core.mjs', 'scripts/copy-ffmpeg-core.mjs']) {
  const path = resolve(root, script);
  if (!existsSync(path)) continue;
  const source = readFileSync(path, 'utf8');
  check(
    `rule 8 — ${script} vendors the ffmpeg esm/ tree whole`,
    /copyDirRecursive\(/.test(source) && /esm/.test(source),
    'a per-file copy leaves the module worker without its sibling imports',
  );
}

/*
 * Vosk (Phase 4) is the same shape as ffmpeg: vosk-sandbox.html loads
 * vosk-sandbox.js, whose worker fetches vosk/model.tar.gz — three siblings the
 * extension serves from public/ and the hosted Studio must serve from demo/public/.
 * A missing one 404s to SPA HTML under vite preview and surfaces only as "Vosk
 * sandbox failed to become ready" (roadmap H-2, the very failure Phase 4 fixes).
 * Assert the demo vendors all three, and that the fragile base64 worker patch is
 * SHARED with the extension rather than a second copy that drifts on a version bump.
 */
const voskDemoBuild = 'demo/scripts/build-vosk-sandbox.mjs';
const voskDemoFetch = 'demo/scripts/fetch-vosk-model.mjs';

check(
  `rule 8 — ${voskDemoBuild} builds vosk-sandbox.js + copies vosk-sandbox.html`,
  existsSync(resolve(root, voskDemoBuild)) &&
    /buildVoskSandbox\(/.test(readFileSync(resolve(root, voskDemoBuild), 'utf8')) &&
    /vosk-sandbox\.html/.test(readFileSync(resolve(root, voskDemoBuild), 'utf8')),
  'demo must build vosk-sandbox.js from source and copy the vosk-sandbox.html sibling',
);

check(
  `rule 8 — ${voskDemoFetch} vendors vosk/model.tar.gz`,
  existsSync(resolve(root, voskDemoFetch)) &&
    /model\.tar\.gz/.test(readFileSync(resolve(root, voskDemoFetch), 'utf8')),
  'demo must vendor the Vosk model alongside the sandbox',
);

check(
  'rule 8 — demo `vendor` runs vendor:vosk',
  /"vendor"\s*:\s*"[^"]*vendor:vosk/.test(readFileSync(resolve(root, 'demo/package.json'), 'utf8')),
  'add `npm run vendor:vosk` to the demo `vendor` script so CI produces the assets',
);

for (const script of ['scripts/build-vosk-sandbox.mjs', voskDemoBuild]) {
  const path = resolve(root, script);
  if (!existsSync(path)) continue;
  check(
    `rule 8 — ${script} uses the shared vosk sandbox builder`,
    /buildVoskSandbox/.test(readFileSync(path, 'utf8')),
    'the base64 worker patch must live once in scripts/vosk-sandbox-build.mjs, not be re-copied',
  );
}

// ── Report ──────────────────────────────────────────────────────────────────

console.log(
  `\nhost-neutrality: audited ${hostedSource.length} shared .ts files ` +
    `(${hostedFiles.length} first-party inputs) reachable from ${ENTRY}`,
);

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length}/${checks} checks failed:\n`);
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error('');
  process.exit(1);
}

console.log(`✓ ${checks}/${checks} checks passed\n`);
