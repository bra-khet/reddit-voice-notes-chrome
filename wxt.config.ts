import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: '.',
  manifest: {
    name: 'Reddit Voice Notes',
    description:
      'Record short voice notes with an animated waveform and export MP4 for Reddit video comments.',
    version: '0.1.0',
    permissions: ['storage'],
    host_permissions: [
      'https://www.reddit.com/*',
      'https://reddit.com/*',
    ],
  },
});