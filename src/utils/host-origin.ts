/*
 * Which origin owns "our" IndexedDB?
 *
 * Storage in this project is origin-scoped, so several modules need to know
 * whether the page they are running in shares an origin with the extension's own
 * pages. Historically that question was answered with a protocol literal —
 * `location.protocol === 'chrome-extension:'` in one place, `=== 'http:' ||
 * 'https:'` in another. That was correct only while exactly two hosts existed:
 * extension pages, and content scripts injected into web pages.
 *
 * v6 Track D adds a third: the Design Studio served from GitHub Pages. It runs on
 * https, so the protocol test misclassifies it as a content script and sends it
 * looking for a background service worker that does not exist.
 *
 * The durable question is not "what protocol am I?" but "is the extension's own
 * base URL on my origin?" — which is what the storage rule actually depends on:
 *
 *   extension page   getURL → chrome-extension://<id>/   vs chrome-extension://<id>  → same  → true
 *   background SW    same as above                                                   → same  → true
 *   content script   getURL → chrome-extension://<id>/   vs https://www.reddit.com   → differ → false
 *   hosted Studio    getURL → https://host/base/         vs https://host             → same  → true
 *
 * The first three rows reproduce today's extension behaviour exactly; only the
 * fourth is new, and it is the row the protocol test got wrong.
 */

/**
 * True when the extension's own base URL shares this page's origin — i.e. the
 * IndexedDB reachable from here IS the one that owns our data.
 *
 * Returns `false` whenever that cannot be positively established, matching the
 * previous conservative default at every call site.
 */
export function isOwnStorageOrigin(): boolean {
  try {
    if (typeof location === 'undefined') return false;
    const base = browser.runtime.getURL('' as never);
    return new URL(base).origin === location.origin;
  } catch {
    return false;
  }
}
