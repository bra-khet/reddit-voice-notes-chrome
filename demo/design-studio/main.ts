/*
 * Hosted Design Studio — web entry (Track D Phase 0).
 *
 * Deliberately mirrors entrypoints/design-studio/main.ts almost line for line.
 * Everything below the shim import is the REAL extension source, unmodified — if
 * this file starts diverging in anything but the first import and the host
 * options, that is a signal the shim is missing something, not a licence to fork.
 */

// MUST be the first import. See install-browser-shim.ts for why the ordering is
// load-bearing rather than stylistic.
import './host/install-browser-shim';

// Same stylesheet order as the extension entry. popup/style.css is the shared
// control-primitive base the Studio builds on — it is not "the popup's styles".
import '@/entrypoints/popup/style.css';
import '@/entrypoints/design-studio/studio-palette.css';
import '@/entrypoints/design-studio/studio-v4-chrome.css';
import '@/entrypoints/design-studio/studio-v4-layout.css';
import '@/entrypoints/design-studio/studio-v4-buttons.css';
import '@/entrypoints/design-studio/style.css';
// CHANGED: mirror the shared Profile actions menu stylesheet in the hosted shell.
// WHY: shared markup and interaction must keep extension/Pages visual parity.
import '@/entrypoints/design-studio/profile-actions.css';
// CHANGED: mirror the host-neutral reset dialog stylesheet after the shared profile chrome.
// WHY: the hosted Studio mounts the same reset control and must preserve visual parity.
import '@/entrypoints/design-studio/settings-reset.css';
import '@/entrypoints/design-studio/studio-v4-controls.css';
import '@/entrypoints/design-studio/style-control-center.css';

// Track D Phase 1: the background's relay slice, in-page. Installed before boot
// so a Studio that renders the Record button can always service it.
import { installWebPipelineHost } from './host/web-pipeline-host';

import { reconcileBackgroundPreferences } from '@/src/storage/background-refs';
import { loadUserPreferences } from '@/src/settings/user-preferences';
import { mountClipStudio } from '@/src/ui/design-studio/mount-clip-studio';
import { getWorkflowPhase } from '@/src/workflow/workflow-state';

const app = document.querySelector<HTMLDivElement>('#app')!;
let unmount: () => void = () => {};

async function bootDesignStudio(): Promise<void> {
  installWebPipelineHost();
  const [prefs, workflowPhase] = await Promise.all([loadUserPreferences(), getWorkflowPhase()]);
  const reconciled = await reconcileBackgroundPreferences(prefs);
  // Track D §3.6: this host has no extension and no Reddit tab to reach, so the
  // Reddit-attach affordances are suppressed rather than left as dead controls.
  unmount = mountClipStudio(app, {
    initialPrefs: reconciled,
    initialWorkflowPhase: workflowPhase,
    hostCapabilities: { redditAttach: false },
  });
}

/*
 * The extension entry can afford `void bootDesignStudio()` — if it throws, the
 * developer sees it in an extension-page console they already have open. A hosted
 * page cannot: a rejected boot renders a WHITE PAGE with no explanation, which is
 * the single worst outcome for a visitor who just downloaded 31 MB of engines.
 * Roadmap §5.1 requires honest degradation on arrival, so failure gets a face.
 */
function renderBootFailure(error: unknown): void {
  console.error('[Design Studio] boot failed', error);
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  app.textContent = '';
  const panel = document.createElement('div');
  panel.setAttribute('role', 'alert');
  panel.style.cssText =
    'max-width:46rem;margin:4rem auto;padding:1.5rem;font:16px/1.6 system-ui,sans-serif;color:#e8e6f0';
  const heading = document.createElement('h1');
  heading.textContent = 'The Design Studio could not start';
  heading.style.cssText = 'font-size:1.35rem;margin:0 0 .75rem';
  const body = document.createElement('p');
  body.textContent =
    'Reloading usually fixes this. If it keeps happening, your browser may be blocking storage for this site.';
  body.style.margin = '0 0 1rem';
  const code = document.createElement('pre');
  code.textContent = detail;
  code.style.cssText =
    'white-space:pre-wrap;font-size:.85rem;opacity:.75;margin:0;padding:.75rem;border-radius:.4rem;background:rgba(255,255,255,.06)';
  panel.append(heading, body, code);
  app.append(panel);
}

void bootDesignStudio().catch(renderBootFailure);

window.addEventListener(
  'pagehide',
  () => {
    unmount();
  },
  { once: true },
);
