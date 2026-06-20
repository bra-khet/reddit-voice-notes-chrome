import { EXTENSION_LOG_PREFIX } from '@/src/utils';
import { MSG_OPEN_RECORDER, type OpenRecorderMessage } from '@/src/messaging/types';
import { showToast } from '@/src/ui/toast';
import { openRecorderPanel } from '@/src/ui/recorder-panel';
import { startComposerObserver, stopComposerObserver } from './observer';
import { removeAllInjectedButtons } from './injector';
import { resolveTargetComposer } from './composer-detection';
import { initVoiceNoteShortcut, teardownVoiceNoteShortcut } from './shortcut-handler';

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
  initVoiceNoteShortcut();

  browser.runtime.onMessage.addListener((message) => {
    if (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      (message as OpenRecorderMessage).type === MSG_OPEN_RECORDER
    ) {
      const composer = resolveTargetComposer();
      if (composer) {
        openRecorderPanel(composer);
      } else {
        showToast('Focus a Reddit comment box with video comments enabled.', 'info', 5000);
      }
    }
  });
}

/**
 * Tear down observer and remove all injected buttons.
 * Used for hot-reload cleanup or future disable toggle.
 */
export function teardownRedditVoiceNotes(): void {
  stopComposerObserver();
  teardownVoiceNoteShortcut();
  removeAllInjectedButtons();
  initialized = false;
  console.log(`${EXTENSION_LOG_PREFIX} Reddit injector torn down`);
}