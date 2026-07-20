import type { UserPreferencesV1 } from '@/src/settings/user-preferences';
import {
  backgroundPositionToCustomPosition,
  MAX_USER_BACKGROUND_MANUAL_SCALE,
  MIN_USER_BACKGROUND_MANUAL_SCALE,
  normalizeUserBackgroundLayout,
  userBackgroundLayoutFromAppearance,
  userBackgroundLayoutsEqual,
} from '@/src/theme/background-layout';
import {
  BACKGROUND_LAYOUT_PRESETS,
  getBundledUserBackground,
  resolveBackgroundLayoutPreset,
  type BackgroundLayoutPresetDefinition,
} from '@/src/theme/background-layout-presets';
import type {
  BackgroundImagePosition,
  BackgroundScaleMode,
  NormalizedUserBackgroundLayout,
} from '@/src/theme/types';
import {
  BACKGROUND_POSITION_COARSE_STEP,
  BACKGROUND_POSITION_FINE_STEP,
  nudgeBackgroundPosition,
  type BackgroundPositionAxis,
} from '@/src/ui/design-studio/background-precision';
import {
  renderPhysicalSliderHtml,
  setPhysicalSliderValue,
  wirePhysicalSliders,
} from '@/src/ui/design-studio/physical-slider';
import {
  constrainPointOutsideBand,
  scaleToSlider,
  sliderToScale,
  type NormalizedBand,
} from '@/src/ui/design-studio/interaction-utils';
import { renderPreviewBlock } from '@/src/ui/design-studio/preview-block';

export interface BackgroundLayoutControlsHandle {
  sync(prefs: UserPreferencesV1): void;
  syncLayout(layout: NormalizedUserBackgroundLayout): void;
  syncHistory(canUndo: boolean, canRedo: boolean): void;
  isSnapEnabled(): boolean;
  isGuidesEnabled(): boolean;
  dispose(): void;
}

export interface BackgroundLayoutChange {
  customBackgroundId?: string | null;
  backgroundScaleMode: BackgroundScaleMode;
  backgroundPosition: BackgroundImagePosition;
  backgroundLayout: NormalizedUserBackgroundLayout;
}

export interface BackgroundLayoutEmitOptions {
  persist: boolean;
  presetPreview?: boolean;
}

export interface BackgroundLayoutControlsOptions {
  onGestureStart?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  getCaptionSafeBand?: () => NormalizedBand | null;
}

// V4 NOTE: Background layout controls may move into a dedicated Background panel when Studio sections are segmented.

const SCALE_OPTIONS: { value: BackgroundScaleMode; label: string; hint: string }[] = [
  {
    value: 'fit',
    label: 'Fit inside',
    hint: 'Show the whole image; theme fills empty space',
  },
  {
    value: 'fill',
    label: 'Fill frame',
    hint: 'Zoom to cover; edges may crop',
  },
];

const POSITION_OPTIONS: {
  value: BackgroundImagePosition;
  label: string;
  gridColumn: number;
  gridRow: number;
}[] = [
  { value: 'top-left', label: 'Top left', gridColumn: 1, gridRow: 1 },
  { value: 'top', label: 'Top', gridColumn: 2, gridRow: 1 },
  { value: 'top-right', label: 'Top right', gridColumn: 3, gridRow: 1 },
  { value: 'left', label: 'Left', gridColumn: 1, gridRow: 2 },
  { value: 'center', label: 'Center', gridColumn: 2, gridRow: 2 },
  { value: 'right', label: 'Right', gridColumn: 3, gridRow: 2 },
  { value: 'bottom-left', label: 'Bottom left', gridColumn: 1, gridRow: 3 },
  { value: 'bottom', label: 'Bottom', gridColumn: 2, gridRow: 3 },
  { value: 'bottom-right', label: 'Bottom right', gridColumn: 3, gridRow: 3 },
];

const NAV_ICON_ROOT = '/assets/design-studio-v4/icons/navigation';

function scaleModeIcon(mode: BackgroundScaleMode): string {
  if (mode === 'fit') {
    return `
      <svg class="studio__layout-icon" viewBox="0 0 32 20" aria-hidden="true">
        <rect x="1" y="1" width="30" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
        <rect x="8" y="4" width="16" height="12" rx="1" fill="currentColor" opacity="0.85"/>
      </svg>
    `;
  }
  return `
    <svg class="studio__layout-icon" viewBox="0 0 32 20" aria-hidden="true">
      <rect x="1" y="1" width="30" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
      <rect x="4" y="2" width="24" height="16" rx="1" fill="currentColor" opacity="0.85"/>
      <rect x="1" y="1" width="30" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2.5"/>
    </svg>
  `;
}

