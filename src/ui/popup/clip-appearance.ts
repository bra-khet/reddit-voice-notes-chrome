import {
  backgroundIsBokeh,
  getThemeById,
  listThemePresets,
  renderThemePreview,
  type BarAlignment,
} from '@/src/theme';
import { PROFILE_SELECT_CUSTOM } from '@/src/settings/clip-profiles';
import {
  applyClipProfile,
  deleteClipProfile,
  loadUserPreferences,
  onUserPreferencesChanged,
  saveAppearancePreferences,
  saveCurrentAsClipProfile,
  shouldReduceMotion,
  type UserPreferencesV1,
} from '@/src/settings/user-preferences';
import { populateProfileSelect } from '@/src/ui/clip-style-select';
import {
  mountPersonalBackgroundControls,
  renderPersonalBackgroundFields,
} from '@/src/ui/popup/personal-background';

// UX: top → center → bottom matches vertical bar position on the canvas (intuitive order).
const ALIGNMENT_OPTIONS: { value: BarAlignment; label: string }[] = [
  { value: 'top', label: 'Top' },
  { value: 'center', label: 'Center (mirrored)' },
  { value: 'bottom', label: 'Bottom' },
];

export function mountClipAppearanceSection(root: HTMLElement): () => void {
  root.innerHTML = `
    <section class="popup__section" aria-labelledby="clip-appearance-title">
      <h2 class="popup__section-title" id="clip-appearance-title">Clip appearance</h2>
      <div class="popup__preview-wrap">
        <canvas
          class="popup__preview-canvas"
          data-preview-canvas
          width="640"
          height="360"
          aria-label="Clip style preview"
          role="img"
        ></canvas>
      </div>
      <label class="popup__field">
        <span class="popup__field-label">Saved profile</span>
        <select class="popup__select" data-profile-select aria-label="Saved profile"></select>
      </label>
      <div class="popup__profile-actions">
        <button type="button" class="popup__profile-btn popup__profile-btn--save" data-save-profile>Save as profile</button>
        <button type="button" class="popup__profile-btn popup__profile-btn--delete" data-delete-profile hidden>Delete profile</button>
      </div>
      <label class="popup__field">
        <span class="popup__field-label">Clip style</span>
        <select class="popup__select" data-theme-select aria-label="Clip style"></select>
      </label>
      <label class="popup__field">
        <span class="popup__field-label">Bar alignment</span>
        <select class="popup__select" data-alignment-select aria-label="Bar alignment"></select>
      </label>
      ${renderPersonalBackgroundFields()}
      <p class="popup__micro">Save a profile to recall theme, alignment, and background. Preview matches your recorded clip.</p>
    </section>
  `;

  const previewCanvas = root.querySelector<HTMLCanvasElement>('[data-preview-canvas]')!;
  const profileSelect = root.querySelector<HTMLSelectElement>('[data-profile-select]')!;
  const themeSelect = root.querySelector<HTMLSelectElement>('[data-theme-select]')!;
  const alignmentSelect = root.querySelector<HTMLSelectElement>('[data-alignment-select]')!;
  const saveProfileBtn = root.querySelector<HTMLButtonElement>('[data-save-profile]')!;
  const deleteProfileBtn = root.querySelector<HTMLButtonElement>('[data-delete-profile]')!;

  for (const preset of listThemePresets()) {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.name;
    themeSelect.append(option);
  }

  for (const option of ALIGNMENT_OPTIONS) {
    const el = document.createElement('option');
    el.value = option.value;
    el.textContent = option.label;
    alignmentSelect.append(el);
  }

  let activeThemeId = '';
  let activeAlignment: BarAlignment = 'center';
  let activePrefs: UserPreferencesV1 | null = null;
  let renderGeneration = 0;
  let previewRaf = 0;
  let lastPreviewFrame = 0;
  const PREVIEW_ANIM_FPS = 12;

  function stopPreviewLoop(): void {
    if (previewRaf) cancelAnimationFrame(previewRaf);
    previewRaf = 0;
    lastPreviewFrame = 0;
  }

  function activeCustomBackgroundId(): string | null {
    return activePrefs?.appearance.customBackgroundId ?? null;
  }

  function syncPreviewLoop(): void {
    const theme = getThemeById(activeThemeId);
    if (
      activeCustomBackgroundId() ||
      !backgroundIsBokeh(theme.background) ||
      (activePrefs && shouldReduceMotion(activePrefs))
    ) {
      stopPreviewLoop();
      return;
    }
    if (previewRaf) return;

    const tick = (now: number): void => {
      previewRaf = requestAnimationFrame(tick);
      if (now - lastPreviewFrame < 1000 / PREVIEW_ANIM_FPS) return;
      lastPreviewFrame = now;
      void renderThemePreview(
        previewCanvas,
        getThemeById(activeThemeId),
        activeAlignment,
        now,
        activeCustomBackgroundId(),
      );
    };
    previewRaf = requestAnimationFrame(tick);
  }

  async function refreshPreview(timeMs?: number): Promise<void> {
    const generation = ++renderGeneration;
    const theme = getThemeById(activeThemeId);
    await renderThemePreview(
      previewCanvas,
      theme,
      activeAlignment,
      timeMs,
      activeCustomBackgroundId(),
    );
    if (generation !== renderGeneration) return;
    syncPreviewLoop();
  }

  function syncProfileActions(prefs: UserPreferencesV1): void {
    const hasActiveProfile = Boolean(prefs.appearance.activeProfileId);
    deleteProfileBtn.hidden = !hasActiveProfile;
    deleteProfileBtn.disabled = !hasActiveProfile;
  }

  function applyPrefs(prefs: UserPreferencesV1): void {
    activePrefs = prefs;
    activeThemeId = prefs.appearance.activeThemeId;
    activeAlignment = prefs.appearance.barAlignment ?? 'center';
    populateProfileSelect(profileSelect, prefs);
    themeSelect.value = activeThemeId;
    alignmentSelect.value = activeAlignment;
    syncProfileActions(prefs);
    void personalBackground.sync(prefs);
    stopPreviewLoop();
    void refreshPreview();
  }

  const personalBackground = mountPersonalBackgroundControls(root, applyPrefs);

  profileSelect.addEventListener('change', () => {
    const value = profileSelect.value;
    if (value === PROFILE_SELECT_CUSTOM) {
      void saveAppearancePreferences({ activeProfileId: null }).then(applyPrefs);
      return;
    }
    void applyClipProfile(value).then(applyPrefs);
  });

  themeSelect.addEventListener('change', () => {
    void saveAppearancePreferences({
      activeThemeId: themeSelect.value,
      activeProfileId: null,
    }).then(applyPrefs);
  });

  alignmentSelect.addEventListener('change', () => {
    const alignment = alignmentSelect.value as BarAlignment;
    void saveAppearancePreferences({
      barAlignment: alignment,
      activeProfileId: null,
    }).then(applyPrefs);
  });

  saveProfileBtn.addEventListener('click', () => {
    const name = window.prompt('Name this profile (theme, alignment, and background):');
    if (name === null) return;
    void saveCurrentAsClipProfile(name)
      .then(applyPrefs)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Could not save profile.';
        window.alert(message);
      });
  });

  deleteProfileBtn.addEventListener('click', () => {
    const profileId = activePrefs?.appearance.activeProfileId;
    if (!profileId) return;
    const profileName =
      activePrefs?.appearance.savedProfiles?.find((profile) => profile.id === profileId)?.name ??
      'this profile';
    if (!window.confirm(`Delete "${profileName}"?`)) return;
    void deleteClipProfile(profileId).then(applyPrefs);
  });

  void loadUserPreferences().then(applyPrefs);

  const unsubscribe = onUserPreferencesChanged(applyPrefs);

  return () => {
    stopPreviewLoop();
    unsubscribe();
  };
}