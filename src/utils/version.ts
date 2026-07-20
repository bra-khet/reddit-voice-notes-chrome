/**
 * Extension release version — must match package.json / wxt manifest.
 * WHY: single re-export for docs and any UI that cannot read the manifest at build time.
 */
// BUG FIX: stale popup version string
// Fix: APP_VERSION was left at 5.10.0 when the package shipped 5.11.0, so the popup
// header displayed the wrong release; bumped to match package.json per this file's contract.
export const APP_VERSION = '5.11.0' as const;