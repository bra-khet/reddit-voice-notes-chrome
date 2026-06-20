export interface ShortcutBinding {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  /** Lowercase key id, e.g. "x" */
  key: string;
}

export interface ExtensionSettings {
  shortcut: ShortcutBinding;
}

export const SETTINGS_STORAGE_KEY = 'rvnSettings' as const;

export const DEFAULT_SHORTCUT: ShortcutBinding = {
  ctrl: true,
  shift: true,
  alt: false,
  meta: false,
  key: 'x',
};

export const DEFAULT_SETTINGS: ExtensionSettings = {
  shortcut: DEFAULT_SHORTCUT,
};