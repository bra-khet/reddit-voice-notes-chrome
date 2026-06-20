import type { ShortcutBinding } from './types';

const MODIFIER_KEYS = new Set(['control', 'shift', 'alt', 'meta']);

function eventMatchesKey(event: KeyboardEvent, binding: ShortcutBinding): boolean {
  if (binding.code && event.code.toLowerCase() === binding.code.toLowerCase()) {
    return true;
  }

  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase();
  const expected = binding.key.toLowerCase();

  if (key === expected) return true;
  if (event.code.toLowerCase() === `key${expected}`) return true;

  return false;
}

export function formatShortcut(binding: ShortcutBinding): string {
  const isMac = navigator.platform.toLowerCase().includes('mac');
  const parts: string[] = [];

  if (binding.ctrl) parts.push(isMac ? '⌃' : 'Ctrl');
  if (binding.alt) parts.push(isMac ? '⌥' : 'Alt');
  if (binding.shift) parts.push(isMac ? '⇧' : 'Shift');
  if (binding.meta) parts.push(isMac ? '⌘' : 'Meta');
  parts.push(binding.key.length === 1 ? binding.key.toUpperCase() : binding.key);

  return parts.join('+');
}

export function matchesShortcut(event: KeyboardEvent, binding: ShortcutBinding): boolean {
  if (event.repeat) return false;
  if (MODIFIER_KEYS.has(event.key.toLowerCase())) return false;
  if (!eventMatchesKey(event, binding)) return false;
  if (event.ctrlKey !== binding.ctrl) return false;
  if (event.shiftKey !== binding.shift) return false;
  if (event.altKey !== binding.alt) return false;
  if (event.metaKey !== binding.meta) return false;

  return true;
}

export function shortcutFromKeyboardEvent(event: KeyboardEvent): ShortcutBinding | null {
  if (MODIFIER_KEYS.has(event.key.toLowerCase())) return null;

  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase();
  if (!key) return null;

  const hasModifier = event.ctrlKey || event.shiftKey || event.altKey || event.metaKey;
  if (!hasModifier) return null;

  return {
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey,
    key,
    code: event.code,
  };
}

export function shortcutsEqual(a: ShortcutBinding, b: ShortcutBinding): boolean {
  return (
    a.ctrl === b.ctrl &&
    a.shift === b.shift &&
    a.alt === b.alt &&
    a.meta === b.meta &&
    a.key === b.key &&
    (a.code ?? '') === (b.code ?? '')
  );
}

/** True when popup shortcut matches the manifest command default (handled by chrome.commands). */
export function isManifestDefaultShortcut(binding: ShortcutBinding): boolean {
  const isMac = navigator.platform.toLowerCase().includes('mac');
  return (
    binding.key === 'x' &&
    binding.shift === true &&
    binding.alt === false &&
    (isMac ? binding.meta === true && binding.ctrl === false : binding.ctrl === true && binding.meta === false)
  );
}