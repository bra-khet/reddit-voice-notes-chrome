import { defineConfig } from 'vite';
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

export default defineConfig({
  // Project Pages serve under /<repo>/, so every absolute asset/route URL is
  // prefixed with this base.
  base: '/reddit-voice-notes-chrome/',
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
    },
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
