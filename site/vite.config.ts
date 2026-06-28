import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/*
 * Static Voice Studio — Vite config (Phase 0).
 *
 * Self-contained mini-project; 100% separate from the WXT extension at the repo
 * root. Builds the orientation hub (index.html) + the studio (studio/index.html)
 * to ./dist, which is published to the gh-pages branch ROOT (see scripts/publish-pages.mjs).
 */
const root = import.meta.dirname;

export default defineConfig({
  // Project Pages serve under /<repo>/ even when deploying from the gh-pages root,
  // so every absolute asset/route URL is prefixed with this base.
  base: '/reddit-voice-notes-chrome/',
  resolve: {
    alias: {
      // Mirror the extension's "@/..." alias so the ported leaf modules copy VERBATIM.
      //   @  ->  site/   ⇒   "@/src/voice/types"  resolves to  site/src/voice/types.ts
      '@': root,
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
        // Multi-page build: orientation hub (root) + the voice studio.
        hub: resolve(root, 'index.html'),
        studio: resolve(root, 'studio/index.html'),
      },
    },
  },
});
