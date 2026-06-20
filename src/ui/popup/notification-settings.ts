import { loadUserPreferences, onUserPreferencesChanged } from '@/src/settings/user-preferences';
import { renderSettingsSection, renderToggleRow } from './settings-shared';

export function mountNotificationSettingsSection(root: HTMLElement): () => void {
  root.innerHTML = renderSettingsSection(
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

  const unsubscribe = onUserPreferencesChanged((prefs) => {
    const toasts = root.querySelector<HTMLInputElement>('#notifications-result-toasts');
    if (toasts) toasts.checked = prefs.notifications.showResultToasts ?? true;
  });

  void loadUserPreferences().then((prefs) => {
    const toasts = root.querySelector<HTMLInputElement>('#notifications-result-toasts');
    if (toasts) toasts.checked = prefs.notifications.showResultToasts ?? true;
  });

  return unsubscribe;
}