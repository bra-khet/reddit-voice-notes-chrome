import { EXTENSION_LOG_PREFIX } from '@/src/utils';
import { deepQuerySelector } from '@/src/utils/shadow-dom';
import { requestMicrophonePermission } from '@/src/utils/permissions';
import { showToast } from '@/src/ui/toast';
import {
  findAllInjectionTargets,
  markComposerInjected,
  unmarkComposerInjected,
  type ComposerInjectionTarget,
} from './composer-detection';
import { createVoiceNoteButton, removeVoiceNoteButton } from './voice-note-button';
import { VOICE_NOTE_BUTTON_ATTR } from './selectors';

interface InjectedButton {
  composer: Element;
  button: HTMLButtonElement;
}

const injectedButtons = new Map<Element, InjectedButton>();

async function handleVoiceNoteClick(): Promise<void> {
  const permission = await requestMicrophonePermission();

  if (permission.state === 'granted') {
    showToast('Microphone ready — recorder UI coming in Phase 2.', 'info');
    return;
  }

  if (permission.state === 'denied') {
    showToast(
      'Microphone access denied. Allow microphone for reddit.com in browser settings.',
      'error',
      6000,
    );
    return;
  }

  showToast(permission.error ?? 'Could not access microphone.', 'error', 6000);
}

function injectIntoTarget(target: ComposerInjectionTarget): void {
  const { composer, videoButton } = target;
  if (!videoButton) return;

  if (deepQuerySelector(composer, `[${VOICE_NOTE_BUTTON_ATTR}]`)) return;

  const button = createVoiceNoteButton({
    onClick: () => {
      void handleVoiceNoteClick();
    },
    showLabel: false,
  });

  videoButton.insertAdjacentElement('afterend', button);
  markComposerInjected(composer);
  injectedButtons.set(composer, { composer, button });

  console.log(`${EXTENSION_LOG_PREFIX} Injected voice note button`, {
    composerTag: composer.tagName,
    anchorTag: videoButton.tagName,
    anchorLabel: videoButton.getAttribute('aria-label'),
  });
}

function removeFromComposer(composer: Element): void {
  const entry = injectedButtons.get(composer);
  if (!entry) return;

  removeVoiceNoteButton(entry.button);
  unmarkComposerInjected(composer);
  injectedButtons.delete(composer);
}

export function scanAndInject(): number {
  const targets = findAllInjectionTargets();
  for (const target of targets) {
    injectIntoTarget(target);
  }
  return targets.length;
}

export function removeAllInjectedButtons(): void {
  for (const composer of [...injectedButtons.keys()]) {
    removeFromComposer(composer);
  }
}

export function pruneDetachedButtons(): void {
  for (const [composer] of injectedButtons) {
    if (!document.contains(composer)) {
      injectedButtons.delete(composer);
    }
  }
}