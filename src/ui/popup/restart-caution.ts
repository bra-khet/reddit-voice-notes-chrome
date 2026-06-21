/** Non-blocking caution after audio/recording prefs change (v1.6). */

const CAUTION_ID = 'popup-restart-caution';

export function mountRestartCaution(host: ParentNode): void {
  if (host.querySelector(`#${CAUTION_ID}`)) return;

  const el = document.createElement('p');
  el.id = CAUTION_ID;
  el.className = 'popup__restart-caution';
  el.hidden = true;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.textContent =
    'Restarting the extension is recommended after changing audio or recording settings. Reload extension ↓';

  const reloadBtn = host.querySelector('#reload-extension');
  if (reloadBtn?.parentElement) {
    reloadBtn.parentElement.insertBefore(el, reloadBtn);
  } else {
    host.append(el);
  }
}

export function showRestartCaution(): void {
  const el = document.getElementById(CAUTION_ID);
  if (!el) return;
  el.hidden = false;
}