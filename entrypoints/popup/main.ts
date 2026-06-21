import './style.css';
import { mountAudioSettingsSection } from '@/src/ui/popup/audio-settings';
import { mountClipAppearanceSection } from '@/src/ui/popup/clip-appearance';
import { mountNotificationSettingsSection } from '@/src/ui/popup/notification-settings';
import { mountRecordingSettingsSection } from '@/src/ui/popup/recording-settings';
import { mountRestartCaution } from '@/src/ui/popup/restart-caution';

const README_URL = 'https://github.com/bra-khet/reddit-voice-notes-chrome/blob/main/README.md';
const README_ICON_URL = browser.runtime.getURL('icon/github-README-icon.png' as never);
const manifest = browser.runtime.getManifest();

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="popup">
    <header class="popup__header">
      <div class="popup__header-row">
        <div class="popup__header-copy">
          <h1 class="popup__title">Reddit Voice Notes</h1>
          <p class="popup__version">v${manifest.version} · Pretty</p>
        </div>
        <a
          class="popup__readme-link"
          href="${README_URL}"
          target="_blank"
          rel="noopener noreferrer"
          title="Stuck? Read the guide here."
          aria-label="Stuck? Read the guide here (opens README on GitHub)"
        >
          <img class="popup__readme-icon" src="${README_ICON_URL}" width="16" height="16" alt="" />
          <span>README</span>
        </a>
      </div>
    </header>
    <p class="popup__hint">
      Open a Reddit comment box with video comments enabled, then click the microphone
      button next to the video icon.
    </p>
    <div data-clip-appearance></div>
    <div data-audio-settings></div>
    <div data-recording-settings></div>
    <div data-notification-settings></div>
    <button id="reload-extension" type="button" class="popup__button popup__button--secondary">
      Reload extension
    </button>
  </main>
`;

const unmountFns = [
  mountClipAppearanceSection(document.querySelector<HTMLElement>('[data-clip-appearance]')!),
  mountAudioSettingsSection(document.querySelector<HTMLElement>('[data-audio-settings]')!),
  mountRecordingSettingsSection(document.querySelector<HTMLElement>('[data-recording-settings]')!),
  mountNotificationSettingsSection(document.querySelector<HTMLElement>('[data-notification-settings]')!),
];

mountRestartCaution(document.querySelector<HTMLElement>('#app')!);

document.querySelector<HTMLButtonElement>('#reload-extension')!.addEventListener('click', () => {
  browser.runtime.reload();
});

window.addEventListener('unload', () => {
  for (const unmount of unmountFns) unmount();
});