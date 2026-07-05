import {
  backgroundIsBokeh,
  listThemePresets,
  renderThemePreview,
  resolveAppearanceTheme,
  themeHasAnimatedOverlay,
  userBackgroundLayoutFromAppearance,
  type BarAlignment,
} from '@/src/theme';
import { isAnimatedBackgroundCached } from '@/src/storage/background-loader';
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
import { drawSubtitleTextOnlyPreview } from '@/src/transcription/subtitle-preview';
import { loadDejaVuPreviewFonts } from '@/src/ui/design-studio/preview-font-loader';
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
import { renderStudioV4PanelCard } from '@/src/ui/design-studio/studio-v4-panel-summary';
import { applyStudioV4ShellChrome } from '@/src/ui/design-studio/studio-v4-shell';
import {
  mountWorkflowBanner,
  type WorkflowBannerHandle,
} from '@/src/ui/design-studio/workflow-phase-banner';
import type { WorkflowPhase } from '@/src/workflow/workflow-state';
import {
  mountStudioV4SubpanelShell,
  renderStudioV4SubpanelChrome,
  renderStudioV4SubpanelShell,
  type StudioSubpanelShellHandle,
} from '@/src/ui/design-studio/studio-v4-subpanel-shell';
import { syncStudioSectionSummaries } from '@/src/ui/design-studio/studio-section-summaries';
import { syncStudioStatusStrip } from '@/src/ui/design-studio/studio-status-strip';
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
import { getTakeManager } from '@/src/session/take-manager';
import {
  mountCurrentTakeDeck,
  renderCurrentTakeDeck,
  type CurrentTakeDeckHandle,
} from '@/src/ui/design-studio/current-take-status';
import { mountStudioRecorder } from '@/src/ui/design-studio/studio-recorder';
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
  /** Workflow phase from boot — avoids banner flash on first paint. */
  initialWorkflowPhase?: WorkflowPhase;
};

