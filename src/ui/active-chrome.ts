import { getThemeById } from '@/src/theme/presets';
import type { WaveformTheme } from '@/src/theme/types';
import {
  defaultThemeChrome,
  deriveChromeFromTheme,
  type ThemeChrome,
} from '@/src/ui/theme-chrome';
import {
  loadUserPreferences,
  onUserPreferencesChanged,
} from '@/src/settings/user-preferences';

let activeChrome: ThemeChrome = defaultThemeChrome();
const listeners = new Set<() => void>();

export function getActiveChrome(): ThemeChrome {
  return activeChrome;
}

export function setActiveChromeFromTheme(theme: WaveformTheme): void {
  activeChrome = deriveChromeFromTheme(theme);
  for (const listener of listeners) listener();
}

export function subscribeActiveChrome(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let chromeInitialized = false;

/** Sync panel/toast accents with the active clip theme (pretty-5). */
export function initActiveChrome(): void {
  if (chromeInitialized) return;
  chromeInitialized = true;

  void loadUserPreferences().then((prefs) => {
    setActiveChromeFromTheme(getThemeById(prefs.appearance.activeThemeId));
  });

  onUserPreferencesChanged((prefs) => {
    setActiveChromeFromTheme(getThemeById(prefs.appearance.activeThemeId));
  });
}