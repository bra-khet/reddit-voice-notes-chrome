import { EXTENSION_LOG_PREFIX } from '@/src/utils';
import { startComposerObserver, stopComposerObserver } from './observer';
import { removeAllInjectedButtons } from './injector';
// DISABLED: Keyboard shortcut — see src/reddit-injector/shortcut-handler.ts
// import { initVoiceNoteShortcut, teardownVoiceNoteShortcut } from './shortcut-handler';

let initialized = false;

/**
 * Initialize Reddit voice-note injection.
 * Idempotent — safe to call once per content-script load.
 */
export function initRedditVoiceNotes(): void {
  if (initialized) return;
  initialized = true;

  console.log(`${EXTENSION_LOG_PREFIX} Reddit injector starting`);
  startComposerObserver();
  // initVoiceNoteShortcut();
}

/**
 * Tear down observer and remove all injected buttons.
 * Used for hot-reload cleanup or future disable toggle.
 */
export function teardownRedditVoiceNotes(): void {
  stopComposerObserver();
  // teardownVoiceNoteShortcut();
  removeAllInjectedButtons();
  initialized = false;
  console.log(`${EXTENSION_LOG_PREFIX} Reddit injector torn down`);
}