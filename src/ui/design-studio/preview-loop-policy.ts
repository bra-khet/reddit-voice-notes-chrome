export interface StudioPreviewAnimationSignals {
  hasActivePreferences: boolean;
  hasAnimatedSurface: boolean;
  customBackgroundId: string | null;
}

// BUG FIX: Theme-only compare froze the current theme and style
// Fix: keep the normal preview clock alive whenever a hydrated preview intentionally has no personal image.
// Sync: mount-clip-studio.ts; scripts/test-background-control-ui.mjs
export function shouldAnimateStudioPreview({
  hasActivePreferences,
  hasAnimatedSurface,
  customBackgroundId,
}: StudioPreviewAnimationSignals): boolean {
  return hasActivePreferences && (hasAnimatedSurface || customBackgroundId === null);
}
