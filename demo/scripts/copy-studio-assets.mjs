/*
 * Vendor the extension's packaged assets into demo/public/assets/ so the hosted
 * Design Studio can serve everything `browser.runtime.getURL()` asks for.
 *
 * WHY MIRROR THE PATHS EXACTLY
 * ----------------------------
 * The shim's getURL is a pure prefix swap: `chrome-extension://<id>/assets/x`
 * becomes `<pages-base>assets/x`. That only holds if the directory layout under
 * assets/ is identical, so this copies whole trees rather than picking files.
 *
 * WHY GENERATED RATHER THAN COMMITTED
 * -----------------------------------
 * Same reasoning that retired the DSP copies in Phase 0: a committed duplicate is
 * a thing that silently goes stale. These are produced from ../public/assets on
 * every install and build, and git-ignored. Five hand-copied SVGs used to live
 * here for the hub and Voice Lab; they are gone, replaced by the full mirror.
 *
 * Idempotent + tolerant, like copy-ffmpeg-core.mjs. Runs on postinstall+prebuild.
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..'); // demo/
const source = join(root, '..', 'public', 'assets');
const target = join(root, 'public', 'assets');

/*
 * fonts/ carries BOTH the Chakra Petch display faces referenced from CSS and the
 * four DejaVu TTFs the subtitle overlay loads at runtime — without them, caption
 * rendering falls back to system fonts and preview stops matching the bake.
 */
const trees = ['design-studio-v4', 'fonts', 'backgrounds'];

if (!existsSync(source)) {
  console.warn('[vendor:studio-assets] ../public/assets not found — skipping.');
  process.exit(0);
}

mkdirSync(target, { recursive: true });
const copied = [];
for (const tree of trees) {
  const from = join(source, tree);
  if (!existsSync(from)) {
    console.warn(`[vendor:studio-assets] missing tree: ${tree} — skipping.`);
    continue;
  }
  cpSync(from, join(target, tree), { recursive: true });
  copied.push(tree);
}
console.log(`[vendor:studio-assets] Mirrored ${copied.join(', ')} → public/assets/`);
