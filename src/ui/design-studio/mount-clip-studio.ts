import {
  backgroundIsBokeh,
  listThemePresets,
  renderThemePreview,
  resolveAppearanceTheme,
  type BarAlignment,
} from '@/src/theme';
import {
  appearanceMatchesProfile,
  getClipProfileById,
  PROFILE_SELECT_CUSTOM,
} from '@/src/settings/clip-profiles';
import {
  getCustomStyleById,
  isCustomStyleDirty,
  parseStyleSelectValue,
  profilesAffectedByStyleDeletion,
} from '@/src/settings/custom-styles';
import {
  applyClipProfile,
  applyCustomClipStyle,
  applyPresetClipStyle,
  deleteClipProfile,
  deleteCustomClipStyle,
  enterCustomStyleMode,
  loadUserPreferences,
  onUserPreferencesChanged,
  saveAppearancePreferences,
  saveCurrentAsClipProfile,
  saveCurrentAsCustomStyle,
  saveCustomStyleColors,
  shouldReduceMotion,
  updateActiveClipProfile,
  updateActiveCustomStyle,
  type UserPreferencesV1,
} from '@/src/settings/user-preferences';
import { populateProfileSelect } from '@/src/ui/clip-style-select';
import {
  mountColorPickerControls,
  renderColorPickerFields,
} from '@/src/ui/design-studio/color-picker';
import {
  mountPersonalBackgroundControls,
  renderPersonalBackgroundFields,
} from '@/src/ui/popup/personal-background';
import {
  isStylePanelVisible,
  populateDesignStudioStyleSelect,
} from '@/src/ui/style-select';

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
        <div data-custom-style-panel hidden>
          ${renderColorPickerFields()}
          <div class="popup__profile-actions">
            <button type="button" class="popup__profile-btn popup__profile-btn--save" data-save-style>
              Save as style
            </button>
            <button type="button" class="popup__profile-btn popup__profile-btn--delete" data-delete-style hidden>
              Delete style
            </button>
          </div>
        </div>
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
        Changes apply live to the recorder. With a profile or custom style selected, use
        <strong>Update profile</strong> or <strong>Update style</strong> to save edits.
      </p>
    </main>
  `;

  const previewCanvas = root.querySelector<HTMLCanvasElement>('[data-preview-canvas]')!;
  const profileSelect = root.querySelector<HTMLSelectElement>('[data-profile-select]')!;
  const themeSelect = root.querySelector<HTMLSelectElement>('[data-theme-select]')!;
  const alignmentSelect = root.querySelector<HTMLSelectElement>('[data-alignment-select]')!;
  const customStylePanel = root.querySelector<HTMLElement>('[data-custom-style-panel]')!;
  const saveProfileBtn = root.querySelector<HTMLButtonElement>('[data-save-profile]')!;
  const deleteProfileBtn = root.querySelector<HTMLButtonElement>('[data-delete-profile]')!;
  const saveStyleBtn = root.querySelector<HTMLButtonElement>('[data-save-style]')!;
  const deleteStyleBtn = root.querySelector<HTMLButtonElement>('[data-delete-style]')!;

  for (const option of ALIGNMENT_OPTIONS) {
    const el = document.createElement('option');
    el.value = option.value;
    el.textContent = option.label;
    alignmentSelect.append(el);
  }

  let activeAlignment: BarAlignment = 'center';
  let activePrefs: UserPreferencesV1 | null = null;
  let renderGeneration = 0;
  let previewRaf = 0;
  let lastPreviewFrame = 0;
  let profileUpdateConfirmPending = false;
  let styleUpdateConfirmPending = false;
  const PREVIEW_ANIM_FPS = 12;

  function stopPreviewLoop(): void {
    if (previewRaf) cancelAnimationFrame(previewRaf);
    previewRaf = 0;
    lastPreviewFrame = 0;
  }

  function activeCustomBackgroundId(): string | null {
    return activePrefs?.appearance.customBackgroundId ?? null;
  }

  function resolvedTheme() {
    return activePrefs ? resolveAppearanceTheme(activePrefs.appearance) : listThemePresets()[0];
  }

  function activeProfile(): ReturnType<typeof getClipProfileById> {
    const id = activePrefs?.appearance.activeProfileId;
    return id && activePrefs ? getClipProfileById(activePrefs, id) : undefined;
  }

  function activeCustomStyle(): ReturnType<typeof getCustomStyleById> {
    const id = activePrefs?.appearance.activeCustomStyleId;
    return id && activePrefs ? getCustomStyleById(activePrefs, id) : undefined;
  }

  function isProfileDirty(): boolean {
    const profile = activeProfile();
    if (!profile || !activePrefs) return false;
    return !appearanceMatchesProfile(activePrefs.appearance, profile);
  }

  function resetProfileUpdateConfirm(): void {
    profileUpdateConfirmPending = false;
  }

  function resetStyleUpdateConfirm(): void {
    styleUpdateConfirmPending = false;
  }

  function syncProfileButton(prefs: UserPreferencesV1): void {
    const profileId = prefs.appearance.activeProfileId;
    const dirty = isProfileDirty();

    if (!profileId) {
      saveProfileBtn.textContent = 'Save as profile';
      saveProfileBtn.disabled = false;
      saveProfileBtn.classList.remove('popup__profile-btn--muted', 'popup__profile-btn--confirm');
      resetProfileUpdateConfirm();
      return;
    }

    saveProfileBtn.textContent = profileUpdateConfirmPending ? 'Sure?' : 'Update profile';
    saveProfileBtn.disabled = !dirty && !profileUpdateConfirmPending;
    saveProfileBtn.classList.toggle('popup__profile-btn--muted', !dirty && !profileUpdateConfirmPending);
    saveProfileBtn.classList.toggle('popup__profile-btn--confirm', profileUpdateConfirmPending);
  }

  function syncStyleButton(prefs: UserPreferencesV1): void {
    const styleId = prefs.appearance.activeCustomStyleId;
    const dirty = isCustomStyleDirty(prefs.appearance);
    const showPanel = isStylePanelVisible(prefs);

    customStylePanel.hidden = !showPanel;
    if (!showPanel) {
      resetStyleUpdateConfirm();
      return;
    }

    if (!styleId) {
      saveStyleBtn.textContent = 'Save as style';
      saveStyleBtn.disabled = false;
      saveStyleBtn.classList.remove('popup__profile-btn--muted', 'popup__profile-btn--confirm');
      deleteStyleBtn.hidden = true;
      resetStyleUpdateConfirm();
      return;
    }

    saveStyleBtn.textContent = styleUpdateConfirmPending ? 'Sure?' : 'Update style';
    saveStyleBtn.disabled = !dirty && !styleUpdateConfirmPending;
    saveStyleBtn.classList.toggle('popup__profile-btn--muted', !dirty && !styleUpdateConfirmPending);
    saveStyleBtn.classList.toggle('popup__profile-btn--confirm', styleUpdateConfirmPending);
    deleteStyleBtn.hidden = false;
    deleteStyleBtn.disabled = false;
  }

  function syncPreviewLoop(): void {
    const theme = resolvedTheme();
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
        resolvedTheme(),
        activeAlignment,
        now,
        activeCustomBackgroundId(),
      );
    };
    previewRaf = requestAnimationFrame(tick);
  }

  async function refreshPreview(timeMs?: number): Promise<void> {
    const generation = ++renderGeneration;
    await renderThemePreview(
      previewCanvas,
      resolvedTheme(),
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
    activeAlignment = prefs.appearance.barAlignment ?? 'center';
    populateProfileSelect(profileSelect, prefs);
    populateDesignStudioStyleSelect(themeSelect, prefs);
    alignmentSelect.value = activeAlignment;
    syncProfileActions(prefs);
    syncStyleButton(prefs);
    colorPicker.sync(prefs.appearance.designOverrides);
    void personalBackground.sync(prefs);
    stopPreviewLoop();
    void refreshPreview();
  }

  const colorPicker = mountColorPickerControls(root, (overrides) => {
    resetProfileUpdateConfirm();
    resetStyleUpdateConfirm();
    void saveCustomStyleColors(overrides).then(applyPrefs);
  });

  const personalBackground = mountPersonalBackgroundControls(root, applyPrefs);

  profileSelect.addEventListener('change', () => {
    resetProfileUpdateConfirm();
    resetStyleUpdateConfirm();
    const value = profileSelect.value;
    if (value === PROFILE_SELECT_CUSTOM) {
      void saveAppearancePreferences({ activeProfileId: null }).then(applyPrefs);
      return;
    }
    void applyClipProfile(value).then(applyPrefs);
  });

  themeSelect.addEventListener('change', () => {
    resetProfileUpdateConfirm();
    resetStyleUpdateConfirm();
    const parsed = parseStyleSelectValue(themeSelect.value);
    if (parsed.kind === 'custom') {
      void enterCustomStyleMode().then(applyPrefs);
      return;
    }
    if (parsed.kind === 'saved') {
      void applyCustomClipStyle(parsed.styleId).then(applyPrefs);
      return;
    }
    void applyPresetClipStyle(parsed.themeId).then(applyPrefs);
  });

  alignmentSelect.addEventListener('change', () => {
    resetProfileUpdateConfirm();
    const alignment = alignmentSelect.value as BarAlignment;
    void saveAppearancePreferences({
      barAlignment: alignment,
    }).then(applyPrefs);
  });

  saveProfileBtn.addEventListener('click', () => {
    const profileId = activePrefs?.appearance.activeProfileId;
    if (profileId) {
      if (!isProfileDirty() && !profileUpdateConfirmPending) return;
      if (!profileUpdateConfirmPending) {
        profileUpdateConfirmPending = true;
        syncProfileButton(activePrefs!);
        return;
      }
      resetProfileUpdateConfirm();
      void updateActiveClipProfile()
        .then(applyPrefs)
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'Could not update profile.';
          window.alert(message);
        });
      return;
    }

    const name = window.prompt('Name this profile (style, alignment, and background):');
    if (name === null) return;
    void saveCurrentAsClipProfile(name)
      .then(applyPrefs)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Could not save profile.';
        window.alert(message);
      });
  });

  deleteProfileBtn.addEventListener('click', () => {
    resetProfileUpdateConfirm();
    const profileId = activePrefs?.appearance.activeProfileId;
    if (!profileId) return;
    const profileName = activeProfile()?.name ?? 'this profile';
    if (!window.confirm(`Delete "${profileName}"?`)) return;
    void deleteClipProfile(profileId).then(applyPrefs);
  });

  saveStyleBtn.addEventListener('click', () => {
    const styleId = activePrefs?.appearance.activeCustomStyleId;
    if (styleId) {
      if (!isCustomStyleDirty(activePrefs!.appearance) && !styleUpdateConfirmPending) return;
      if (!styleUpdateConfirmPending) {
        styleUpdateConfirmPending = true;
        syncStyleButton(activePrefs!);
        return;
      }
      resetStyleUpdateConfirm();
      void updateActiveCustomStyle()
        .then(applyPrefs)
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'Could not update style.';
          window.alert(message);
        });
      return;
    }

    const name = window.prompt('Name this custom style:');
    if (name === null) return;
    void saveCurrentAsCustomStyle(name)
      .then(applyPrefs)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Could not save style.';
        window.alert(message);
      });
  });

  deleteStyleBtn.addEventListener('click', () => {
    resetStyleUpdateConfirm();
    const styleId = activePrefs?.appearance.activeCustomStyleId;
    if (!styleId || !activePrefs) return;

    const styleName = activeCustomStyle()?.name ?? 'this style';
    const affectedProfiles = profilesAffectedByStyleDeletion(activePrefs, styleId);
    const profileWarning =
      affectedProfiles.length > 0
        ? ` Saved profiles using it (${affectedProfiles.join(', ')}) will revert to Classic.`
        : '';
    if (
      !window.confirm(
        `Delete "${styleName}"?${profileWarning}`,
      )
    ) {
      return;
    }
    void deleteCustomClipStyle(styleId).then(applyPrefs);
  });

  void loadUserPreferences().then(applyPrefs);

  const unsubscribe = onUserPreferencesChanged((prefs) => {
    resetProfileUpdateConfirm();
    resetStyleUpdateConfirm();
    applyPrefs(prefs);
  });

  return () => {
    stopPreviewLoop();
    unsubscribe();
  };
}