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
