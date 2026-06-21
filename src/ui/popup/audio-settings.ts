import { describeCaptureProfile } from '@/src/recorder/mic-constraints';
import { loadUserPreferences, onUserPreferencesChanged } from '@/src/settings/user-preferences';
import { renderInfoRow, renderSettingsSection, renderToggleRow } from './settings-shared';

function syncAudioToggles(root: HTMLElement, prefs: Awaited<ReturnType<typeof loadUserPreferences>>): void {
  const profileLabel = root.querySelector<HTMLElement>('#audio-capture-profile');
  const rawMic = root.querySelector<HTMLInputElement>('#audio-raw-mic');
  const enhanced = root.querySelector<HTMLInputElement>('#audio-enhanced-capture');
  const fullSpectrum = root.querySelector<HTMLInputElement>('#audio-full-spectrum');

  if (profileLabel) profileLabel.textContent = describeCaptureProfile(prefs.audio);
  if (rawMic) rawMic.checked = prefs.audio.rawMicCapture ?? false;
  if (enhanced) enhanced.checked = prefs.audio.preferHighQualityCapture ?? false;
  if (fullSpectrum) fullSpectrum.checked = prefs.audio.fullSpectrumViz ?? false;
}

export function mountAudioSettingsSection(root: HTMLElement): () => void {
  root.innerHTML = renderSettingsSection(
    'Audio',
    'audio-settings-title',
    `
      ${renderInfoRow({
        label: 'Capture profile',
        value: 'Economy (browser defaults)',
        valueId: 'audio-capture-profile',
        description:
          'Active mic path from your settings. Economy uses browser WebRTC defaults; enhanced requests ideal 48 kHz stereo when enabled.',
      })}
      ${renderToggleRow({
        id: 'audio-raw-mic',
        label: 'Raw microphone capture',
        description:
          'Turn off browser echo cancellation, noise suppression, and auto gain. Use if your mic sounds muffled or telephone-like.',
        checked: false,
        disabled: true,
        comingSoon: true,
      })}
      ${renderToggleRow({
        id: 'audio-enhanced-capture',
        label: 'Enhanced capture (headset)',
        description:
          'Request ideally constrained 48 kHz stereo when your device supports it. Falls back to mono or browser defaults gracefully.',
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
      <p class="popup__micro">Toggles ship in pretty-3. Defaults stay economy until you opt in.</p>
    `,
  );

  void loadUserPreferences().then((prefs) => syncAudioToggles(root, prefs));

  const unsubscribe = onUserPreferencesChanged((prefs) => {
    syncAudioToggles(root, prefs);
  });

  return unsubscribe;
}