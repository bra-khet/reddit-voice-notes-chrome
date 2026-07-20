import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const fixtureRoot = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));

// CHANGED: v6 Track C popup fixture resolves the same @ alias and public assets as WXT.
// WHY: browser QA must exercise the production popup CSS, render builders, and the
// elevated restart-caution module — not copied markup — without loading the extension.
export default defineConfig({
  root: fixtureRoot,
  publicDir: join(projectRoot, 'public'),
  resolve: { alias: { '@': projectRoot } },
  server: {
    host: '127.0.0.1',
    port: 4175,
    strictPort: true,
  },
});
