import { loadSettings, onSettingsChanged } from '@/src/settings/storage';
import { matchesShortcut } from '@/src/settings/shortcut';
import type { ShortcutBinding } from '@/src/settings/types';
import { showToast } from '@/src/ui/toast';
import { openRecorderPanel } from '@/src/ui/recorder-panel';
import { resolveTargetComposer } from './composer-detection';

let activeShortcut: ShortcutBinding | null = null;
let initialized = false;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function handleShortcutOpen(): void {
  const composer = resolveTargetComposer();
  if (!composer) {
    showToast('Focus a Reddit comment box with video comments enabled.', 'info', 5000);
    return;
  }
  openRecorderPanel(composer);
}

function onKeyDown(event: KeyboardEvent): void {
  if (!activeShortcut) return;
  if (!matchesShortcut(event, activeShortcut)) return;

  // Allow shortcut while typing in a comment composer; skip other editable fields.
  if (isEditableTarget(event.target) && !resolveTargetComposer()) return;

  event.preventDefault();
  event.stopPropagation();
  handleShortcutOpen();
}

export function initVoiceNoteShortcut(): void {
  if (initialized) return;
  initialized = true;

  void loadSettings().then((settings) => {
    activeShortcut = settings.shortcut;
  });

  onSettingsChanged((settings) => {
    activeShortcut = settings.shortcut;
  });

  document.addEventListener('keydown', onKeyDown, true);
}

export function teardownVoiceNoteShortcut(): void {
  document.removeEventListener('keydown', onKeyDown, true);
  initialized = false;
  activeShortcut = null;
}