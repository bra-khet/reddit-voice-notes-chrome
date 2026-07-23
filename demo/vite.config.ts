import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';

/*
 * Voice Lab — Vite config (Phase 0).
 *
 * Self-contained mini-project; 100% separate from the WXT extension at the repo
 * root. Builds the orientation hub (index.html) + the studio (studio/index.html)
 * to ./dist, which GitHub Actions uploads as the Pages artifact on push to main
 * (see .github/workflows/deploy-demo.yml — no gh-pages branch, no manual publish).
 */
const root = import.meta.dirname;

const BASE = '/reddit-voice-notes-chrome/';

/*
 * Fail the build on any root-absolute asset URL that survived into emitted CSS.
 *
 * The extension's stylesheets legitimately write `url('/assets/fonts/…')` — in an
 * extension, a leading slash IS the package root. On a PROJECT Pages site it is
 * the user site root, so such a URL resolves to https://<user>.github.io/assets/…
 * and 404s: no display font, no slider chrome.
 *
 * Vite already fixes this FOR FREE, but only under a condition that is easy to
 * break and impossible to see: it rewrites a root-absolute URL to `<base>/…` only
 * when the file actually exists under publicDir. So the prefixing silently
 * depends on scripts/copy-studio-assets.mjs having mirrored that asset. Miss one,
 * and Vite downgrades to a build WARNING, emits the URL unchanged, and the page
 * breaks on the real deploy while looking perfect locally — doubly so because
 * `vite preview` answers missing files with 200 text/html rather than 404.
 *
 * So this does not rewrite anything; it turns that warning into an error.
 *
 * It also covers JS, where the same mistake has a second form and no warning at
 * all: a hand-written `"/assets/…"` string literal dropped into an <img src>.
 * Track D Phase 0 found three of those in background-layout-controls.ts; they
 * looked correct in the extension (a leading slash IS the extension root) and
 * 404'd everywhere else. The rule for shared source is that packaged assets are
 * addressed through `browser.runtime.getURL`, never by manual prefixing.
 */
function assertNoRootAbsoluteAssetUrls(): Plugin {
  const IN_CSS = /url\(\s*['"]?\/assets\/[^)]*/g;
  // Quote-anchored so Vite's OWN emitted "/reddit-voice-notes-chrome/assets/…"
  // strings — which merely contain the same substring — are not flagged.
  const IN_JS = /['"`]\/assets\/[^'"`]*/g;

  return {
    name: 'rvn-assert-no-root-absolute-asset-urls',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const offenders: string[] = [];
      for (const file of Object.values(bundle)) {
        if (file.type === 'asset' && file.fileName.endsWith('.css')) {
          const css =
            typeof file.source === 'string' ? file.source : new TextDecoder().decode(file.source);
          for (const match of css.match(IN_CSS) ?? []) offenders.push(`${file.fileName}: ${match}`);
        } else if (file.type === 'chunk') {
          for (const match of file.code.match(IN_JS) ?? []) {
            offenders.push(`${file.fileName}: ${match}`);
          }
        }
      }
      if (offenders.length > 0) {
        this.error(
          `Root-absolute asset URL(s) will 404 under the Pages base path.\n` +
            `In CSS: mirror the asset in scripts/copy-studio-assets.mjs so Vite resolves it.\n` +
            `In TS: address it through browser.runtime.getURL(), never a "/assets/…" literal.\n  ` +
            offenders.join('\n  '),
        );
      }
    },
  };
}

export default defineConfig({
  plugins: [assertNoRootAbsoluteAssetUrls()],
  // Project Pages serve under /<repo>/, so every absolute asset/route URL is
  // prefixed with this base.
  base: BASE,
  resolve: {
    alias: {
      // CHANGED: "@" now points at the REPO ROOT, not demo/ (Track D Phase 0).
      // WHY: the Voice Lab used to compile verbatim COPIES of the extension's DSP
      // leaves, which had to be re-copied by hand after every upstream change.
      // Pointing the alias one level up makes the demo compile the real src/, so
      // drift is structurally impossible instead of procedurally discouraged — and
      // it is the same mechanism the hosted Design Studio will use to mount the
      // real Studio tree. See docs/v6.0.0-hosted-design-studio.md §3.4.
      //   @  ->  <repo root>   ⇒   "@/src/voice/types"  resolves to  <root>/src/voice/types.ts
      '@': resolve(root, '..'),
      // BUG FIX: Pages CI resolve without root node_modules
      // Fix: shared ../src/* imports bare packages; Rollup walks from the file
      // (repo root), misses demo/node_modules, and fails the build even after tsc
      // is fixed. Same packages as demo/tsconfig.json paths — keep in lockstep.
      // Sync: demo/tsconfig.json paths; demo/package.json dependencies
      mediabunny: resolve(root, 'node_modules/mediabunny'),
      '@ffmpeg/ffmpeg': resolve(root, 'node_modules/@ffmpeg/ffmpeg'),
      '@ffmpeg/util': resolve(root, 'node_modules/@ffmpeg/util'),
    },
  },
  /*
   * BUG FIX: Pages CI build without .wxt/
   * Fix: shared `@/` modules live under repo-root `src/`. Vite's esbuild
   * transform, when `esbuild.tsconfigRaw` is an *object*, still loads each
   * file's nearest tsconfig to merge jsx/target fields — and for those files
   * that is root `tsconfig.json`, which only `extends` gitignored
   * `.wxt/tsconfig.json` (from a local `wxt prepare`). The Pages job installs
   * demo deps only and never runs WXT, so the extend is missing and the build
   * dies with "failed to resolve extends ./.wxt/tsconfig.json".
   *
   * Passing `tsconfigRaw` as a **string** makes Vite skip that load entirely
   * (see transformWithEsbuild in vite). Path aliases stay on `resolve.alias`
   * above; this string is only a valid transform target.
   * Sync: scripts/test-host-neutrality.mjs (aliasAt plugin + demo tsconfig).
   */
  esbuild: {
    tsconfigRaw: JSON.stringify({
      compilerOptions: {
        target: 'ESNext',
        useDefineForClassFields: true,
        module: 'ESNext',
      },
    }),
  },
  // ffmpeg.wasm is only reached via a lazy import('./audio-render'), so without
  // this Vite discovers @ffmpeg/* at first render and re-optimizes deps — a
  // full page reload. Pre-bundling them removes that one reload trigger.
  //
  // KNOWN DEV LIMITATION (deferred): even so, the audition render is unreliable
  // under `vite dev` — the dev server reloads the page (HMR / re-optimization)
  // and that aborts the long (~30 MB) ffmpeg.load(), which has no timeout, so the
  // audition can freeze at "5%". This is DEV-ONLY: production statically bundles
  // ffmpeg + the worker and has no reload mechanism. QA the audition against a
  // build — `npm run preview` (or the "voice-studio-prod" launch config) — or a
  // real deploy. (Verified 2026-06-28: prod build renders correctly.)
  optimizeDeps: {
    include: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // Multi-page build: orientation hub (root) + the Voice Lab + the full
        // hosted Design Studio (Track D).
        hub: resolve(root, 'index.html'),
        studio: resolve(root, 'studio/index.html'),
        designStudio: resolve(root, 'design-studio/index.html'),
      },
    },
  },
});
