import { EXTENSION_LOG_PREFIX } from '@/src/utils';
import { pruneDetachedButtons, scanAndInject } from './injector';

const SCAN_DEBOUNCE_MS = 250;

let observer: MutationObserver | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleScan(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    pruneDetachedButtons();
    const injected = scanAndInject();
    if (injected > 0) {
      console.log(`${EXTENSION_LOG_PREFIX} Scan complete — injected into ${injected} composer(s)`);
    }
  }, SCAN_DEBOUNCE_MS);
}

export function startComposerObserver(): void {
  if (observer) return;

  scanAndInject();

  observer = new MutationObserver((mutations) => {
    const relevant = mutations.some(
      (m) => m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0),
    );
    if (relevant) scheduleScan();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  console.log(`${EXTENSION_LOG_PREFIX} Composer MutationObserver started`);
}

export function stopComposerObserver(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = undefined;
  observer?.disconnect();
  observer = null;
}