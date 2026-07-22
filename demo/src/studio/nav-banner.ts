/**
 * Voice Lab — themed navigation banner.
 *
 * Built from existing Design Studio v4 vector assets (amber/indigo themed):
 *   panels/nav-chip-9slice.svg ............ back-chip 9-slice frame (border-image)
 *   icons/navigation/chevron-back-32.svg .. back arrow
 *   icons/mic-wave-32.svg ................. wordmark mark
 */

// studio (/studio/) → hub (/). Relative; resolves correctly in dev and under
// the /reddit-voice-notes-chrome/ Pages base.
const ORIENTATION_HREF = '../';

/** Public asset dir (demo/public/…), copied from the extension's design-studio-v4 set. */
const ASSETS = 'assets/design-studio-v4';

/** Base-aware public asset URL — resolves in dev and under the Pages base. */
function asset(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

export function mountNavBanner(host: HTMLElement): void {
  host.classList.add('nav-banner');
  host.innerHTML = `
    <a class="nav-banner__back" href="${ORIENTATION_HREF}"
       aria-label="Back to Orientation">
      <img src="${asset(`${ASSETS}/icons/navigation/chevron-back-32.svg`)}"
           alt="" width="22" height="22" />
      <span class="nav-banner__back-label">
        Orientation
      </span>
    </a>

    <span class="nav-banner__wordmark">
      <img src="${asset(`${ASSETS}/icons/mic-wave-32.svg`)}"
           alt="" width="26" height="26" aria-hidden="true" />
      <span class="nav-banner__wordmark-text">Voice Lab</span>
    </span>

    <span class="nav-banner__status" title="Static demo — no extension required">
      <span class="nav-banner__status-dot" aria-hidden="true"></span>
      Static Demo
    </span>
  `;

  // Apply the 9-slice chip frame as a base-aware border-image (slice + width in CSS).
  const back = host.querySelector<HTMLElement>('.nav-banner__back');
  if (back) {
    back.style.borderImageSource = `url("${asset(`${ASSETS}/panels/nav-chip-9slice.svg`)}")`;
  }
}
