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
  manifest: {
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
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
        resources: ['ffmpeg/*', 'ffmpeg/esm/*', 'assets/backgrounds/*'],
        matches: ['<all_urls>'],
      },
    ],
  },
});