export function mountClipStudio(root: HTMLElement, options?: MountClipStudioOptions): () => void {
  root.innerHTML = `
    <main class="studio studio-v4">
      <header class="studio__header" data-studio-main-header>
        <div class="studio__header-row">
          <div>
            <h1 class="studio__title">Design Studio</h1>
            <p class="studio__subtitle">Style your clip's look, voice, and captions — the live preview matches your export.</p>
          </div>
          <button type="button" class="popup__profile-btn popup__profile-btn--save studio__done-btn" data-studio-done>
            Done
          </button>
        </div>
      </header>
      ${renderStudioV4SubpanelChrome()}
      <div class="studio__workflow-banner" role="region" data-workflow-banner aria-label="Workflow guidance"></div>
      <div class="studio__exit-modal" data-exit-modal hidden>
        <div class="studio__exit-dialog" role="dialog" aria-labelledby="studio-exit-title">
          <h2 class="studio__exit-title" id="studio-exit-title">Unsaved changes</h2>
          <p class="studio__exit-copy">
            Your profile, voice, or custom style has edits that are not saved. Save them before leaving?
          </p>
          <div class="studio__exit-actions studio-v4__guard-actions">
            <button type="button" class="popup__button popup__button--secondary studio__exit-cancel studio-v4__guard-cancel" data-exit-cancel>
              Keep editing
            </button>
            <button type="button" class="popup__profile-btn popup__profile-btn--delete studio-v4__guard-discard" data-exit-discard>
              Discard
            </button>
            <button type="button" class="popup__profile-btn popup__profile-btn--save studio-v4__guard-apply" data-exit-save>
              Save changes
            </button>
          </div>
        </div>
      </div>
      <div class="studio__layout">
        <div class="studio__layout-main" data-studio-layout-main>
        <div class="studio__hero">
          ${renderCurrentTakeDeck()}
          <div class="studio__profile-cluster">
            <div class="studio__profile-cluster-head">
              <img class="studio__profile-cluster-icon studio-v4__icon studio-v4__icon--32" alt="" width="32" height="32" />
              <h2 class="studio__profile-cluster-title">Profile &amp; status</h2>
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
            <div class="studio__status-strip" data-studio-status-strip aria-live="polite"></div>
          </div>
          ${renderPreviewBlock('primary')}
        </div>
        <div class="studio__panel-strip">
      <section class="studio__panel studio-v4__status-card" data-studio-panel="bar-style">
        ${renderStudioV4PanelCard('Bar style', 'data-summary-bar-style', 'bar-style')}
        <div class="studio__panel-body" hidden>
          ${renderPreviewBlock('subpanel')}
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
      </section>
      <section class="studio__panel studio-v4__status-card" data-studio-panel="background">
        ${renderStudioV4PanelCard('Background', 'data-summary-background', 'background')}
        <div class="studio__panel-body" hidden>
          ${renderPreviewBlock('subpanel')}
          ${renderPersonalBackgroundFields()}
          ${renderBackgroundLayoutFields()}
        </div>
      </section>
      <section class="studio__panel studio-v4__status-card" data-studio-panel="voice">
        ${renderStudioV4PanelCard('Voice', 'data-summary-voice', 'voice')}
        <div class="studio__panel-body" hidden>
          ${renderVoiceControlFields()}
        </div>
      </section>
      <section class="studio__panel studio-v4__status-card" data-studio-panel="subtitles">
        ${renderStudioV4PanelCard('Subtitles', 'data-summary-subtitles', 'subtitles')}
        <div class="studio__panel-body" hidden>
          ${renderSubtitleControlFields()}
        </div>
      </section>
        </div>
      <p class="studio__footer-note">
        Changes apply live to the recorder. <strong>Clone</strong> then edit, or edit then
        <strong>Save to new</strong> — both reach the same fork. <strong>Update</strong> overwrites
        the selected saved profile or style.
      </p>
        </div>
        ${renderStudioV4SubpanelShell()}
      </div>
    </main>
  `;

  const studioShell = root.querySelector<HTMLElement>('.studio-v4')!;
  applyStudioV4ShellChrome(studioShell);

  // v5.4.0: reactive current-take state — cross-context via storage.onChanged
  // inside the manager; drives the hero Current Take deck (Phase 1).
  // The initial emit is async, so takeDeck is always assigned before it fires.
  let takeDeck: CurrentTakeDeckHandle | null = null;
  let auditionActive = false;
  const takeUnsub = getTakeManager().subscribe((take) => {
    takeDeck?.update(take);
  });

  // v5.4.0 Phase 2: live audition — the WaveformRenderer canvas (the exact
  // pixels MediaRecorder encodes) replaces the static theme preview in the
  // hero monitor. "PREVIEW = OUTPUT" becomes literal while recording.
  let liveAuditionCanvas: HTMLCanvasElement | null = null;
  let savedPreviewLabel: string | null = null;

  function setLivePreviewCanvas(canvas: HTMLCanvasElement | null): void {
    const wrap = root.querySelector<HTMLElement>('.studio__hero .studio__preview-wrap');
    if (!wrap) return;
    const staticCanvas = wrap.querySelector<HTMLCanvasElement>('[data-preview-canvas]');
    const label = wrap.querySelector<HTMLElement>('.studio__preview-label');
    if (canvas) {
      liveAuditionCanvas = canvas;
      canvas.classList.add('studio__preview-canvas', 'studio__preview-canvas--live');
      if (staticCanvas) staticCanvas.style.visibility = 'hidden';
      wrap.appendChild(canvas);
      wrap.classList.add('studio__preview-wrap--audition');
      if (label) {
        savedPreviewLabel = label.textContent;
        label.textContent = 'LIVE MIC';
      }
    } else {
      liveAuditionCanvas?.remove();
      liveAuditionCanvas = null;
      if (staticCanvas) staticCanvas.style.visibility = '';
      wrap.classList.remove('studio__preview-wrap--audition');
      if (label && savedPreviewLabel !== null) {
        label.textContent = savedPreviewLabel;
        savedPreviewLabel = null;
      }
    }
  }

  const previewCanvases = () =>
    [...root.querySelectorAll<HTMLCanvasElement>('[data-preview-canvas]')].filter(
      (canvas) => canvas.dataset.previewKind !== 'subtitle-text',
    );
  const subtitleTextPreviewCanvases = () =>
    [...root.querySelectorAll<HTMLCanvasElement>(
      '[data-preview-canvas][data-preview-kind="subtitle-text"]',
    )];
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
  let subpanelShell!: StudioSubpanelShellHandle;
  let workflowBanner!: WorkflowBannerHandle;
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
      // Flush the debounced voice draft FIRST so a profile snapshot (saveFn reads
      // persisted prefs.voiceEffect) can't capture a stale voice — root cause of
      // "Update profile" staying lit after a save. Idempotent for non-voice saves.
      if (typeof voiceControls?.flushPersist === 'function') {
        await voiceControls.flushPersist();
      }
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

  /** Redraw previews at the GIF's first frame (timeMs 0) — used for the reduced-motion freeze. */
  function freezePreviewFirstFrame(): void {
    const subtitlePreview = subtitleControls?.getPreviewOptions();
    for (const canvas of previewCanvases()) {
      void renderThemePreview(
        canvas,
        resolvedTheme(),
        activeAlignment,
        0,
        activeCustomBackgroundId(),
        activeBackgroundLayout(),
        subtitlePreview,
      );
    }
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
    // Compare the LIVE voice draft, not persisted prefs — the draft saves on a
    // 250ms debounce, so persisted prefs lags an in-progress edit and the
    // Update-profile button would flicker stale (mirrors the subtitle draft above).
    const voiceForMatch =
      typeof voiceControls?.getDraftConfig === 'function'
        ? voiceControls.getDraftConfig()
        : activePrefs.voiceEffect;
    return !clipProfileMatchesLiveState(
      activePrefs.appearance,
      voiceForMatch,
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

  function refreshSubtitleTextPreview(timeMs?: number): void {
    const subtitlePreview = subtitleControls?.getPreviewOptions();
    const now = timeMs ?? performance.now();
    for (const canvas of subtitleTextPreviewCanvases()) {
      drawSubtitleTextOnlyPreview(canvas, subtitlePreview, now);
    }
  }

  function syncPreviewLoop(): void {
    // v5.4.0 Phase 2: while a live audition owns the main preview, the theme
    // RAF loop would paint a hidden canvas — the mic canvas is the preview.
    if (auditionActive) {
      stopPreviewLoop();
      return;
    }
    const theme = resolvedTheme();
    const presetBokeh = backgroundIsBokeh(theme.background);
    const animatedOverlay = themeHasAnimatedOverlay(theme);
    // CHANGED: an animated GIF personal background must drive the preview RAF too.
    // WHY: animated branch Phase 2 — otherwise the Studio preview would freeze while the
    //      recorder/export loop, breaking the WYSIWYG promise.
    const animatedBackground = isAnimatedBackgroundCached(activeCustomBackgroundId());
    const shouldAnimate = presetBokeh || animatedOverlay || animatedBackground;
    if (activePrefs && shouldReduceMotion(activePrefs)) {
      stopPreviewLoop();
      // Freeze the GIF to its first frame so the reduced-motion preview matches the recorder.
      if (animatedBackground) freezePreviewFirstFrame();
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
      refreshSubtitleTextPreview(now);
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
    refreshSubtitleTextPreview(timeMs);
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
    await voiceControls.flushPersist();
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
    syncStudioStatusStrip(root, {
      prefs: activePrefs,
      transcriptForMatch: subtitleControls.getProfileSnapshotConfig(),
      voiceForMatch: voiceControls.getDraftConfig(),
      transcriptDirty: subtitleControls.isTranscriptDirty(),
      transcriptDelivery: subtitleControls.getTranscriptDeliveryStatus(),
      hasSessionRecording: subtitleControls.hasSessionRecording(),
      hasTranscriptCues: subtitleControls.hasTranscriptCues(),
      bakedForSession: subtitleControls.isBakedForCurrentSession(),
    });
    workflowBanner?.update({
      hasSessionRecording: subtitleControls.hasSessionRecording(),
      hasTranscriptCues: subtitleControls.hasTranscriptCues(),
      bakedForSession: subtitleControls.isBakedForCurrentSession(),
      transcriptDelivery: subtitleControls.getTranscriptDeliveryStatus(),
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

    void personalBackground.sync(prefs);
    backgroundLayout.sync(prefs);
    voiceControls.syncFromPreferences(prefs);
    subtitleControls.syncFromPreferences(prefs);

    // BUG FIX: false Update profile highlight on Studio open (BUG-027)
    // Fix: profile dirty uses subtitle draft — sync draft before syncProfileActions.
    syncProfileActions(prefs);
    syncStyleButton(prefs);
    syncStyleControlsFromPrefs(prefs, true);
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
      // CHANGED: transcript text edits refresh preview only — not profile dirty state.
      // WHY: session transcript is IDB-scoped; profile tracks style/toggle fields only.
      if (activePrefs) {
        syncSectionSummaries();
      }
    },
    getThemeBarColor: () => resolvedTheme().colors.bar,
  });

  // Load DejaVu TTFs into browser font registry so the preview canvas is WYSIWYG with the bake.
  void loadDejaVuPreviewFonts().then(() => refreshSubtitleTextPreview());

  workflowBanner = mountWorkflowBanner(
    root,
    options?.initialWorkflowPhase ?? 'design',
    {
      hasSessionRecording: false,
      hasTranscriptCues: false,
      bakedForSession: false,
      transcriptDelivery: 'idle',
    },
  );

  const studioRecorder = mountStudioRecorder(root, {
    onLiveCanvas: setLivePreviewCanvas,
    onActiveChange: (active) => {
      auditionActive = active;
      takeDeck?.setAuditionActive(active);
      if (active) {
        stopPreviewLoop();
      } else {
        void refreshPreview();
      }
    },
  });

  takeDeck = mountCurrentTakeDeck(root, {
    onRecordRequest: () => {
      void studioRecorder.openAudition();
    },
  });
  takeDeck.setAuditionActive(studioRecorder.isActive());

  subpanelShell = mountStudioV4SubpanelShell(studioShell, {
    isPanelDirty: (panelId) => {
      if (panelId === 'bar-style') return hasPendingColorEdit();
      if (panelId === 'subtitles') return subtitleControls.isTranscriptDirty();
      return false;
    },
    onApplyPanel: async (panelId) => {
      if (panelId === 'bar-style') {
        await flushPendingDesignPersist();
        return;
      }
      if (panelId === 'subtitles') {
        await subtitleControls.confirmTranscriptEdits();
      }
    },
    onDiscardPanel: async (panelId) => {
      if (panelId === 'bar-style') {
        cancelPendingColorSave();
        if (activePrefs) {
          syncStyleControlsFromPrefs(activePrefs, true);
          syncSectionSummaries();
        }
        return;
      }
      if (panelId === 'subtitles') {
        await subtitleControls.discardTranscriptEdits();
      }
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
    // CHANGED: when a section sub-panel is open, main Done must not exit Design Studio.
    // WHY: users follow the top Done affordance; sub-panel chrome replaces this header slot.
    if (subpanelShell.isOpen()) {
      subpanelShell.closeActive();
      return;
    }
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
    // CHANGED: flush global subtitle + voice prefs before the studio tab is torn down.
    // WHY: chrome.storage.local.set is async; unload alone is not reliable (BUG-017).
    void subtitleControls.flushPersist();
    void voiceControls.flushPersist();
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
    takeUnsub();
    studioRecorder.dispose();
    takeDeck?.dispose();
    workflowBanner.dispose();
    subpanelShell.dispose();
    voiceControls.dispose();
    subtitleControls.dispose();
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    window.removeEventListener('pagehide', pageHideHandler);
    unsubscribe();
  };
}