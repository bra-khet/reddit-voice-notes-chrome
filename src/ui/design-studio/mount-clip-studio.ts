import {
  backgroundIsBokeh,
  getThemeById,
  listThemePresets,
  renderThemePreview,
  type BarAlignment,
} from '@/src/theme';
import {
  appearanceMatchesProfile,
  getClipProfileById,
  PROFILE_SELECT_CUSTOM,
} from '@/src/settings/clip-profiles';
import {
  applyClipProfile,
  deleteClipProfile,
  loadUserPreferences,
  onUserPreferencesChanged,
  saveAppearancePreferences,
  saveCurrentAsClipProfile,
  shouldReduceMotion,
  updateActiveClipProfile,
  type UserPreferencesV1,
} from '@/src/settings/user-preferences';
import { populateProfileSelect } from '@/src/ui/clip-style-select';
import {
  mountPersonalBackgroundControls,
  renderPersonalBackgroundFields,
} from '@/src/ui/popup/personal-background';

const ALIGNMENT_OPTIONS: { value: BarAlignment; label: string }[] = [
  { value: 'top', label: 'Top' },
  { value: 'center', label: 'Center (mirrored)' },
  { value: 'bottom', label: 'Bottom' },
];

export function mountClipStudio(root: HTMLElement): () => void {
  root.innerHTML = `
    <main class="studio">
      <header class="studio__header">
        <h1 class="studio__title">Design Studio</h1>
        <p class="studio__subtitle">Clip appearance — preview matches your recorded video.</p>
      </header>
      <div class="studio__preview-wrap">
        <canvas
          class="studio__preview-canvas"
          data-preview-canvas
          width="640"
          height="360"
          aria-label="Clip style preview"
          role="img"
        ></canvas>
      </div>
      <div class="studio__panel">
        <h2 class="studio__panel-title">Profile</h2>
        <label class="popup__field">
          <span class="popup__field-label">Saved profile</span>
          <select class="popup__select" data-profile-select aria-label="Saved profile"></select>
        </label>
        <div class="popup__profile-actions">
          <button type="button" class="popup__profile-btn popup__profile-btn--save" data-save-profile>
            Save as profile
          </button>
          <button type="button" class="popup__profile-btn popup__profile-btn--delete" data-delete-profile hidden>
            Delete profile
          </button>
        </div>
      </div>
      <div class="studio__panel">
        <h2 class="studio__panel-title">Style</h2>
        <label class="popup__field">
          <span class="popup__field-label">Clip style</span>
          <select class="popup__select" data-theme-select aria-label="Clip style"></select>
        </label>
        <label class="popup__field">
          <span class="popup__field-label">Bar alignment</span>
          <select class="popup__select" data-alignment-select aria-label="Bar alignment"></select>
        </label>
      </div>
      <div class="studio__panel">
        <h2 class="studio__panel-title">Background</h2>
        ${renderPersonalBackgroundFields()}
      </div>
      <p class="studio__footer-note">
        Changes apply live to the recorder. With a profile selected, use <strong>Update profile</strong> to save edits.
      </p>
    </main>
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
  let updateConfirmPending = false;
  const PREVIEW_ANIM_FPS = 12;

  function stopPreviewLoop(): void {
    if (previewRaf) cancelAnimationFrame(previewRaf);
    previewRaf = 0;
    lastPreviewFrame = 0;
  }

  function activeCustomBackgroundId(): string | null {
    return activePrefs?.appearance.customBackgroundId ?? null;
  }

  function activeProfile(): ReturnType<typeof getClipProfileById> {
    const id = activePrefs?.appearance.activeProfileId;
    return id && activePrefs ? getClipProfileById(activePrefs, id) : undefined;
  }

  function isProfileDirty(): boolean {
    const profile = activeProfile();
    if (!profile || !activePrefs) return false;
    return !appearanceMatchesProfile(activePrefs.appearance, profile);
  }

  function resetUpdateConfirm(): void {
    updateConfirmPending = false;
  }

  function syncProfileButton(prefs: UserPreferencesV1): void {
    const profileId = prefs.appearance.activeProfileId;
    const dirty = isProfileDirty();

    if (!profileId) {
      saveProfileBtn.textContent = 'Save as profile';
      saveProfileBtn.disabled = false;
      saveProfileBtn.classList.remove('popup__profile-btn--muted');
      resetUpdateConfirm();
      return;
    }

    saveProfileBtn.textContent = updateConfirmPending ? 'Sure?' : 'Update profile';
    saveProfileBtn.disabled = !dirty && !updateConfirmPending;
    saveProfileBtn.classList.toggle('popup__profile-btn--muted', !dirty && !updateConfirmPending);
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
    syncProfileButton(prefs);
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
    resetUpdateConfirm();
    const value = profileSelect.value;
    if (value === PROFILE_SELECT_CUSTOM) {
      void saveAppearancePreferences({ activeProfileId: null }).then(applyPrefs);
      return;
    }
    void applyClipProfile(value).then(applyPrefs);
  });

  themeSelect.addEventListener('change', () => {
    resetUpdateConfirm();
    void saveAppearancePreferences({
      activeThemeId: themeSelect.value,
    }).then(applyPrefs);
  });

  alignmentSelect.addEventListener('change', () => {
    resetUpdateConfirm();
    const alignment = alignmentSelect.value as BarAlignment;
    void saveAppearancePreferences({
      barAlignment: alignment,
    }).then(applyPrefs);
  });

  saveProfileBtn.addEventListener('click', () => {
    const profileId = activePrefs?.appearance.activeProfileId;
    if (profileId) {
      if (!isProfileDirty() && !updateConfirmPending) return;
      if (!updateConfirmPending) {
        updateConfirmPending = true;
        syncProfileButton(activePrefs!);
        return;
      }
      resetUpdateConfirm();
      void updateActiveClipProfile()
        .then(applyPrefs)
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'Could not update profile.';
          window.alert(message);
        });
      return;
    }

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
    resetUpdateConfirm();
    const profileId = activePrefs?.appearance.activeProfileId;
    if (!profileId) return;
    const profileName = activeProfile()?.name ?? 'this profile';
    if (!window.confirm(`Delete "${profileName}"?`)) return;
    void deleteClipProfile(profileId).then(applyPrefs);
  });

  void loadUserPreferences().then(applyPrefs);

  const unsubscribe = onUserPreferencesChanged((prefs) => {
    resetUpdateConfirm();
    applyPrefs(prefs);
  });

  return () => {
    stopPreviewLoop();
    unsubscribe();
  };
}