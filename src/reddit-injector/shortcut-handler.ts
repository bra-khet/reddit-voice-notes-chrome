import { loadSettings, onSettingsChanged } from '@/src/settings/storage';
import { isManifestDefaultShortcut, matchesShortcut } from '@/src/settings/shortcut';
import { DEFAULT_SHORTCUT, type ShortcutBinding } from '@/src/settings/types';
import { MSG_OPEN_RECORDER } from '@/src/messaging/types';
import { showToast } from '@/src/ui/toast';
import { openRecorderPanel } from '@/src/ui/recorder-panel';
import { findComposerFromNode, resolveTargetComposer } from './composer-detection';

let activeShortcut: ShortcutBinding = DEFAULT_SHORTCUT;
let initialized = false;

function onOpenRecorderMessage(message: unknown): void {
  if (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    (message as { type: string }).type === MSG_OPEN_RECORDER
  ) {
    openRecorderForComposer(resolveTargetComposer());
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function resolveComposerForEvent(event: KeyboardEvent): Element | null {
  const fromTarget = findComposerFromNode(event.target instanceof Node ? event.target : null);
  if (fromTarget) return fromTarget;
  return resolveTargetComposer();
}

function openRecorderForComposer(composer: Element | null): void {
  if (!composer) {
    showToast('Open a Reddit comment box with video comments enabled.', 'info', 5000);
    return;
  }
  openRecorderPanel(composer);
}

function onKeyDown(event: KeyboardEvent): void {
  if (!matchesShortcut(event, activeShortcut)) return;

  // Default Ctrl+Shift+X is delivered via chrome.commands — the page never sees that key combo.
  if (isManifestDefaultShortcut(activeShortcut)) return;

  if (isEditableTarget(event.target) && !findComposerFromNode(event.target instanceof Node ? event.target : null)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  openRecorderForComposer(resolveComposerForEvent(event));
}

export function initVoiceNoteShortcut(): void {
  if (initialized) return;
  initialized = true;

  activeShortcut = DEFAULT_SHORTCUT;

  void loadSettings().then((settings) => {
    activeShortcut = settings.shortcut;
  });

  onSettingsChanged((settings) => {
    activeShortcut = settings.shortcut;
  });

  window.addEventListener('keydown', onKeyDown, true);
  browser.runtime.onMessage.addListener(onOpenRecorderMessage);
}

export function teardownVoiceNoteShortcut(): void {
  window.removeEventListener('keydown', onKeyDown, true);
  browser.runtime.onMessage.removeListener(onOpenRecorderMessage);
  initialized = false;
  activeShortcut = DEFAULT_SHORTCUT;
}