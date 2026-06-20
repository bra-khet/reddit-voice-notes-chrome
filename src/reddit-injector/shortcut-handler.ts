/**
 * DISABLED (v1.0.2): Keyboard shortcut abandoned for now.
 *
 * Reddit comment composers live in shadow DOM + contenteditable inputs; reliable
 * global shortcuts conflict with chrome.commands and focused input fields.
 * Revisit when we can target the composer input without fighting Reddit's key handling.
 *
 * Previous implementation preserved below (commented out).
 */

// import { loadSettings, onSettingsChanged } from '@/src/settings/storage';
// import { isManifestDefaultShortcut, matchesShortcut } from '@/src/settings/shortcut';
// import { DEFAULT_SHORTCUT, type ShortcutBinding } from '@/src/settings/types';
// import { MSG_OPEN_RECORDER } from '@/src/messaging/types';
// import { showToast } from '@/src/ui/toast';
// import { openRecorderPanel } from '@/src/ui/recorder-panel';
// import { findComposerFromNode, resolveTargetComposer } from './composer-detection';

export function initVoiceNoteShortcut(): void {
  // Intentionally no-op — see module header.
}

export function teardownVoiceNoteShortcut(): void {
  // Intentionally no-op — see module header.
}