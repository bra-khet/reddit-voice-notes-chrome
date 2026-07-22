// v6.0 Track D — mechanical guard for the host-neutrality rules.
//
//   Run: node scripts/test-host-neutrality.mjs
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

import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const ENTRY = 'demo/design-studio/main.ts';

let checks = 0;
const failures = [];

function check(label, condition, detail) {
  checks += 1;
  if (!condition) failures.push(detail ? `${label}\n      ${detail}` : label);
}

// ── 1. Resolve the hosted Studio's real module graph ────────────────────────

/*
 * Externalize bare specifiers. We only audit first-party files, and not walking
 * into node_modules keeps this fast and immune to demo/ vs root dependency drift.
 * `@/…` is NOT a package — it is the repo-root alias — so it must fall through to
 * esbuild's normal tsconfig-paths resolution.
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
  plugins: [externalizeBare],
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
