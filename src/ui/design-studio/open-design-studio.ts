import { MSG_OPEN_DESIGN_STUDIO } from '@/src/messaging/types';

const DESIGN_STUDIO_PATH = 'design-studio.html' as const;

/**
 * Open Design Studio via background (tabs.create — uses existing `tabs` permission).
 * Safe from content scripts; fails silently if the relay is unavailable.
 */
export function openDesignStudioWindow(): void {
  void browser.runtime.sendMessage({ type: MSG_OPEN_DESIGN_STUDIO }).catch(() => {
    // Best-effort only — caller may show fallback copy; never throw from UI click paths.
  });
}

/** @internal Background handler target URL. */
export function designStudioExtensionUrl(): string {
  return browser.runtime.getURL(DESIGN_STUDIO_PATH as never);
}