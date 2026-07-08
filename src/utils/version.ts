/**
 * Extension release version — must match package.json / wxt manifest.
 * WHY: single re-export for docs and any UI that cannot read the manifest at build time.
 */
export const APP_VERSION = '5.6.0' as const;