function positionIcon(position: BackgroundImagePosition): string {
  const photoRects: Record<BackgroundImagePosition, string> = {
    'top-left': '<rect x="4" y="3" width="10" height="7" rx="1" fill="currentColor"/>',
    top: '<rect x="10" y="3" width="12" height="8" rx="1" fill="currentColor"/>',
    'top-right': '<rect x="18" y="3" width="10" height="7" rx="1" fill="currentColor"/>',
    left: '<rect x="4" y="8" width="12" height="8" rx="1" fill="currentColor"/>',
    center: '<rect x="10" y="8" width="12" height="8" rx="1" fill="currentColor"/>',
    right: '<rect x="16" y="8" width="12" height="8" rx="1" fill="currentColor"/>',
    'bottom-left': '<rect x="4" y="14" width="10" height="7" rx="1" fill="currentColor"/>',
    bottom: '<rect x="10" y="13" width="12" height="8" rx="1" fill="currentColor"/>',
    'bottom-right': '<rect x="18" y="14" width="10" height="7" rx="1" fill="currentColor"/>',
  };
  return `
    <svg class="studio__layout-icon studio__layout-icon--small" viewBox="0 0 32 24" aria-hidden="true">
      <rect x="1" y="1" width="30" height="22" rx="2" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.45"/>
      ${photoRects[position]}
    </svg>
  `;
}

function nudgeIconName(axis: BackgroundPositionAxis, delta: number): string {
  const coarse = Math.abs(delta) === BACKGROUND_POSITION_COARSE_STEP ? '-double' : '';
  if (axis === 'x') return delta < 0 ? `chevron-back${coarse}-16.svg` : `chevron-enter${coarse}-16.svg`;
  return delta < 0 ? `chevron-up${coarse}-16.svg` : `chevron-down${coarse}-16.svg`;
}

function renderNudgeButton(
  axis: BackgroundPositionAxis,
  delta: number,
  direction: string,
): string {
  const step = Math.abs(delta).toFixed(2).replace(/^0/, '');
  return `
    <button
      type="button"
      class="studio__precision-nudge"
      data-background-nudge-axis="${axis}"
      data-background-nudge-delta="${delta}"
      aria-label="Move ${direction} by ${Math.abs(delta).toFixed(2)}"
      title="Move ${direction} by ${Math.abs(delta).toFixed(2)}"
    >
      <img src="${NAV_ICON_ROOT}/${nudgeIconName(axis, delta)}" alt="" aria-hidden="true">
      <span>${step}</span>
    </button>
  `;
}

function renderBackgroundPreset(preset: BackgroundLayoutPresetDefinition): string {
  const background = getBundledUserBackground(preset.backgroundId)!;
  return `
    <button
      type="button"
      class="studio__background-preset"
      data-background-preset="${preset.id}"
      aria-pressed="false"
      style="--preset-x:${preset.customPosition.x * 100}%;--preset-y:${preset.customPosition.y * 100}%;--preset-scale:${preset.manualScale};--preset-dim:${preset.dim}"
    >
      <span class="studio__background-preset-thumb" aria-hidden="true">
        <img src="/${background.assetPath}" alt="">
        <span class="studio__background-preset-dim"></span>
        <span class="studio__background-preset-grid"></span>
        <span class="studio__background-preset-focal"></span>
      </span>
      <span class="studio__background-preset-copy">
        <strong>${preset.label}</strong>
        <span>${preset.description}</span>
      </span>
      <span class="studio__background-preset-spec">${preset.scaleMode} · ${preset.manualScale.toFixed(2)}× · dim ${Math.round(preset.dim * 100)}</span>
    </button>
  `;
}

