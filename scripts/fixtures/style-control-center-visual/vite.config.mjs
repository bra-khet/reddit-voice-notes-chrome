import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const fixtureRoot = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));

// CHANGED: the visual fixture resolves the same @ alias and public assets as WXT.
// WHY: browser QA must exercise production modules and physical controls, not copied markup.
export default defineConfig({
  root: fixtureRoot,
  publicDir: join(projectRoot, 'public'),
  resolve: { alias: { '@': projectRoot } },
  server: {
    host: '127.0.0.1',
    port: 4174,
    strictPort: true,
  },
});
