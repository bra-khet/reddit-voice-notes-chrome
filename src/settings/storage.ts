import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  type ExtensionSettings,
  type ShortcutBinding,
} from './types';

function normalizeShortcut(shortcut: Partial<ShortcutBinding> | undefined): ShortcutBinding {
  const key = (shortcut?.key ?? DEFAULT_SETTINGS.shortcut.key).toLowerCase();
  return {
    ctrl: shortcut?.ctrl ?? DEFAULT_SETTINGS.shortcut.ctrl,
    shift: shortcut?.shift ?? DEFAULT_SETTINGS.shortcut.shift,
    alt: shortcut?.alt ?? DEFAULT_SETTINGS.shortcut.alt,
    meta: shortcut?.meta ?? DEFAULT_SETTINGS.shortcut.meta,
    key,
    code: shortcut?.code ?? DEFAULT_SETTINGS.shortcut.code,
  };
}

export async function loadSettings(): Promise<ExtensionSettings> {
  const stored = await browser.storage.sync.get(SETTINGS_STORAGE_KEY);
  const raw = stored[SETTINGS_STORAGE_KEY] as Partial<ExtensionSettings> | undefined;

  return {
    shortcut: normalizeShortcut(raw?.shortcut),
  };
}

export async function saveShortcut(shortcut: ShortcutBinding): Promise<void> {
  const settings: ExtensionSettings = {
    shortcut: normalizeShortcut(shortcut),
  };
  await browser.storage.sync.set({ [SETTINGS_STORAGE_KEY]: settings });
}

export async function resetSettings(): Promise<ExtensionSettings> {
  await browser.storage.sync.set({ [SETTINGS_STORAGE_KEY]: DEFAULT_SETTINGS });
  return DEFAULT_SETTINGS;
}

export function onSettingsChanged(
  listener: (settings: ExtensionSettings) => void,
): () => void {
  const handler = (
    changes: Record<string, { newValue?: unknown }>,
    area: string,
  ) => {
    if (area !== 'sync' || !(SETTINGS_STORAGE_KEY in changes)) return;
    const next = changes[SETTINGS_STORAGE_KEY]?.newValue as Partial<ExtensionSettings> | undefined;
    listener({
      shortcut: normalizeShortcut(next?.shortcut),
    });
  };

  browser.storage.onChanged.addListener(handler);
  return () => browser.storage.onChanged.removeListener(handler);
}