function renderBackgroundPresets(): string {
  return `
    <section class="studio__background-presets" aria-labelledby="background-presets-title">
      <div class="studio__background-presets-heading">
        <span>
          <span class="studio__background-presets-eyebrow">Curated contact sheet</span>
          <span class="popup__field-label" id="background-presets-title">Starting frames</span>
        </span>
        <span class="popup__micro">Hover previews · Apply saves</span>
      </div>
      <div class="studio__background-preset-row" role="group" aria-label="Background layout presets">
        ${BACKGROUND_LAYOUT_PRESETS.map(renderBackgroundPreset).join('')}
      </div>
      <div class="studio__background-preset-footer">
        <output class="studio__background-preset-status" data-background-preset-status aria-live="polite">Hover a frame to audition it live.</output>
        <button type="button" class="studio__background-preset-apply" data-background-preset-apply disabled>Apply frame</button>
      </div>
    </section>
  `;
}

function renderPrecisionAxis(axis: BackgroundPositionAxis): string {
  const horizontal = axis === 'x';
  const negativeDirection = horizontal ? 'left' : 'up';
  const positiveDirection = horizontal ? 'right' : 'down';
  const valueAttribute = horizontal ? 'data-background-position-x' : 'data-background-position-y';
  const slider = renderPhysicalSliderHtml({
    min: 0,
    max: 1,
    step: BACKGROUND_POSITION_FINE_STEP,
    value: 0.5,
    ariaLabel: `${horizontal ? 'Horizontal' : 'Vertical'} background position`,
    orientation: horizontal ? 'horizontal' : 'vertical',
    dataAttrs: { 'background-position-slider': axis },
  });
  const heading = `
    <span class="studio__precision-axis-heading">
      <span class="studio__precision-axis-label">${axis.toUpperCase()}</span>
      <output class="studio__precision-value" ${valueAttribute}>0.50</output>
    </span>
  `;
  if (horizontal) {
    return `
      <div class="studio__precision-axis studio__precision-axis--horizontal">
        ${heading}
        <div class="studio__precision-axis-rail">
          ${renderNudgeButton(axis, -BACKGROUND_POSITION_COARSE_STEP, negativeDirection)}
          ${renderNudgeButton(axis, -BACKGROUND_POSITION_FINE_STEP, negativeDirection)}
          <div class="studio__precision-slider-shell">${slider}</div>
          ${renderNudgeButton(axis, BACKGROUND_POSITION_FINE_STEP, positiveDirection)}
          ${renderNudgeButton(axis, BACKGROUND_POSITION_COARSE_STEP, positiveDirection)}
        </div>
      </div>
    `;
  }
  // BUG FIX: Y-axis upward nudge order
  // Fix: Render the fine 0.01 step before the coarse 0.05 step to match the visual hierarchy.
  // Sync: scripts/test-background-control-ui.mjs
  return `
    <div class="studio__precision-axis studio__precision-axis--vertical">
      ${heading}
      <div class="studio__precision-nudge-pair studio__precision-nudge-pair--up">
        ${renderNudgeButton(axis, -BACKGROUND_POSITION_FINE_STEP, negativeDirection)}
        ${renderNudgeButton(axis, -BACKGROUND_POSITION_COARSE_STEP, negativeDirection)}
      </div>
      <div class="studio__precision-slider-shell studio__precision-slider-shell--vertical">${slider}</div>
      <div class="studio__precision-nudge-pair studio__precision-nudge-pair--down">
        ${renderNudgeButton(axis, BACKGROUND_POSITION_FINE_STEP, positiveDirection)}
        ${renderNudgeButton(axis, BACKGROUND_POSITION_COARSE_STEP, positiveDirection)}
      </div>
    </div>
  `;
}

