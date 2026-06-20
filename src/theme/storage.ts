import { getThemeById } from './presets';
import type { WaveformTheme } from './types';

export const THEME_STORAGE_KEY = 'rvnActiveThemeId' as const;

export async function loadActiveTheme(): Promise<WaveformTheme> {
  const stored = await browser.storage.local.get(THEME_STORAGE_KEY);
  const id = stored[THEME_STORAGE_KEY] as string | undefined;
  return getThemeById(id);
}

export async function saveActiveThemeId(themeId: string): Promise<void> {
  await browser.storage.local.set({ [THEME_STORAGE_KEY]: themeId });
}

export function onActiveThemeChanged(listener: (themeId: string) => void): () => void {
  const handler = (
    changes: Record<string, { newValue?: unknown }>,
    area: string,
  ) => {
    if (area !== 'local' || !(THEME_STORAGE_KEY in changes)) return;
    const next = changes[THEME_STORAGE_KEY]?.newValue;
    if (typeof next === 'string') listener(next);
  };

  browser.storage.onChanged.addListener(handler);
  return () => browser.storage.onChanged.removeListener(handler);
}