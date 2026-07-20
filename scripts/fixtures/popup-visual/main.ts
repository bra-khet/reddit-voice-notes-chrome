import '../../../entrypoints/popup/style.css';
import '../../../entrypoints/popup/popup-palette.css';
import './harness.css';
import {
  bindToggle,
  renderInfoRow,
  renderSettingsSection,
  renderToggleRow,
} from '@/src/ui/popup/settings-shared';
import { mountRestartCaution, showRestartCaution } from '@/src/ui/popup/restart-caution';
import {
  formatRecordingCapClock,
  formatRecordingCapProse,
} from '@/src/utils/constants';
import { APP_VERSION } from '@/src/utils/version';

// Fixture-only stub: the elevated caution's inline "Reload now" calls
// browser.runtime.reload() at click time; outside the extension we log instead.
(globalThis as { browser?: unknown }).browser = {
  runtime: {
    reload() {
      console.log('[popup-visual fixture] browser.runtime.reload()');
      const note = document.getElementById('fixture-note');
      if (note) {
        note.textContent =
          'browser.runtime.reload() called — in the real popup the extension reloads here.';
      }
    },
  },
};

const capClock = formatRecordingCapClock();
const capProse = formatRecordingCapProse();

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div class="fixture-stage">
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
            href="#"
            title="Stuck? Read the guide here."
            aria-label="Stuck? Read the guide here (opens README on GitHub)"
          >
            <img class="popup__readme-icon" src="/icon/github-README-icon.png" width="16" height="16" alt="" />
            <span>README</span>
          </a>
        </div>
      </header>
      <p class="popup__hint">
        Open a Reddit comment box with video comments enabled, then click the microphone
        button next to the video icon.
      </p>
      <div data-clip-summary>
        <section class="popup__section" aria-labelledby="clip-summary-title">
          <h2 class="popup__section-title" id="clip-summary-title">Clip appearance</h2>
          <p class="popup__summary-line">Style: Midnight Bubbles</p>
          <p class="popup__summary-line popup__summary-line--muted">Alignment: center · Theme background · Voice: Deep Space Echo</p>
          <button type="button" class="popup__button popup__button--studio">
            Open Design Studio…
          </button>
        </section>
      </div>
      <div data-audio-settings></div>
      <div data-recording-settings></div>
      <div data-notification-settings></div>
      <button id="reload-extension" type="button" class="popup__button popup__button--secondary">
        Reload extension
      </button>
    </main>
  </div>
  <p id="fixture-note" class="fixture-note">
    v6 Track C fixture — production CSS + production row builders + production restart-caution
    module. Flip any Audio toggle or "Simplify waveform motion" to trigger the elevated caution.
  </p>
`;

// Sections use the production builders with the production copy (verbatim from
// audio-settings.ts / recording-settings.ts / notification-settings.ts).
const audioRoot = app.querySelector<HTMLElement>('[data-audio-settings]')!;
audioRoot.innerHTML = renderSettingsSection(
  'Audio',
  'audio-settings-title',
  `
    ${renderToggleRow({
      id: 'audio-raw-mic',
      label: 'Raw microphone capture',
      description: 'Turn off browser echo cancellation, noise suppression, and auto gain.',
      helpTip:
        'Use only if your mic sounds muffled or telephone-like. Raw capture can pick up room echo, keyboard clicks, and fan noise.',
      checked: false,
    })}
    ${renderToggleRow({
      id: 'audio-enhanced-capture',
      label: 'Enhanced capture (headset)',
      description: 'Request ideally constrained 48 kHz stereo when your device supports it.',
      helpTip:
        'Best with USB headsets. Falls back to mono or browser defaults when hardware cannot honor the ideals.',
      checked: false,
    })}
    ${renderToggleRow({
      id: 'audio-full-spectrum',
      label: 'Full-spectrum visualization',
      description:
        'Show a wider frequency range for music or ambient audio instead of the voice-focused 80 Hz – 16 kHz band.',
      helpTip:
        'Maps the full audible range to bars. Speech may look less dramatic; music and ambient sound fill more of the spectrum.',
      checked: false,
    })}
    <p class="popup__micro">Capture toggles apply the next time you open the recorder. Visualization updates live on an open session.</p>
  `,
);

const recordingRoot = app.querySelector<HTMLElement>('[data-recording-settings]')!;
recordingRoot.innerHTML = renderSettingsSection(
  'Recording',
  'recording-settings-title',
  `
    ${renderInfoRow({
      label: 'Maximum clip length',
      value: capClock,
      description: `${capProse.charAt(0).toUpperCase()}${capProse.slice(1)} pipeline limit. Reddit video comments allow up to about 3:00.`,
    })}
    ${renderToggleRow({
      id: 'recording-reduced-motion',
      label: 'Simplify waveform motion',
      description:
        'When your system requests reduced motion, use a calmer static or simplified waveform instead of animated bars.',
      checked: true,
    })}
    ${renderToggleRow({
      id: 'recording-keyboard-shortcut',
      label: 'Keyboard shortcut',
      description:
        'Open the recorder from any Reddit comment box. Disabled for now due to Reddit input and shadow DOM conflicts.',
      checked: false,
      disabled: true,
      comingSoon: true,
    })}
  `,
);

const notificationRoot = app.querySelector<HTMLElement>('[data-notification-settings]')!;
notificationRoot.innerHTML = renderSettingsSection(
  'Notifications',
  'notification-settings-title',
  `
    ${renderToggleRow({
      id: 'notifications-result-toasts',
      label: 'Show result toasts',
      description:
        'Brief on-page messages after attach, download, cap stop, or errors while recording on Reddit.',
      checked: true,
      disabled: true,
      comingSoon: true,
    })}
    <p class="popup__micro">Toasts are on by default today. A toggle to silence them arrives in a future update.</p>
  `,
);

// Production caution module: mounts hidden under the header, revealed by the
// same showRestartCaution() the four production call sites use.
mountRestartCaution(app);

for (const id of [
  'audio-raw-mic',
  'audio-enhanced-capture',
  'audio-full-spectrum',
  'recording-reduced-motion',
]) {
  bindToggle(app, id, () => showRestartCaution());
}

document.querySelector<HTMLButtonElement>('#reload-extension')!.addEventListener('click', () => {
  console.log('[popup-visual fixture] bottom Reload extension clicked');
});
