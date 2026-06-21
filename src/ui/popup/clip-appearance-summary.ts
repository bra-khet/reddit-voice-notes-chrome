import { getThemeById } from '@/src/theme';
import { getClipProfileById } from '@/src/settings/clip-profiles';
import { loadUserPreferences, onUserPreferencesChanged } from '@/src/settings/user-preferences';
import { openDesignStudioWindow } from '@/src/ui/design-studio/open-design-studio';

export function mountClipAppearanceSummary(root: HTMLElement): () => void {
  root.innerHTML = `
    <section class="popup__section" aria-labelledby="clip-summary-title">
      <h2 class="popup__section-title" id="clip-summary-title">Clip appearance</h2>
      <p class="popup__summary-line" data-summary-active></p>
      <p class="popup__summary-line popup__summary-line--muted" data-summary-detail></p>
      <button type="button" class="popup__button popup__button--studio" data-open-design-studio>
        Open Design Studio…
      </button>
    </section>
  `;

  const activeLine = root.querySelector<HTMLElement>('[data-summary-active]')!;
  const detailLine = root.querySelector<HTMLElement>('[data-summary-detail]')!;
  const openBtn = root.querySelector<HTMLButtonElement>('[data-open-design-studio]')!;

  async function refresh(): Promise<void> {
    const prefs = await loadUserPreferences();
    const profile = prefs.appearance.activeProfileId
      ? getClipProfileById(prefs, prefs.appearance.activeProfileId)
      : undefined;
    const theme = getThemeById(prefs.appearance.activeThemeId);
    const alignment = prefs.appearance.barAlignment ?? 'center';
    const hasBackground = Boolean(prefs.appearance.customBackgroundId);

    activeLine.textContent = profile
      ? `Profile: ${profile.name}`
      : `Style: ${theme.name}`;

    const parts = [
      profile ? `Theme: ${theme.name}` : null,
      `Alignment: ${alignment}`,
      hasBackground ? 'Personal background' : 'Theme background',
    ].filter(Boolean);

    detailLine.textContent = parts.join(' · ');
  }

  openBtn.addEventListener('click', () => openDesignStudioWindow());

  void refresh();
  const unsubscribe = onUserPreferencesChanged(() => {
    void refresh();
  });

  return unsubscribe;
}