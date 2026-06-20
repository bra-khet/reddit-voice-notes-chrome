import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: '.',
  manifest: {
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    name: 'Reddit Voice Notes',
    description:
      'Record short voice notes with an animated waveform and export MP4 for Reddit video comments.',
    version: '1.0.0',
    permissions: ['storage', 'offscreen'],
    commands: {
      'open-voice-recorder': {
        suggested_key: {
          default: 'Ctrl+Shift+X',
          mac: 'Command+Shift+X',
        },
        description: 'Open voice note recorder on Reddit',
      },
    },
    host_permissions: [
      'https://www.reddit.com/*',
      'https://reddit.com/*',
    ],
    web_accessible_resources: [
      {
        // BUG FIX: FFmpeg worker ESM bundle lives under ffmpeg/esm/ — single-level glob misses it.
        // Fix: expose both the core files and the full nested esm tree.
        resources: ['ffmpeg/*', 'ffmpeg/esm/*'],
        matches: ['<all_urls>'],
      },
    ],
  },
});