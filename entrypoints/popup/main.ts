import './style.css';
// CHANGED: v6 Track C popup skin overlays the legacy sheet (imported after, popup-only).
// WHY: style.css doubles as the Design Studio's control-primitive base and must not change.
import './popup-palette.css';
import { reconcileBackgroundPreferences } from '@/src/storage/background-refs';
import { loadUserPreferences } from '@/src/settings/user-preferences';
import { mountAudioSettingsSection } from '@/src/ui/popup/audio-settings';
import { mountClipAppearanceSummary } from '@/src/ui/popup/clip-appearance-summary';
import { mountNotificationSettingsSection } from '@/src/ui/popup/notification-settings';
import { mountRecordingSettingsSection } from '@/src/ui/popup/recording-settings';
import { mountRestartCaution } from '@/src/ui/popup/restart-caution';
import { APP_VERSION } from '@/src/utils/version';

const README_URL = 'https://github.com/bra-khet/reddit-voice-notes-chrome/blob/main/README.md';
const README_ICON_URL = browser.runtime.getURL('icon/github-README-icon.png' as never);

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="popup">
    <header class="popup__header">
      <div class="popup__header-row">
        <div class="popup__header-copy">
          <div class="popup__title-row">
            <svg class="popup__brand-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/>
              <line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
            <h1 class="popup__title">Reddit Voice Notes</h1>
          </div>
          <p class="popup__version">v${APP_VERSION}</p>
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
    <div data-clip-summary></div>
    <div data-audio-settings></div>
    <div data-recording-settings></div>
    <div data-notification-settings></div>
    <button id="reload-extension" type="button" class="popup__button popup__button--secondary">
      Reload extension
    </button>
  </main>
`;

const unmountFns = [
  mountClipAppearanceSummary(document.querySelector<HTMLElement>('[data-clip-summary]')!),
  mountAudioSettingsSection(document.querySelector<HTMLElement>('[data-audio-settings]')!),
  mountRecordingSettingsSection(document.querySelector<HTMLElement>('[data-recording-settings]')!),
  mountNotificationSettingsSection(document.querySelector<HTMLElement>('[data-notification-settings]')!),
];

mountRestartCaution(document.querySelector<HTMLElement>('#app')!);

// pretty-7a: drop stale `bg-…` prefs refs when ImageDB records are missing.
void loadUserPreferences().then(reconcileBackgroundPreferences);

document.querySelector<HTMLButtonElement>('#reload-extension')!.addEventListener('click', () => {
  browser.runtime.reload();
});

window.addEventListener('unload', () => {
  for (const unmount of unmountFns) unmount();
});