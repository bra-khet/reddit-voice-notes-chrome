import {
  backgroundIsBokeh,
  listThemePresets,
  renderThemePreview,
  resolveAppearanceTheme,
  themeHasAnimatedOverlay,
  userBackgroundLayoutFromAppearance,
  type BarAlignment,
} from '@/src/theme';
import {
  clipProfileMatchesLiveState,
  getClipProfileById,
  PROFILE_SELECT_CUSTOM,
} from '@/src/settings/clip-profiles';
import { isPresetProfileId } from '@/src/settings/preset-profiles';
import {
  getCustomStyleById,
  isCustomStyleDirty,
  parseStyleSelectValue,
  profilesAffectedByStyleDeletion,
  resolveStyleSelectValue,
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
import type { DesignOverrides } from '@/src/theme/design-overrides';
import { populateProfileSelect } from '@/src/ui/clip-style-select';
import {
  mountColorPickerControls,
  renderColorPickerFields,
} from '@/src/ui/design-studio/color-picker';
import {
  mountBackgroundFlairControls,
  mountBarGlowControl,
  renderBackgroundFlairFields,
  renderBarGlowField,
} from '@/src/ui/design-studio/effect-controls';
import {
  mountBackgroundLayoutControls,
  renderBackgroundLayoutFields,
} from '@/src/ui/design-studio/background-layout-controls';
import {
  mountSubtitleControls,
  renderSubtitleControlFields,
} from '@/src/ui/design-studio/subtitle-controls';
import {
  mountVoiceControls,
  renderVoiceControlFields,
} from '@/src/ui/design-studio/voice-controls';
import {
  mountPersonalBackgroundControls,
  renderPersonalBackgroundFields,
} from '@/src/ui/popup/personal-background';
import {
  isStylePanelVisible,
  populateDesignStudioStyleSelect,
} from '@/src/ui/style-select';
import { renderPreviewBlock } from '@/src/ui/design-studio/preview-block';
import { syncStudioSectionSummaries } from '@/src/ui/design-studio/studio-section-summaries';
import {
  discardStudioUnsavedChanges,
  hasStudioUnsavedChanges,
  saveStudioUnsavedChanges,
  shouldPromptStyleSaveWithProfileUpdate,
  updateActiveClipProfileWithStyleOption,
} from '@/src/ui/design-studio/studio-exit';
import {
  canForkActiveProfile,
  canForkActiveStyle,
  CLONE_LABEL,
  forkActiveClipProfileFromStudio,
  forkButtonLabel,
  promptNameForFork,
} from '@/src/ui/design-studio/studio-save-pathways';
import type { AppearancePreferences } from '@/src/settings/user-preferences';

const ALIGNMENT_OPTIONS: { value: BarAlignment; label: string }[] = [
  { value: 'top', label: 'Top' },
  { value: 'center', label: 'Center (mirrored)' },
  { value: 'bottom', label: 'Bottom' },
];

const COLOR_SAVE_DEBOUNCE_MS = 200;

export type MountClipStudioOptions = {
  /** Reconciled prefs from boot — avoids racing storage listeners before first paint (BUG-023). */
  initialPrefs?: UserPreferencesV1;
};

export function mountClipStudio(root: HTMLElement, options?: MountClipStudioOptions): () => void {
  root.innerHTML = `
    <main class="studio">
      <header class="studio__header">
        <div class="studio__header-row">
          <div>
            <h1 class="studio__title">Design Studio</h1>
            <p class="studio__subtitle">Clip appearance — preview matches your recorded video.</p>
          </div>
          <button type="button" class="popup__profile-btn popup__profile-btn--save studio__done-btn" data-studio-done>
            Done
          </button>
        </div>
      </header>
      <div class="studio__exit-modal" data-exit-modal hidden>
        <div class="studio__exit-dialog" role="dialog" aria-labelledby="studio-exit-title">
          <h2 class="studio__exit-title" id="studio-exit-title">Unsaved changes</h2>
          <p class="studio__exit-copy">
            Your profile, voice, or custom style has edits that are not saved. Save them before leaving?
          </p>
          <div class="studio__exit-actions">
            <button type="button" class="popup__profile-btn popup__profile-btn--save" data-exit-save>
              Save changes
            </button>
            <button type="button" class="popup__profile-btn popup__profile-btn--delete" data-exit-discard>
              Discard
            </button>
            <button type="button" class="popup__button popup__button--secondary studio__exit-cancel" data-exit-cancel>
              Keep editing
            </button>
          </div>
        </div>
      </div>
      <section class="studio__profile-bar">
        <label class="studio__profile-bar-field">
          <span class="studio__profile-bar-label">Profile</span>
          <select class="popup__select studio__profile-bar-select" data-profile-select aria-label="Saved profile"></select>
        </label>
        <div class="studio__profile-bar-actions">
          <button type="button" class="popup__profile-btn popup__profile-btn--save" data-save-profile>
            Save as profile
          </button>
          <button
            type="button"
            class="popup__profile-btn popup__profile-btn--save-new"
            data-save-profile-new
            hidden
          >
            ${CLONE_LABEL}
          </button>
          <button type="button" class="popup__profile-btn popup__profile-btn--delete" data-delete-profile hidden>
            Delete
          </button>
        </div>
      </section>
      ${renderPreviewBlock('primary')}
      <!-- V4 NOTE: Collapsible panels below — Subtitles/Captions panel will sit in this stack as topmost foreground layer. -->
      <details class="studio__panel" data-studio-panel="bar-style">
        <summary class="studio__panel-summary">
          <span class="studio__panel-title">Bar style</span>
          <span class="studio__panel-meta" data-summary-bar-style></span>
          <span class="studio__panel-chevron" aria-hidden="true"></span>
        </summary>
        <div class="studio__panel-body">
          <label class="popup__field studio__field--compact">
            <span class="popup__field-label">Clip style</span>
            <select class="popup__select" data-theme-select aria-label="Clip style"></select>
          </label>
          <div data-custom-style-panel hidden>
            ${renderColorPickerFields()}
            <div class="popup__profile-actions studio__inline-actions">
              <button type="button" class="popup__profile-btn popup__profile-btn--save" data-save-style>
                Save as style
              </button>
              <button
                type="button"
                class="popup__profile-btn popup__profile-btn--save-new"
                data-save-style-new
                hidden
              >
                ${CLONE_LABEL}
              </button>
              <button type="button" class="popup__profile-btn popup__profile-btn--delete" data-delete-style hidden>
                Delete style
              </button>
            </div>
          </div>
          <label class="popup__field studio__field--compact">
            <span class="popup__field-label">Bar alignment</span>
            <select class="popup__select" data-alignment-select aria-label="Bar alignment"></select>
          </label>
          <div class="studio__subsection studio__subsection--effects">
            <h3 class="studio__subsection-title">Effects</h3>
            ${renderBarGlowField()}
            ${renderBackgroundFlairFields()}
          </div>
        </div>
      </details>
      <details class="studio__panel" data-studio-panel="background">
        <summary class="studio__panel-summary">
          <span class="studio__panel-title">Background</span>
          <span class="studio__panel-meta" data-summary-background></span>
          <span class="studio__panel-chevron" aria-hidden="true"></span>
        </summary>
        <div class="studio__panel-body">
          ${renderPersonalBackgroundFields()}
          ${renderBackgroundLayoutFields()}
        </div>
      </details>
      <details class="studio__panel" data-studio-panel="voice">
        <summary class="studio__panel-summary">
          <span class="studio__panel-title">Voice</span>
          <span class="studio__panel-meta" data-summary-voice></span>
          <span class="studio__panel-chevron" aria-hidden="true"></span>
        </summary>
        <div class="studio__panel-body">
          ${renderVoiceControlFields()}
        </div>
      </details>
      <details class="studio__panel" data-studio-panel="subtitles">
        <summary class="studio__panel-summary">
          <span class="studio__panel-title">Subtitles</span>
          <span class="studio__panel-meta" data-summary-subtitles></span>
          <span class="studio__panel-chevron" aria-hidden="true"></span>
        </summary>
        <div class="studio__panel-body">
          ${renderSubtitleControlFields()}
        </div>
      </details>
      <p class="studio__footer-note">
        Changes apply live to the recorder. <strong>Clone</strong> then edit, or edit then
        <strong>Save to new</strong> — both reach the same fork. <strong>Update</strong> overwrites
        the selected saved profile or style.
      </p>
    </main>
  `;

  const previewCanvases = () =>
    [...root.querySelectorAll<HTMLCanvasElement>('[data-preview-canvas]')];
  const profileSelect = root.querySelector<HTMLSelectElement>('[data-profile-select]')!;
  const themeSelect = root.querySelector<HTMLSelectElement>('[data-theme-select]')!;
  const alignmentSelect = root.querySelector<HTMLSelectElement>('[data-alignment-select]')!;
  const customStylePanel = root.querySelector<HTMLElement>('[data-custom-style-panel]')!;
  const saveProfileBtn = root.querySelector<HTMLButtonElement>('[data-save-profile]')!;
  const saveProfileNewBtn = root.querySelector<HTMLButtonElement>('[data-save-profile-new]')!;
  const deleteProfileBtn = root.querySelector<HTMLButtonElement>('[data-delete-profile]')!;
  const saveStyleBtn = root.querySelector<HTMLButtonElement>('[data-save-style]')!;
  const saveStyleNewBtn = root.querySelector<HTMLButtonElement>('[data-save-style-new]')!;
  const deleteStyleBtn = root.querySelector<HTMLButtonElement>('[data-delete-style]')!;
  const doneBtn = root.querySelector<HTMLButtonElement>('[data-studio-done]')!;
  const exitModal = root.querySelector<HTMLElement>('[data-exit-modal]')!;
  const exitSaveBtn = root.querySelector<HTMLButtonElement>('[data-exit-save]')!;
  const exitDiscardBtn = root.querySelector<HTMLButtonElement>('[data-exit-discard]')!;
  const exitCancelBtn = root.querySelector<HTMLButtonElement>('[data-exit-cancel]')!;

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
  let studioSaveGeneration = 0;
  let ignoreStoragePrefs = false;
  let colorSaveTimer = 0;
  let entryAppearance: AppearancePreferences | null = null;
  let allowStudioExit = false;
  let prefsHydrated = false;
  let voiceControls!: ReturnType<typeof mountVoiceControls>;
  let subtitleControls!: ReturnType<typeof mountSubtitleControls>;
  const PREVIEW_ANIM_FPS = 12;

  function cancelPendingColorSave(): void {
    if (colorSaveTimer) {
      window.clearTimeout(colorSaveTimer);
      colorSaveTimer = 0;
    }
  }

  function invalidateInFlightSaves(): void {
    studioSaveGeneration += 1;
    cancelPendingColorSave();
  }

  function runStudioPersist(
    label: string,
    saveFn: () => Promise<UserPreferencesV1>,
  ): void {
    void studioPersist(saveFn).catch((error: unknown) => {
      console.error(`[Reddit Voice Notes] ${label}`, error);
      const message = error instanceof Error ? error.message : 'Could not save changes.';
      window.alert(message);
    });
  }

  async function studioPersist(
    saveFn: () => Promise<UserPreferencesV1>,
  ): Promise<UserPreferencesV1 | undefined> {
    const generation = ++studioSaveGeneration;
    ignoreStoragePrefs = true;
    try {
      const prefs = await saveFn();
      if (generation !== studioSaveGeneration) return undefined;
      applyPrefs(prefs);
      return prefs;
    } finally {
      requestAnimationFrame(() => {
        if (generation === studioSaveGeneration) {
          ignoreStoragePrefs = false;
        }
      });
    }
  }

  function stopPreviewLoop(): void {
    if (previewRaf) cancelAnimationFrame(previewRaf);
    previewRaf = 0;
    lastPreviewFrame = 0;
  }

  function activeCustomBackgroundId(): string | null {
    return activePrefs?.appearance.customBackgroundId ?? null;
  }

  function activeBackgroundLayout() {
    return userBackgroundLayoutFromAppearance(activePrefs?.appearance ?? {});
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
    const transcriptForMatch =
      typeof subtitleControls?.getProfileSnapshotConfig === 'function'
        ? subtitleControls.getProfileSnapshotConfig()
        : activePrefs.transcriptConfig;
    return !clipProfileMatchesLiveState(
      activePrefs.appearance,
      activePrefs.voiceEffect,
      transcriptForMatch,
      profile,
    );
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

    if (!profileId || isPresetProfileId(profileId)) {
      saveProfileBtn.textContent = 'Save as profile';
      saveProfileBtn.disabled = false;
      saveProfileBtn.classList.remove('popup__profile-btn--muted', 'popup__profile-btn--confirm');
      saveProfileNewBtn.hidden = true;
      resetProfileUpdateConfirm();
      return;
    }

    saveProfileBtn.textContent = profileUpdateConfirmPending ? 'Sure?' : 'Update profile';
    saveProfileBtn.disabled = !dirty && !profileUpdateConfirmPending;
    saveProfileBtn.classList.toggle('popup__profile-btn--muted', !dirty && !profileUpdateConfirmPending);
    saveProfileBtn.classList.toggle('popup__profile-btn--confirm', profileUpdateConfirmPending);
    saveProfileNewBtn.hidden = false;
    saveProfileNewBtn.disabled = false;
    saveProfileNewBtn.textContent = forkButtonLabel(dirty);
  }

  function syncStyleButton(prefs: UserPreferencesV1): void {
    const styleId = prefs.appearance.activeCustomStyleId;
    const dirty = isCustomStyleDirty(prefs.appearance);
    const showPanel = isStylePanelVisible(prefs);

    customStylePanel.hidden = !showPanel;
    if (!showPanel) {
      saveStyleNewBtn.hidden = true;
      resetStyleUpdateConfirm();
      return;
    }

    if (!styleId) {
      saveStyleBtn.textContent = 'Save as style';
      saveStyleBtn.disabled = false;
      saveStyleBtn.classList.remove('popup__profile-btn--muted', 'popup__profile-btn--confirm');
      saveStyleNewBtn.hidden = true;
      deleteStyleBtn.hidden = true;
      resetStyleUpdateConfirm();
      return;
    }

    saveStyleBtn.textContent = styleUpdateConfirmPending ? 'Sure?' : 'Update style';
    saveStyleBtn.disabled = !dirty && !styleUpdateConfirmPending;
    saveStyleBtn.classList.toggle('popup__profile-btn--muted', !dirty && !styleUpdateConfirmPending);
    saveStyleBtn.classList.toggle('popup__profile-btn--confirm', styleUpdateConfirmPending);
    saveStyleNewBtn.hidden = false;
    saveStyleNewBtn.disabled = false;
    saveStyleNewBtn.textContent = forkButtonLabel(dirty);
    deleteStyleBtn.hidden = false;
    deleteStyleBtn.disabled = false;
  }

  function syncPreviewLoop(): void {
    const theme = resolvedTheme();
    const presetBokeh = backgroundIsBokeh(theme.background);
    const animatedOverlay = themeHasAnimatedOverlay(theme);
    const shouldAnimate = presetBokeh || animatedOverlay;
    if (activePrefs && shouldReduceMotion(activePrefs)) {
      stopPreviewLoop();
      return;
    }
    if (!shouldAnimate) {
      stopPreviewLoop();
      return;
    }
    if (previewRaf) return;

    const tick = (now: number): void => {
      previewRaf = requestAnimationFrame(tick);
      if (now - lastPreviewFrame < 1000 / PREVIEW_ANIM_FPS) return;
      lastPreviewFrame = now;
      const subtitlePreview = subtitleControls?.getPreviewOptions();
      for (const canvas of previewCanvases()) {
        void renderThemePreview(
          canvas,
          resolvedTheme(),
          activeAlignment,
          now,
          activeCustomBackgroundId(),
          activeBackgroundLayout(),
          subtitlePreview,
        );
      }
    };
    previewRaf = requestAnimationFrame(tick);
  }

  async function refreshPreview(timeMs?: number): Promise<void> {
    const generation = ++renderGeneration;
    const subtitlePreview = subtitleControls?.getPreviewOptions();
    for (const canvas of previewCanvases()) {
      await renderThemePreview(
        canvas,
        resolvedTheme(),
        activeAlignment,
        timeMs,
        activeCustomBackgroundId(),
        activeBackgroundLayout(),
        subtitlePreview,
      );
    }
    if (generation !== renderGeneration) return;
    syncPreviewLoop();
  }

  function syncProfileActions(prefs: UserPreferencesV1): void {
    const profileId = prefs.appearance.activeProfileId;
    const hasSavedProfile = Boolean(profileId && !isPresetProfileId(profileId));
    deleteProfileBtn.hidden = !hasSavedProfile;
    deleteProfileBtn.disabled = !hasSavedProfile;
    syncProfileButton(prefs);
  }

  function syncSelectControls(prefs: UserPreferencesV1): void {
    populateProfileSelect(profileSelect, prefs);
    populateDesignStudioStyleSelect(themeSelect, prefs);
    activeAlignment = prefs.appearance.barAlignment ?? 'center';
    alignmentSelect.value = activeAlignment;
  }

  function hasPendingColorEdit(): boolean {
    return colorSaveTimer !== 0 || colorPicker.isUserAdjusting();
  }

  function mergePendingColorState(prefs: UserPreferencesV1): UserPreferencesV1 {
    if (!activePrefs || !hasPendingColorEdit()) return prefs;
    // BUG FIX: profile switch showed wrong / missing custom colors (BUG-022)
    // Fix: never keep a color draft when storage already points at a different profile.
    if (prefs.appearance.activeProfileId !== activePrefs.appearance.activeProfileId) {
      cancelPendingColorSave();
      colorPicker.endInteraction();
      return prefs;
    }
    return {
      ...prefs,
      appearance: {
        ...prefs.appearance,
        activeThemeId: activePrefs.appearance.activeThemeId,
        activeCustomStyleId: activePrefs.appearance.activeCustomStyleId,
        designOverrides: activePrefs.appearance.designOverrides,
      },
    };
  }

  function syncStyleControlsFromPrefs(prefs: UserPreferencesV1, forceColorSync = false): void {
    backgroundFlairControls.sync(prefs.appearance.designOverrides);

    if (!isStylePanelVisible(prefs)) return;

    if (forceColorSync || !colorPicker.isUserAdjusting()) {
      colorPicker.endInteraction();
      colorPicker.sync(prefs.appearance.designOverrides);
      barGlowControl.sync(prefs.appearance.designOverrides);
    }
  }

  function applyLocalDesignOverrides(overrides: DesignOverrides): void {
    if (!activePrefs) return;
    activePrefs = {
      ...activePrefs,
      appearance: {
        ...activePrefs.appearance,
        designOverrides: overrides,
      },
    };
    resetProfileUpdateConfirm();
    resetStyleUpdateConfirm();
    syncProfileButton(activePrefs);
    syncStyleButton(activePrefs);
    stopPreviewLoop();
    void refreshPreview();
  }

  function scheduleDesignPersist(overrides: DesignOverrides): void {
    cancelPendingColorSave();
    colorSaveTimer = window.setTimeout(() => {
      colorSaveTimer = 0;
      void studioPersist(() => saveCustomStyleColors(overrides));
    }, COLOR_SAVE_DEBOUNCE_MS);
  }

  function mergeDesignOverrides(
    patch: Partial<DesignOverrides>,
  ): DesignOverrides | null {
    const current = activePrefs?.appearance.designOverrides;
    const barColor =
      patch.barColor ?? current?.barColor ?? (activePrefs ? resolvedTheme().colors.bar : undefined);
    if (!barColor) return null;
    return {
      barColor,
      glowColor: patch.glowColor ?? current?.glowColor,
      backgroundEffect: patch.backgroundEffect ?? current?.backgroundEffect ?? 'none',
      barGlow: patch.barGlow ?? current?.barGlow ?? 'default',
    };
  }

  async function flushPendingDesignPersist(): Promise<void> {
    if (!colorSaveTimer || !activePrefs?.appearance.designOverrides) return;
    cancelPendingColorSave();
    const overrides = activePrefs.appearance.designOverrides;
    await studioPersist(() => saveCustomStyleColors(overrides));
  }

  function showExitModal(): void {
    exitModal.hidden = false;
  }

  function hideExitModal(): void {
    exitModal.hidden = true;
  }

  async function closeStudioAfterSave(): Promise<void> {
    allowStudioExit = true;
    hideExitModal();
    window.close();
  }

  async function attemptStudioExit(): Promise<void> {
    await flushPendingDesignPersist();
    await subtitleControls.flushPersist();
    if (!activePrefs || !hasStudioUnsavedChanges(activePrefs)) {
      allowStudioExit = true;
      window.close();
      return;
    }
    showExitModal();
  }

  function syncSectionSummaries(): void {
    if (!activePrefs) return;
    syncStudioSectionSummaries(root, {
      prefs: activePrefs,
      voiceDraft: voiceControls.getDraftConfig(),
      subtitleDraft: subtitleControls.getDraftConfig(),
    });
  }

  function applyPrefs(prefs: UserPreferencesV1, opts?: { captureEntry?: boolean }): void {
    activePrefs = prefs;
    // BUG FIX: profile UI stale while rvnUserPrefs correct (BUG-023)
    // Fix: capture exit baseline only after reconciled boot prefs — not a racing first listener pass.
    if (!entryAppearance || opts?.captureEntry) {
      entryAppearance = structuredClone(prefs.appearance);
    }
    syncSelectControls(prefs);
    syncProfileActions(prefs);
    syncStyleButton(prefs);
    syncStyleControlsFromPrefs(prefs, true);

    void personalBackground.sync(prefs);
    backgroundLayout.sync(prefs);
    voiceControls.syncFromPreferences(prefs);
    subtitleControls.syncFromPreferences(prefs);
    syncSectionSummaries();
    stopPreviewLoop();
    void refreshPreview();
  }

  const colorPicker = mountColorPickerControls(root, (overrides) => {
    const merged = mergeDesignOverrides(overrides);
    if (!merged) return;
    applyLocalDesignOverrides(merged);
    syncSectionSummaries();
    scheduleDesignPersist(merged);
  });

  const backgroundFlairControls = mountBackgroundFlairControls(root, (backgroundEffect) => {
    const merged = mergeDesignOverrides({ backgroundEffect });
    if (!merged) return;
    applyLocalDesignOverrides(merged);
    syncSectionSummaries();
    scheduleDesignPersist(merged);
  });

  const barGlowControl = mountBarGlowControl(root, (barGlow) => {
    const merged = mergeDesignOverrides({ barGlow });
    if (!merged) return;
    applyLocalDesignOverrides(merged);
    syncSectionSummaries();
    scheduleDesignPersist(merged);
  });

  const personalBackground = mountPersonalBackgroundControls(root, (prefs) => {
    invalidateInFlightSaves();
    ignoreStoragePrefs = true;
    applyPrefs(prefs);
    requestAnimationFrame(() => {
      ignoreStoragePrefs = false;
    });
  });

  const backgroundLayout = mountBackgroundLayoutControls(root, (patch) => {
    invalidateInFlightSaves();
    resetProfileUpdateConfirm();
    void studioPersist(() => saveAppearancePreferences(patch));
  });

  voiceControls = mountVoiceControls(root, () => {
    syncSectionSummaries();
  });

  subtitleControls = mountSubtitleControls(root, {
    onSettingsChange: () => {
      syncSectionSummaries();
      if (activePrefs) {
        syncProfileActions(activePrefs);
      }
    },
    onPreviewChange: () => {
      stopPreviewLoop();
      void refreshPreview();
    },
  });

  profileSelect.addEventListener('change', () => {
    invalidateInFlightSaves();
    resetProfileUpdateConfirm();
    resetStyleUpdateConfirm();
    const value = profileSelect.value;
    if (value === PROFILE_SELECT_CUSTOM) {
      runStudioPersist('Profile custom mode', () => saveAppearancePreferences({ activeProfileId: null }));
      return;
    }
    runStudioPersist('Apply profile', () => applyClipProfile(value));
  });

  themeSelect.addEventListener('change', () => {
    invalidateInFlightSaves();
    resetProfileUpdateConfirm();
    resetStyleUpdateConfirm();
    const parsed = parseStyleSelectValue(themeSelect.value);
    if (parsed.kind === 'custom') {
      runStudioPersist('Enter custom style', () => enterCustomStyleMode());
      return;
    }
    if (parsed.kind === 'saved') {
      runStudioPersist('Apply custom style', () => applyCustomClipStyle(parsed.styleId));
      return;
    }
    runStudioPersist('Apply clip preset', () => applyPresetClipStyle(parsed.themeId));
  });

  alignmentSelect.addEventListener('change', () => {
    invalidateInFlightSaves();
    resetProfileUpdateConfirm();
    const alignment = alignmentSelect.value as BarAlignment;
    runStudioPersist('Bar alignment', () =>
      saveAppearancePreferences({
        barAlignment: alignment,
      }),
    );
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
      invalidateInFlightSaves();

      let saveStyleFirst = false;
      if (activePrefs && shouldPromptStyleSaveWithProfileUpdate(activePrefs)) {
        const styleName = activeCustomStyle()?.name ?? 'This style';
        saveStyleFirst = window.confirm(
          `"${styleName}" has unsaved color edits. Save the style changes too, then update this profile?`,
        );
      }

      void studioPersist(() => updateActiveClipProfileWithStyleOption(saveStyleFirst))
        .then((prefs) => {
          if (prefs) resetStyleUpdateConfirm();
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'Could not update profile.';
          window.alert(message);
        });
      return;
    }

    const name = window.prompt('Name this profile (style, alignment, and background):');
    if (name === null) return;
    invalidateInFlightSaves();
    void studioPersist(() => saveCurrentAsClipProfile(name)).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Could not save profile.';
      window.alert(message);
    });
  });

  saveProfileNewBtn.addEventListener('click', () => {
    if (!activePrefs || !canForkActiveProfile(activePrefs)) return;
    const dirty = isProfileDirty();
    void flushPendingDesignPersist().then(async () => {
      resetProfileUpdateConfirm();
      resetStyleUpdateConfirm();
      invalidateInFlightSaves();

      const profileName = promptNameForFork('profile', !dirty);
      if (profileName === null) return;

      await studioPersist(() => forkActiveClipProfileFromStudio(activePrefs!, profileName, dirty));
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      const message = error instanceof Error ? error.message : 'Could not save profile.';
      window.alert(message);
    });
  });

  deleteProfileBtn.addEventListener('click', () => {
    resetProfileUpdateConfirm();
    invalidateInFlightSaves();
    const profileId = activePrefs?.appearance.activeProfileId;
    if (!profileId) return;
    const profileName = activeProfile()?.name ?? 'this profile';
    if (!window.confirm(`Delete "${profileName}"?`)) return;
    void studioPersist(() => deleteClipProfile(profileId));
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
      invalidateInFlightSaves();
      void studioPersist(() => updateActiveCustomStyle()).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Could not update style.';
        window.alert(message);
      });
      return;
    }

    const name = window.prompt('Name this custom style:');
    if (name === null) return;
    invalidateInFlightSaves();
    void studioPersist(() => saveCurrentAsCustomStyle(name)).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Could not save style.';
      window.alert(message);
    });
  });

  saveStyleNewBtn.addEventListener('click', () => {
    if (!activePrefs || !canForkActiveStyle(activePrefs)) return;
    const dirty = isCustomStyleDirty(activePrefs.appearance);
    void flushPendingDesignPersist().then(async () => {
      resetStyleUpdateConfirm();
      resetProfileUpdateConfirm();
      invalidateInFlightSaves();

      const name = promptNameForFork('style', !dirty);
      if (name === null) return;

      await studioPersist(() => saveCurrentAsCustomStyle(name));
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Could not save style.';
      window.alert(message);
    });
  });

  deleteStyleBtn.addEventListener('click', () => {
    resetStyleUpdateConfirm();
    invalidateInFlightSaves();
    const styleId = activePrefs?.appearance.activeCustomStyleId;
    if (!styleId || !activePrefs) return;

    const styleName = activeCustomStyle()?.name ?? 'this style';
    const affectedProfiles = profilesAffectedByStyleDeletion(activePrefs, styleId);
    const profileWarning =
      affectedProfiles.length > 0
        ? ` Saved profiles using it (${affectedProfiles.join(', ')}) will revert to Classic.`
        : '';
    if (!window.confirm(`Delete "${styleName}"?${profileWarning}`)) {
      return;
    }
    void studioPersist(() => deleteCustomClipStyle(styleId));
  });

  doneBtn.addEventListener('click', () => {
    void attemptStudioExit();
  });

  exitCancelBtn.addEventListener('click', () => {
    hideExitModal();
  });

  exitDiscardBtn.addEventListener('click', () => {
    if (!entryAppearance) return;
    allowStudioExit = true;
    hideExitModal();
    void discardStudioUnsavedChanges(entryAppearance).finally(() => {
      window.close();
    });
  });

  exitSaveBtn.addEventListener('click', () => {
    void flushPendingDesignPersist()
      .then(() => saveStudioUnsavedChanges())
      .then(() => closeStudioAfterSave())
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Could not save changes.';
        window.alert(message);
      });
  });

  const beforeUnloadHandler = (event: BeforeUnloadEvent): void => {
    if (allowStudioExit || !activePrefs || !hasStudioUnsavedChanges(activePrefs)) return;
    event.preventDefault();
    event.returnValue = '';
  };

  const pageHideHandler = (): void => {
    // CHANGED: flush global subtitle prefs before the studio tab is torn down.
    // WHY: chrome.storage.local.set is async; unload alone is not reliable (BUG-017).
    void subtitleControls.flushPersist();
    if (allowStudioExit || !entryAppearance || !activePrefs) return;
    if (!hasStudioUnsavedChanges(activePrefs)) return;
    void discardStudioUnsavedChanges(entryAppearance);
  };

  window.addEventListener('beforeunload', beforeUnloadHandler);
  window.addEventListener('pagehide', pageHideHandler);

  async function hydratePrefs(prefs: UserPreferencesV1): Promise<void> {
    applyPrefs(prefs, { captureEntry: true });
    prefsHydrated = true;
  }

  if (options?.initialPrefs) {
    void hydratePrefs(options.initialPrefs);
  } else {
    void loadUserPreferences().then((prefs) => hydratePrefs(prefs));
  }

  const unsubscribe = onUserPreferencesChanged((prefs) => {
    if (!prefsHydrated || ignoreStoragePrefs) return;
    resetProfileUpdateConfirm();
    resetStyleUpdateConfirm();
    applyPrefs(mergePendingColorState(prefs));
  });

  return () => {
    cancelPendingColorSave();
    stopPreviewLoop();
    voiceControls.dispose();
    subtitleControls.dispose();
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    window.removeEventListener('pagehide', pageHideHandler);
    unsubscribe();
  };
}