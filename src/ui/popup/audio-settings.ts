import {
  loadUserPreferences,
  onUserPreferencesChanged,
  saveAudioPreferences,
} from '@/src/settings/user-preferences';
import { bindToggle, renderSettingsSection, renderToggleRow } from './settings-shared';

function syncAudioToggles(root: HTMLElement, prefs: Awaited<ReturnType<typeof loadUserPreferences>>): void {
  const rawMic = root.querySelector<HTMLInputElement>('#audio-raw-mic');
  const enhanced = root.querySelector<HTMLInputElement>('#audio-enhanced-capture');
  const fullSpectrum = root.querySelector<HTMLInputElement>('#audio-full-spectrum');

  if (rawMic) rawMic.checked = prefs.audio.rawMicCapture ?? false;
  if (enhanced) enhanced.checked = prefs.audio.preferHighQualityCapture ?? false;
  if (fullSpectrum) fullSpectrum.checked = prefs.audio.fullSpectrumViz ?? false;
}

export function mountAudioSettingsSection(root: HTMLElement): () => void {
  root.innerHTML = renderSettingsSection(
    'Audio',
    'audio-settings-title',
    `
      ${renderToggleRow({
        id: 'audio-raw-mic',
        label: 'Raw microphone capture',
        description:
          'Turn off browser echo cancellation, noise suppression, and auto gain.',
        helpTip:
          'Use only if your mic sounds muffled or telephone-like. Raw capture can pick up room echo, keyboard clicks, and fan noise.',
        checked: false,
      })}
      ${renderToggleRow({
        id: 'audio-enhanced-capture',
        label: 'Enhanced capture (headset)',
        description:
          'Request ideally constrained 48 kHz stereo when your device supports it.',
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

  bindToggle(root, 'audio-raw-mic', (checked) => {
    void saveAudioPreferences({ rawMicCapture: checked });
  });

  bindToggle(root, 'audio-enhanced-capture', (checked) => {
    void saveAudioPreferences({ preferHighQualityCapture: checked });
  });

  bindToggle(root, 'audio-full-spectrum', (checked) => {
    void saveAudioPreferences({ fullSpectrumViz: checked });
  });

  void loadUserPreferences().then((prefs) => syncAudioToggles(root, prefs));

  const unsubscribe = onUserPreferencesChanged((prefs) => {
    syncAudioToggles(root, prefs);
  });

  return unsubscribe;
}