/**
 * Static Voice Studio — themed navigation banner.
 *
 * ⚠ WIP / FUTURE FEATURE (Phase 6)
 * This banner anticipates an Orientation *index* page that does not fully exist
 * yet. Today the back chip links to a PLACEHOLDER hub at the site root. When the
 * real orientation page ships:
 *   1. point ORIENTATION_HREF at it (if the hub moves),
 *   2. remove the `.nav-banner__wip` "soon" badge (markup below),
 *   3. revisit the labels and the "Work in progress" status pill.
 * See docs/static-voice-studio-design.md §7.
 *
 * Built from existing Design Studio v4 vector assets (amber/indigo themed):
 *   panels/nav-chip-9slice.svg ............ back-chip 9-slice frame (border-image)
 *   icons/navigation/chevron-back-32.svg .. back arrow
 *   icons/mic-wave-32.svg ................. wordmark mark
 */

// studio (/studio/) → hub (/). Relative, so it is correct both in dev and under
// the /reddit-voice-notes-chrome/ Pages base. WIP: final target TBD (Phase 6).
const ORIENTATION_HREF = '../';

/** Public asset dir (site/public/…), copied from the extension's design-studio-v4 set. */
const ASSETS = 'assets/design-studio-v4';

/** Base-aware public asset URL — resolves in dev and under the Pages base. */
function asset(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

export function mountNavBanner(host: HTMLElement): void {
  host.classList.add('nav-banner');
  host.innerHTML = `
    <a class="nav-banner__back" href="${ORIENTATION_HREF}"
       aria-label="Back to Orientation — work in progress">
      <img src="${asset(`${ASSETS}/icons/navigation/chevron-back-32.svg`)}"
           alt="" width="22" height="22" />
      <span class="nav-banner__back-label">
        Orientation
        <!-- WIP badge: remove when the orientation index page exists (Phase 6). -->
        <span class="nav-banner__wip">soon</span>
      </span>
    </a>

    <span class="nav-banner__wordmark">
      <img src="${asset(`${ASSETS}/icons/mic-wave-32.svg`)}"
           alt="" width="26" height="26" aria-hidden="true" />
      <span class="nav-banner__wordmark-text">Static Voice Studio</span>
    </span>

    <span class="nav-banner__status" title="This demo is a work in progress">
      <span class="nav-banner__status-dot" aria-hidden="true"></span>
      Work in progress
    </span>
  `;

  // Apply the 9-slice chip frame as a base-aware border-image (slice + width in CSS).
  const back = host.querySelector<HTMLElement>('.nav-banner__back');
  if (back) {
    back.style.borderImageSource = `url("${asset(`${ASSETS}/panels/nav-chip-9slice.svg`)}")`;
  }
}
