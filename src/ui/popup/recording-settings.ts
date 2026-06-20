import {
  formatRecordingCapClock,
  formatRecordingCapProse,
} from '@/src/utils/constants';
import {
  loadUserPreferences,
  onUserPreferencesChanged,
  saveAppearancePreferences,
} from '@/src/settings/user-preferences';
import {
  bindToggle,
  renderInfoRow,
  renderSettingsSection,
  renderToggleRow,
} from './settings-shared';

export function mountRecordingSettingsSection(root: HTMLElement): () => void {
  const capClock = formatRecordingCapClock();
  const capProse = formatRecordingCapProse();

  root.innerHTML = renderSettingsSection(
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

  const reducedMotionToggle = bindToggle(root, 'recording-reduced-motion', (checked) => {
    void saveAppearancePreferences({ respectReducedMotion: checked });
  });

  function applyPrefs(respectReducedMotion: boolean): void {
    reducedMotionToggle.checked = respectReducedMotion;
  }

  void loadUserPreferences().then((prefs) => {
    applyPrefs(prefs.appearance.respectReducedMotion ?? true);
  });

  const unsubscribe = onUserPreferencesChanged((prefs) => {
    applyPrefs(prefs.appearance.respectReducedMotion ?? true);
  });

  return unsubscribe;
}