function renderPrecisionInstrument(): string {
  const zoomSlider = renderPhysicalSliderHtml({
    min: 0,
    max: 1,
    step: 0.01,
    value: scaleToSlider(1, MIN_USER_BACKGROUND_MANUAL_SCALE, MAX_USER_BACKGROUND_MANUAL_SCALE),
    ariaLabel: 'Background zoom',
    dataAttrs: { 'background-scale-slider': 'true' },
  });
  return `
    <section class="studio__precision-controls" aria-labelledby="background-precision-title">
      <div class="studio__precision-heading">
        <span class="popup__field-label" id="background-precision-title">Fine position</span>
        <span class="popup__micro">Single .01 · double .05</span>
      </div>
      <p class="popup__field-desc studio__precision-help">
        Drag the frame, steer with arrows, or slide each axis.
      </p>
      <div class="studio__precision-stage">
        <div class="studio__precision-preview-cell">${renderPreviewBlock('background-precision')}</div>
        ${renderPrecisionAxis('y')}
        ${renderPrecisionAxis('x')}
      </div>
      <div class="studio__precision-zoom-row">
        <span class="studio__precision-tool-label">Zoom</span>
        <div class="studio__precision-slider-shell">${zoomSlider}</div>
        <output class="studio__precision-value studio__precision-value--zoom" data-background-scale-value>1.00×</output>
        <span class="popup__micro">Ctrl/⌘ + wheel on frame</span>
      </div>
      <div class="studio__precision-mode-row">
        <button type="button" class="studio__precision-mode studio__precision-mode--active" data-background-snap-toggle aria-pressed="true">Snap</button>
        <button type="button" class="studio__precision-mode studio__precision-mode--active" data-background-guides-toggle aria-pressed="true">Guides</button>
        <label class="studio__precision-safe-lock" title="Keep the focal point outside the rendered caption band">
          <input type="checkbox" data-background-safe-lock>
          <span>Clear captions</span>
        </label>
        <span class="studio__precision-history" aria-label="Background layout history">
          <button type="button" class="studio__precision-history-btn" data-background-undo disabled><span aria-hidden="true">↶</span> Undo</button>
          <button type="button" class="studio__precision-history-btn" data-background-redo disabled><span aria-hidden="true">↷</span> Redo</button>
        </span>
      </div>
    </section>
  `;
}

export function renderBackgroundLayoutFields(): string {
  const scaleButtons = SCALE_OPTIONS.map(
    (option) => `
      <button
        type="button"
        class="studio__layout-choice"
        data-scale-mode="${option.value}"
        aria-label="${option.label}"
        title="${option.hint}"
      >
        ${scaleModeIcon(option.value)}
        <span class="studio__layout-choice-label">${option.label}</span>
      </button>
    `,
  ).join('');

  const positionButtons = POSITION_OPTIONS.map(
    (option) => `
      <button
        type="button"
        class="studio__layout-choice studio__layout-choice--position"
        data-background-position="${option.value}"
        style="grid-column:${option.gridColumn};grid-row:${option.gridRow}"
        aria-label="${option.label}"
        title="${option.label}"
      >
        ${positionIcon(option.value)}
      </button>
    `,
  ).join('');

  return `
    <div class="studio__background-layout" data-background-layout hidden>
      ${renderBackgroundPresets()}
      ${renderPrecisionInstrument()}
      <div class="studio__layout-row">
        <div class="studio__layout-group">
          <span class="popup__field-label">Image sizing</span>
          <div class="studio__layout-scale-row" role="radiogroup" aria-label="Background image sizing">
            ${scaleButtons}
          </div>
        </div>
        <div class="studio__layout-group">
          <span class="popup__field-label">Image position</span>
          <div class="studio__layout-position-grid" role="radiogroup" aria-label="Background image position">
            ${positionButtons}
          </div>
        </div>
      </div>
    </div>
  `;
}

