import { loadUserPreferences, onUserPreferencesChanged } from '@/src/settings/user-preferences';
import { renderSettingsSection, renderToggleRow } from './settings-shared';

export function mountAudioSettingsSection(root: HTMLElement): () => void {
  root.innerHTML = renderSettingsSection(
    'Audio',
    'audio-settings-title',
    `
      ${renderToggleRow({
        id: 'audio-raw-mic',
        label: 'Raw microphone capture',
        description:
          'Bypass browser echo cancellation, noise suppression, and auto gain. Helpful if your mic sounds muffled or telephone-like.',
        checked: false,
        disabled: true,
        comingSoon: true,
      })}
      ${renderToggleRow({
        id: 'audio-full-spectrum',
        label: 'Full-spectrum visualization',
        description:
          'Show a wider frequency range for music or ambient audio instead of the voice-focused 80 Hz – 16 kHz band.',
        checked: false,
        disabled: true,
        comingSoon: true,
      })}
      <p class="popup__micro">Audio processing toggles ship in a future update. Defaults stay optimized for speech.</p>
    `,
  );

  const unsubscribe = onUserPreferencesChanged((prefs) => {
    const rawMic = root.querySelector<HTMLInputElement>('#audio-raw-mic');
    const fullSpectrum = root.querySelector<HTMLInputElement>('#audio-full-spectrum');
    if (rawMic) rawMic.checked = prefs.audio.rawMicCapture ?? false;
    if (fullSpectrum) fullSpectrum.checked = prefs.audio.fullSpectrumViz ?? false;
  });

  void loadUserPreferences().then((prefs) => {
    const rawMic = root.querySelector<HTMLInputElement>('#audio-raw-mic');
    const fullSpectrum = root.querySelector<HTMLInputElement>('#audio-full-spectrum');
    if (rawMic) rawMic.checked = prefs.audio.rawMicCapture ?? false;
    if (fullSpectrum) fullSpectrum.checked = prefs.audio.fullSpectrumViz ?? false;
  });

  return unsubscribe;
}