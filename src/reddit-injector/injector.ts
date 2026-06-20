import { EXTENSION_LOG_PREFIX } from '@/src/utils';
import { deepQuerySelector } from '@/src/utils/shadow-dom';
import { openRecorderPanel } from '@/src/ui/recorder-panel';
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

function handleVoiceNoteClick(composer: Element): void {
  openRecorderPanel(composer);
}

function injectIntoTarget(target: ComposerInjectionTarget): void {
  const { composer, videoButton } = target;
  if (!videoButton) return;

  if (deepQuerySelector(composer, `[${VOICE_NOTE_BUTTON_ATTR}]`)) return;

  const button = createVoiceNoteButton({
    onClick: () => {
      handleVoiceNoteClick(composer);
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