export function mountBackgroundLayoutControls(
  root: HTMLElement,
  onLayoutChange: (patch: BackgroundLayoutChange, options: BackgroundLayoutEmitOptions) => void,
  options: BackgroundLayoutControlsOptions = {},
): BackgroundLayoutControlsHandle {
  const panel = root.querySelector<HTMLElement>('[data-background-layout]')!;
  const scaleButtons = [...panel.querySelectorAll<HTMLButtonElement>('[data-scale-mode]')];
  const positionButtons = [...panel.querySelectorAll<HTMLButtonElement>('[data-background-position]')];
  const nudgeButtons = [...panel.querySelectorAll<HTMLButtonElement>('[data-background-nudge-axis]')];
  const positionSliders = [...panel.querySelectorAll<HTMLElement>('[data-background-position-slider]')];
  const scaleSlider = panel.querySelector<HTMLElement>('[data-background-scale-slider]')!;
  const xValue = panel.querySelector<HTMLOutputElement>('[data-background-position-x]')!;
  const yValue = panel.querySelector<HTMLOutputElement>('[data-background-position-y]')!;
  const scaleValue = panel.querySelector<HTMLOutputElement>('[data-background-scale-value]')!;
  const snapToggle = panel.querySelector<HTMLButtonElement>('[data-background-snap-toggle]')!;
  const guidesToggle = panel.querySelector<HTMLButtonElement>('[data-background-guides-toggle]')!;
  const safeLock = panel.querySelector<HTMLInputElement>('[data-background-safe-lock]')!;
  const undoButton = panel.querySelector<HTMLButtonElement>('[data-background-undo]')!;
  const redoButton = panel.querySelector<HTMLButtonElement>('[data-background-redo]')!;
  const presetButtons = [...panel.querySelectorAll<HTMLButtonElement>('[data-background-preset]')];
  const presetApply = panel.querySelector<HTMLButtonElement>('[data-background-preset-apply]')!;
  const presetStatus = panel.querySelector<HTMLOutputElement>('[data-background-preset-status]')!;

  let syncing = false;
  let buttonsSynced = false;
  let snapEnabled = true;
  let guidesEnabled = true;
  let layout = userBackgroundLayoutFromAppearance({});
  let committedLayout = normalizeUserBackgroundLayout(layout);
  let committedBackgroundId: string | null = null;
  let selectedPresetId: BackgroundLayoutPresetDefinition['id'] | null = null;
  let previewedPresetId: BackgroundLayoutPresetDefinition['id'] | null = null;
  let hoveredPresetId: BackgroundLayoutPresetDefinition['id'] | null = null;
  let focusedPresetId: BackgroundLayoutPresetDefinition['id'] | null = null;
  let emittingPresetPreview = false;
  let scaleMode: BackgroundScaleMode = layout.scaleMode;
  let position: BackgroundImagePosition = layout.position;

  function cloneLayout(next: NormalizedUserBackgroundLayout): NormalizedUserBackgroundLayout {
    return { ...next, customPosition: { ...next.customPosition } };
  }

  function presetForId(
    id: string | null | undefined,
  ): BackgroundLayoutPresetDefinition | undefined {
    return BACKGROUND_LAYOUT_PRESETS.find((preset) => preset.id === id);
  }

  function syncPresetUi(message?: string): void {
    for (const button of presetButtons) {
      const id = button.dataset.backgroundPreset;
      const selected = id === selectedPresetId;
      const previewed = id === previewedPresetId;
      button.classList.toggle('studio__background-preset--selected', selected);
      button.classList.toggle('studio__background-preset--previewing', previewed);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    }
    presetApply.disabled = !selectedPresetId;
    if (message) {
      presetStatus.value = message;
      return;
    }
    const selected = presetForId(selectedPresetId);
    const previewed = presetForId(previewedPresetId);
    presetStatus.value = selected
      ? `${selected.label} selected. Apply frame to save it.`
      : previewed
        ? `Previewing ${previewed.label}. Preferences are unchanged.`
        : 'Hover a frame to audition it live.';
  }

  function emit(
    persist = true,
    backgroundId?: string | null,
    presetPreview = false,
  ): void {
    if (syncing) return;
    // CHANGED: discrete and continuous controls emit one nested/legacy-compatible layout patch.
    // WHY: live slider frames and committed prefs must use the same migration-safe payload.
    const patch: BackgroundLayoutChange = {
      backgroundScaleMode: scaleMode,
      backgroundPosition: position,
      backgroundLayout: layout,
    };
    if (backgroundId !== undefined) patch.customBackgroundId = backgroundId;
    emittingPresetPreview = presetPreview;
    try {
      onLayoutChange(patch, { persist, presetPreview });
    } finally {
      emittingPresetPreview = false;
    }
  }

  function constrainForSafeText(next: NormalizedUserBackgroundLayout): NormalizedUserBackgroundLayout {
    if (!next.lockToSafeText) return next;
    const band = options.getCaptionSafeBand?.();
    if (!band) return next;
    return normalizeUserBackgroundLayout({
      ...next,
      customPosition: {
        ...next.customPosition,
        y: constrainPointOutsideBand(next.customPosition.y, band),
      },
    });
  }

  function syncButtons(): void {
    syncing = true;
    for (const button of scaleButtons) {
      const active = button.dataset.scaleMode === scaleMode;
      button.classList.toggle('studio__layout-choice--active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    for (const button of positionButtons) {
      const active = button.dataset.backgroundPosition === position;
      button.classList.toggle('studio__layout-choice--active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    syncing = false;
    buttonsSynced = true;
  }

  function syncPrecisionValues(): void {
    xValue.value = layout.customPosition.x.toFixed(2);
    yValue.value = layout.customPosition.y.toFixed(2);
    for (const slider of positionSliders) {
      const axis = slider.dataset.backgroundPositionSlider as BackgroundPositionAxis | undefined;
      if (axis) setPhysicalSliderValue(slider, layout.customPosition[axis]);
    }
    setPhysicalSliderValue(
      scaleSlider,
      scaleToSlider(
        layout.manualScale,
        MIN_USER_BACKGROUND_MANUAL_SCALE,
        MAX_USER_BACKGROUND_MANUAL_SCALE,
      ),
    );
    scaleValue.value = `${layout.manualScale.toFixed(2)}×`;
    safeLock.checked = layout.lockToSafeText;
  }

  function syncLayout(next: NormalizedUserBackgroundLayout, commit = true): void {
    const normalized = normalizeUserBackgroundLayout(next);
    const discreteControlsChanged = !buttonsSynced
      || normalized.scaleMode !== scaleMode
      || normalized.position !== position;
    layout = normalized;
    if (commit) {
      committedLayout = cloneLayout(normalized);
      selectedPresetId = null;
      previewedPresetId = null;
      hoveredPresetId = null;
      focusedPresetId = null;
      syncPresetUi();
    }
    scaleMode = layout.scaleMode;
    position = layout.position;
    if (discreteControlsChanged) syncButtons();
    syncPrecisionValues();
  }

  function previewPreset(preset: BackgroundLayoutPresetDefinition): void {
    const next = resolveBackgroundLayoutPreset(preset, committedLayout);
    previewedPresetId = preset.id;
    syncPresetUi();
    syncLayout(next, false);
    // CHANGED: preset audition updates the same live layout callback but marks it non-persistent.
    // WHY: hero, mini-preview, and active audition stay honest while hover/focus leaves prefs untouched.
    emit(false, preset.backgroundId, true);
  }

  function restorePresetPreview(message?: string): void {
    if (!previewedPresetId && userBackgroundLayoutsEqual(layout, committedLayout)) {
      syncPresetUi(message);
      return;
    }
    previewedPresetId = null;
    syncLayout(committedLayout, false);
    emit(false, committedBackgroundId, true);
    syncPresetUi(message);
  }

  function reconcilePresetPreview(): void {
    // CHANGED: hover and keyboard focus independently own the transient audition.
    // WHY: leaving the pointer must not cancel a still-focused card, and selection only arms Apply.
    const preset = presetForId(focusedPresetId ?? hoveredPresetId);
    if (preset) {
      if (previewedPresetId !== preset.id) previewPreset(preset);
      return;
    }
    restorePresetPreview();
  }

  function syncModeButton(button: HTMLButtonElement, active: boolean): void {
    button.classList.toggle('studio__precision-mode--active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  }

  function syncGuideVisibility(): void {
    for (const guideLayer of root.querySelectorAll<HTMLElement>('[data-background-guide-layer]')) {
      guideLayer.hidden = !guidesEnabled;
    }
  }

  for (const button of presetButtons) {
    const preset = presetForId(button.dataset.backgroundPreset);
    if (!preset) continue;
    button.addEventListener('pointerenter', () => {
      hoveredPresetId = preset.id;
      reconcilePresetPreview();
    });
    button.addEventListener('pointerleave', () => {
      hoveredPresetId = null;
      reconcilePresetPreview();
    });
    button.addEventListener('focus', () => {
      focusedPresetId = preset.id;
      reconcilePresetPreview();
    });
    button.addEventListener('blur', () => {
      focusedPresetId = null;
      reconcilePresetPreview();
    });
    button.addEventListener('click', () => {
      if (selectedPresetId === preset.id) {
        selectedPresetId = null;
        restorePresetPreview();
        return;
      }
      selectedPresetId = preset.id;
      previewPreset(preset);
    });
  }

  presetApply.addEventListener('click', () => {
    const preset = presetForId(selectedPresetId);
    if (!preset) return;
    const next = resolveBackgroundLayoutPreset(preset, committedLayout);

    // Restore the real baseline before snapshotting so history never captures the hover audition.
    restorePresetPreview();
    if (
      committedBackgroundId === preset.backgroundId
      && userBackgroundLayoutsEqual(committedLayout, next)
    ) {
      selectedPresetId = null;
      syncPresetUi(`${preset.label} is already applied.`);
      return;
    }

    options.onGestureStart?.();
    committedBackgroundId = preset.backgroundId;
    syncLayout(next, true);
    emit(true, preset.backgroundId);
    syncPresetUi(`${preset.label} applied.`);
  });

  for (const button of scaleButtons) {
    button.addEventListener('click', () => {
      const next = button.dataset.scaleMode as BackgroundScaleMode | undefined;
      if (!next || next === scaleMode) return;
      options.onGestureStart?.();
      scaleMode = next;
      layout = constrainForSafeText(normalizeUserBackgroundLayout({ ...layout, scaleMode }));
      syncLayout(layout);
      emit();
    });
  }

  for (const button of positionButtons) {
    button.addEventListener('click', () => {
      const next = button.dataset.backgroundPosition as BackgroundImagePosition | undefined;
      if (!next || next === position) return;
      options.onGestureStart?.();
      position = next;
      layout = constrainForSafeText(normalizeUserBackgroundLayout({
        ...layout,
        position,
        customPosition: backgroundPositionToCustomPosition(position),
      }));
      syncLayout(layout);
      emit();
    });
  }

  for (const button of nudgeButtons) {
    button.addEventListener('click', () => {
      const axis = button.dataset.backgroundNudgeAxis as BackgroundPositionAxis | undefined;
      const delta = Number(button.dataset.backgroundNudgeDelta);
      if (!axis || !Number.isFinite(delta)) return;
      options.onGestureStart?.();
      layout = constrainForSafeText(nudgeBackgroundPosition(layout, axis, delta));
      syncLayout(layout);
      emit();
    });
  }

  const disposeSliders = wirePhysicalSliders(panel, {
    onInteractionStart: () => options.onGestureStart?.(),
    onValueChange(slider, value) {
      const axis = slider.dataset.backgroundPositionSlider as BackgroundPositionAxis | undefined;
      if (axis) {
        layout = constrainForSafeText(normalizeUserBackgroundLayout({
          ...layout,
          customPosition: { ...layout.customPosition, [axis]: value },
        }));
      } else if (slider.dataset.backgroundScaleSlider === 'true') {
        layout = normalizeUserBackgroundLayout({
          ...layout,
          manualScale: sliderToScale(
            value,
            MIN_USER_BACKGROUND_MANUAL_SCALE,
            MAX_USER_BACKGROUND_MANUAL_SCALE,
          ),
        });
      } else {
        return;
      }
      syncLayout(layout);
      emit(false);
    },
    onInteractionEnd() {
      emit(true);
    },
  });

  snapToggle.addEventListener('click', () => {
    snapEnabled = !snapEnabled;
    syncModeButton(snapToggle, snapEnabled);
    if (!snapEnabled) {
      for (const guide of root.querySelectorAll<HTMLElement>('[data-background-active-guide-x], [data-background-active-guide-y]')) {
        guide.hidden = true;
      }
    }
  });
  guidesToggle.addEventListener('click', () => {
    guidesEnabled = !guidesEnabled;
    syncModeButton(guidesToggle, guidesEnabled);
    syncGuideVisibility();
  });
  safeLock.addEventListener('change', () => {
    options.onGestureStart?.();
    layout = constrainForSafeText(normalizeUserBackgroundLayout({
      ...layout,
      lockToSafeText: safeLock.checked,
    }));
    syncLayout(layout);
    emit();
  });
  undoButton.addEventListener('click', () => options.onUndo?.());
  redoButton.addEventListener('click', () => options.onRedo?.());

  syncGuideVisibility();

  return {
    sync(prefs) {
      const hasBackground = Boolean(prefs.appearance.customBackgroundId);
      panel.hidden = !hasBackground;
      if (!hasBackground) return;
      committedBackgroundId = prefs.appearance.customBackgroundId ?? null;
      syncLayout(userBackgroundLayoutFromAppearance(prefs.appearance), true);
    },
    syncLayout(next) {
      syncLayout(next, !emittingPresetPreview);
    },
    syncHistory(canUndo, canRedo) {
      undoButton.disabled = !canUndo;
      redoButton.disabled = !canRedo;
    },
    isSnapEnabled: () => snapEnabled,
    isGuidesEnabled: () => guidesEnabled,
    dispose: disposeSliders,
  };
}
