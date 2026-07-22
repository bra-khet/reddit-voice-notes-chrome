/*
 * Web host — install the `browser` global. SIDE-EFFECT MODULE, IMPORT IT FIRST.
 *
 * Track D Phase 0 · roadmap docs/v6.0.0-hosted-design-studio.md §3.1.
 *
 * WHY THIS WORKS AT ALL
 * ---------------------
 * `browser` is a WXT AUTO-IMPORT: there is not one `import { browser }` anywhere
 * in src/ or entrypoints/, so under a plain Vite build it is simply a free
 * variable resolved against globalThis at CALL time. And no src/ module evaluates
 * `browser.*` at module scope — every reference sits inside a function body.
 * ESM evaluates imports depth-first in source order, so importing this module
 * first in the web entry installs the global strictly before any extension module
 * body can run.
 *
 * That is the entire seam. It is why the hosted Studio needs ZERO edits to
 * extension source, and why the rejected `StudioHost` interface (which would have
 * threaded a parameter through ~40 files) was the wrong shape.
 *
 * THE RULE THIS DEPENDS ON — keep it true:
 *   New shared src/ code must keep `browser.*` inside function bodies. A single
 *   module-scope `const url = browser.runtime.getURL(...)` would evaluate during
 *   the import graph walk and break the hosted build in a way that looks like a
 *   bundler bug rather than a rule violation.
 */
import { webStorage } from './web-storage';
import { webCommands, webRuntime, webTabs, webWindows } from './web-runtime';

export const webBrowser = {
  storage: webStorage,
  runtime: webRuntime,
  tabs: webTabs,
  windows: webWindows,
  commands: webCommands,
};

export type WebBrowserShim = typeof webBrowser;

declare global {
  // eslint-disable-next-line no-var
  var browser: WebBrowserShim;
}

/**
 * True when `value` already exposes the storage surface the Studio boots through.
 *
 * BUG FIX: incomplete pre-existing `globalThis.browser`
 * Fix: the old guard was truthy-only (`if (!globalThis.browser)`). Any other
 * script or extension that plants a partial `browser` object (e.g. `{ runtime }`)
 * left the shim uninstalled, so boot died on `browser.storage.local` with
 * "Cannot read properties of undefined (reading 'local')". Require a real
 * `storage.local.get` before treating the global as already installed.
 * Sync: web-storage.ts (`local.get`); boot path in design-studio/main.ts.
 */
function isUsableBrowserShim(value: unknown): value is WebBrowserShim {
  if (value == null || typeof value !== 'object') return false;
  const storage = (value as { storage?: { local?: { get?: unknown } } }).storage;
  return typeof storage?.local?.get === 'function';
}

// Idempotent for our own complete install (HMR must not swap the object out from
// under listeners). Incomplete foreign objects are replaced.
const globalWithBrowser = globalThis as { browser?: WebBrowserShim };
if (!isUsableBrowserShim(globalWithBrowser.browser)) {
  globalWithBrowser.browser = webBrowser;
}
