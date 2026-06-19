import { EXTENSION_LOG_PREFIX } from '@/src/utils';
import { pruneDetachedButtons, scanAndInject } from './injector';
import { logScanDiagnostics as logDiagnostics } from './composer-detection';

const SCAN_DEBOUNCE_MS = 250;
const DIAGNOSTIC_INTERVAL_MS = 8000;

let observer: MutationObserver | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let lastDiagnosticAt = 0;
let focusListenerAttached = false;

function maybeLogDiagnostics(context: string, injected: number): void {
  if (injected > 0) return;
  const now = Date.now();
  if (now - lastDiagnosticAt < DIAGNOSTIC_INTERVAL_MS) return;
  lastDiagnosticAt = now;
  logDiagnostics(context);
}

function runScan(context: string): void {
  pruneDetachedButtons();
  const injected = scanAndInject();
  if (injected > 0) {
    console.log(`${EXTENSION_LOG_PREFIX} Scan complete — injected into ${injected} composer(s) (${context})`);
  } else {
    maybeLogDiagnostics(context, injected);
  }
}

function scheduleScan(context = 'mutation'): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => runScan(context), SCAN_DEBOUNCE_MS);
}

function attachFocusListener(): void {
  if (focusListenerAttached) return;
  focusListenerAttached = true;

  document.addEventListener(
    'focusin',
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        target.matches('[role="textbox"], [contenteditable="true"], textarea') ||
        target.closest('shreddit-composer, shreddit-comment-composer')
      ) {
        scheduleScan('focus');
      }
    },
    true,
  );

  document.addEventListener(
    'click',
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        target.closest(
          'shreddit-composer, shreddit-comment-composer, [data-testid="comment-composer"], #comment-composer',
        )
      ) {
        scheduleScan('click');
      }
    },
    true,
  );
}

export function startComposerObserver(): void {
  if (observer) return;

  runScan('init');
  attachFocusListener();

  observer = new MutationObserver((mutations) => {
    const relevant = mutations.some(
      (m) => m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0),
    );
    if (relevant) scheduleScan('mutation');
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
  focusListenerAttached = false;
}