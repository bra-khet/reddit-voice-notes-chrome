/* Minimal toast for transient feedback (clipboard, errors). The static-page
 * analogue of the extension's showToast — same call shape so ported callers fit. */
let container: HTMLElement | null = null;

function ensureContainer(): HTMLElement {
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-host';
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
  }
  return container;
}

export function showToast(message: string, kind: 'info' | 'error' = 'info', ms = 3400): void {
  if (!message) return;
  const host = ensureContainer();
  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  window.setTimeout(() => {
    el.classList.remove('is-in');
    window.setTimeout(() => el.remove(), 250);
  }, ms);
}
