/** Non-blocking caution after audio/recording prefs change (v1.6; elevated by v6 Track C). */

const CAUTION_ID = 'popup-restart-caution';

export function mountRestartCaution(host: ParentNode): void {
  if (host.querySelector(`#${CAUTION_ID}`)) return;

  const el = document.createElement('div');
  el.id = CAUTION_ID;
  el.className = 'popup__restart-caution';
  el.hidden = true;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  // "Reload now" (not "Reload extension") so screen readers can tell this apart
  // from the permanent bottom button.
  el.innerHTML = `
    <p class="popup__restart-caution-copy">Audio / recording settings changed — reload recommended.</p>
    <button type="button" class="popup__restart-caution-reload">Reload now</button>
  `;

  // CHANGED: caution mounts directly under the popup header (was: above the bottom Reload).
  // WHY: v6 Track C elevates the reload signal to where the user is acting (roadmap §3);
  // showRestartCaution() call sites stay unchanged.
  const header = host.querySelector('.popup__header');
  if (header) {
    header.insertAdjacentElement('afterend', el);
  } else {
    const popupRoot = host.querySelector('.popup');
    if (popupRoot) popupRoot.prepend(el);
    else host.append(el);
  }

  el.querySelector<HTMLButtonElement>('.popup__restart-caution-reload')!.addEventListener(
    'click',
    () => {
      browser.runtime.reload();
    },
  );
}

export function showRestartCaution(): void {
  const el = document.getElementById(CAUTION_ID);
  if (!el) return;
  el.hidden = false;
}
