import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'wxt';

const packageJson = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'package.json'), 'utf8'),
) as { version: string };

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: '.',
  // BUG FIX: Vite/WXT FSWatcher EBUSY crash when pasting files into .ignore/ (Windows)
  // Fix: do not watch gitignored QA/agent scratch dirs. Explorer paste locks the new file
  // briefly; chokidar's unhandled EBUSY on watch() killed the whole `wxt` dev process.
  // Sync: .gitignore entries for local-only trees that must never trigger HMR.
  vite: () => ({
    server: {
      watch: {
        ignored: [
          '**/.ignore/**',
          '**/terminals/**',
          '**/agent-tools/**',
          '**/mcps/**',
        ],
      },
    },
  }),
  manifest: {
    content_security_policy: {
      // MV3 extension_pages: wasm-unsafe-eval only (FFmpeg). No unsafe-eval — Chrome forbids it.
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
      // Manifest sandbox (vosk-sandbox.html): allows Vosk Emscripten eval. Built via esbuild, not WXT HMR.
      // BUG FIX: vosk-browser blob workers blocked by default child-src 'self' (BUG-010).
      // Fix: worker-src blob: 'self' — vosk Emscripten creates Workers from blob:null/… URLs.
      sandbox:
        "sandbox allow-scripts allow-forms allow-popups allow-modals; script-src 'self' 'unsafe-inline' 'unsafe-eval'; worker-src blob: 'self'; child-src blob: 'self';",
    },
    // CHANGED: static public sandbox page — WXT sandbox entrypoints break in dev (null-origin + localhost CORS).
    // WHY: vosk-sandbox.html loads self-contained public/vosk-sandbox.js from extension package in dev and prod.
    sandbox: {
      pages: ['vosk-sandbox.html'],
    },
    name: 'Reddit Voice Notes',
    description:
      'Record short voice notes with animated waveform, optional voice effects, and MP4 export for Reddit video comments.',
    version: packageJson.version,
    // CHANGED: add tabs — required for background → content-script transcode progress relay in prod builds.
    // WHY: WXT dev injects tabs automatically; without it, tabs.sendMessage relay silently fails → FFmpeg stuck at 0%.
    permissions: ['storage', 'offscreen', 'tabs'],
    // DISABLED: Keyboard shortcut — see src/reddit-injector/shortcut-handler.ts
    host_permissions: [
      'https://www.reddit.com/*',
      'https://reddit.com/*',
    ],
    web_accessible_resources: [
      {
        // BUG FIX: FFmpeg worker ESM bundle lives under ffmpeg/esm/ — single-level glob misses it.
        // Fix: expose both the core files and the full nested esm tree.
        // CHANGED: expose theme background SVGs for canvas drawImage in content scripts.
        // WHY: loadBackgroundImage() sets img.src to chrome-extension://… from Reddit pages.
        resources: ['ffmpeg/*', 'ffmpeg/esm/*', 'assets/backgrounds/*', 'assets/fonts/*', 'vosk/*'],
        matches: ['<all_urls>'],
      },
    ],
  },
});