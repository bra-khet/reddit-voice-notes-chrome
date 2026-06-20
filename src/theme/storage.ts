import { getThemeById, normalizeThemeId } from './presets';
import type { WaveformTheme } from './types';

export const THEME_STORAGE_KEY = 'rvnActiveThemeId' as const;

export async function loadActiveTheme(): Promise<WaveformTheme> {
  const stored = await browser.storage.local.get(THEME_STORAGE_KEY);
  const raw = stored[THEME_STORAGE_KEY] as string | undefined;
  const id = normalizeThemeId(raw);
  // CHANGED: re-persist when stored id is stale so UI and waveform stay aligned.
  // WHY: forward-compat when presets are renamed or removed.
  if (raw !== id) {
    await browser.storage.local.set({ [THEME_STORAGE_KEY]: id });
  }
  return getThemeById(id);
}

export async function saveActiveThemeId(themeId: string): Promise<void> {
  const id = normalizeThemeId(themeId);
  await browser.storage.local.set({ [THEME_STORAGE_KEY]: id });
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