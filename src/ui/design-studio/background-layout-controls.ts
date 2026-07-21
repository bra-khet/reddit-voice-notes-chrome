import type { UserPreferencesV1 } from '@/src/settings/user-preferences';
import {
  backgroundPositionToCustomPosition,
  MAX_USER_BACKGROUND_BLUR,
  MAX_USER_BACKGROUND_GIF_SPEED,
  MAX_USER_BACKGROUND_MANUAL_SCALE,
  MIN_USER_BACKGROUND_GIF_SPEED,
  MIN_USER_BACKGROUND_MANUAL_SCALE,
  normalizeUserBackgroundLayout,
  USER_BACKGROUND_BLEND_PLATE_SOURCES,
  USER_BACKGROUND_BLEND_MODES,
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
  BackgroundBlendPlateSource,
  BackgroundImagePosition,
  BackgroundScaleMode,
  NormalizedUserBackgroundLayout,
} from '@/src/theme/types';
import {
  mountColorPickerControls,
  renderColorPickerFields,
} from '@/src/ui/design-studio/color-picker';
import {
  BACKGROUND_POSITION_COARSE_STEP,
  BACKGROUND_POSITION_FINE_STEP,
  formatBackgroundLayoutAnnouncement,
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
import { sampleCanvasColorAtClient } from '@/src/ui/design-studio/background-color-sampler';

export interface BackgroundLayoutControlsHandle {
  sync(prefs: UserPreferencesV1): void;
  syncLayout(layout: NormalizedUserBackgroundLayout): void;
  announceLayout(layout: NormalizedUserBackgroundLayout, action: string): void;
  syncHistory(canUndo: boolean, canRedo: boolean): void;
  syncRecordingState(recording: boolean): void;
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
  comparePreview?: boolean;
}

export interface BackgroundLayoutControlsOptions {
  onGestureStart?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  getCaptionSafeBand?: () => NormalizedBand | null;
  getEyeDropperCanvas?: () => HTMLCanvasElement | null;
  getEyeDropperSurface?: () => HTMLElement | null;
  getEyeDropperTargets?: () => readonly BackgroundColorSampleTarget[];
  getBlendPlateColor?: (layout: NormalizedUserBackgroundLayout) => string;
  onColorSamplingChange?: (sampling: boolean) => void;
  onSampleColor?: (hex: string) => void;
}

export interface BackgroundColorSampleTarget {
  canvas: HTMLCanvasElement;
  surface: HTMLElement;
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

type BackgroundFramingAspect = 'native' | 'square' | 'vertical';

const BACKGROUND_FRAMING_ASPECTS: readonly {
  id: BackgroundFramingAspect;
  label: string;
  shortLabel: string;
  description: string;
}[] = [
  { id: 'native', label: 'Native 16:9', shortLabel: '16:9', description: 'Full recorded frame' },
  { id: 'square', label: 'Square 1:1', shortLabel: '1:1', description: 'Centered square crop guide' },
  { id: 'vertical', label: 'Vertical 9:16', shortLabel: '9:16', description: 'Centered vertical crop guide' },
];

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

const BACKGROUND_BLEND_LABELS: Record<(typeof USER_BACKGROUND_BLEND_MODES)[number], string> = {
  'source-over': 'Normal',
  multiply: 'Multiply',
  overlay: 'Overlay',
  screen: 'Screen',
  'soft-light': 'Soft light',
  'color-burn': 'Color burn',
  'color-dodge': 'Color dodge',
  difference: 'Difference',
};

const BACKGROUND_BLEND_PLATE_LABELS: Record<BackgroundBlendPlateSource, string> = {
  legacy: 'Legacy void',
  'theme-tint': 'Theme tint',
  'bar-color': 'Bar color',
  'mid-gray': 'Mid gray',
  'soft-white': 'Soft white',
  custom: 'Custom solid',
};

function framingAspectIcon(aspect: BackgroundFramingAspect): string {
  const frame = aspect === 'native'
    ? '<rect x="3" y="7" width="26" height="14" rx="1.5"/>'
    : aspect === 'square'
      ? '<rect x="9" y="7" width="14" height="14" rx="1.5"/>'
      : '<rect x="12" y="6" width="8" height="16" rx="1.5"/>';
  return `
    <svg viewBox="0 0 32 28" aria-hidden="true">
      <rect x="1" y="5" width="30" height="18" rx="2" opacity="0.28"/>
      ${frame}
    </svg>
  `;
}

function renderBackgroundFraming(): string {
  // BUG FIX: Theme-only read like a static alternate preset instead of the current look minus personal media
  // Fix: name the retained theme/style/motion and the unchanged export in the control and active status copy.
  // Sync: syncFramingUi; scripts/test-background-control-ui.mjs
  const aspectButtons = BACKGROUND_FRAMING_ASPECTS.map((aspect) => `
    <button
      type="button"
      class="studio__background-framing-aspect${aspect.id === 'native' ? ' studio__background-framing-aspect--active' : ''}"
      data-background-framing-aspect-button="${aspect.id}"
      aria-pressed="${aspect.id === 'native' ? 'true' : 'false'}"
      title="${aspect.description}"
    >
      ${framingAspectIcon(aspect.id)}
      <span>${aspect.shortLabel}</span>
    </button>
  `).join('');

  return `
    <section class="studio__background-framing" aria-labelledby="background-framing-title">
      <div class="studio__background-framing-heading">
        <span>
          <span class="studio__background-framing-eyebrow">Current-look framing &amp; A/B</span>
          <span class="popup__field-label" id="background-framing-title">Framing aids</span>
        </span>
        <span class="studio__background-framing-badge">EXPORT 16:9</span>
      </div>
      <p class="popup__field-desc studio__background-framing-help">
        Frame the current 16:9 look, or hide only its personal image/GIF. Theme, style, motion, and export stay unchanged.
      </p>
      <div class="studio__background-framing-tools">
        <div class="studio__background-framing-aspects" role="group" aria-label="Framing crop guide">
          ${aspectButtons}
        </div>
        <button type="button" class="studio__background-framing-toggle" data-background-framing-thirds aria-pressed="false">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 3v18M16 3v18M3 8h18M3 16h18"/>
          </svg>
          Thirds
        </button>
        <button
          type="button"
          class="studio__background-compare"
          data-background-compare
          aria-pressed="false"
          aria-label="Preview current theme and style without the personal image or GIF"
          title="Hide only the personal image or GIF; theme and style stay active"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3v18M12 5H5v14h7M12 5h7v14h-7"/>
            <path d="m7 15 2.5-3 2.5 2.5M15 9h2"/>
          </svg>
          Theme only
        </button>
      </div>
      <output class="studio__background-framing-status" data-background-framing-status aria-live="polite">
        Full 16:9 frame. Turn on Thirds or choose a crop guide.
      </output>
    </section>
  `;
}

function renderBackgroundTreatment(): string {
  const dimSlider = renderPhysicalSliderHtml({
    min: 0,
    max: 100,
    step: 1,
    value: 35,
    ariaLabel: 'Background dim amount',
    dataAttrs: { 'background-dim-slider': 'true' },
  });
  const blurSlider = renderPhysicalSliderHtml({
    min: 0,
    max: MAX_USER_BACKGROUND_BLUR,
    step: 1,
    value: 6,
    ariaLabel: 'Background blur amount',
    dataAttrs: { 'background-blur-slider': 'true' },
  });
  const gifSpeedSlider = renderPhysicalSliderHtml({
    min: MIN_USER_BACKGROUND_GIF_SPEED * 100,
    max: MAX_USER_BACKGROUND_GIF_SPEED * 100,
    step: 5,
    value: 100,
    ariaLabel: 'Animated GIF playback speed',
    dataAttrs: { 'background-gif-speed-slider': 'true' },
  });
  const blendOptions = USER_BACKGROUND_BLEND_MODES.map((mode) =>
    `<option value="${mode}">${BACKGROUND_BLEND_LABELS[mode]}</option>`).join('');
  const plateOptions = USER_BACKGROUND_BLEND_PLATE_SOURCES.map((source) =>
    `<option value="${source}">${BACKGROUND_BLEND_PLATE_LABELS[source]}</option>`).join('');

  return `
    <section class="studio__background-treatment" aria-labelledby="background-treatment-title">
      <div class="studio__background-treatment-heading">
        <span>
          <span class="studio__background-treatment-eyebrow">Image darkroom</span>
          <span class="popup__field-label" id="background-treatment-title">Treatment</span>
        </span>
        <span class="popup__micro">Live canvas · saved per profile</span>
      </div>
      <div class="studio__background-treatment-grid">
        <div class="studio__background-treatment-rail">
          <span class="studio__background-treatment-label">Dim</span>
          <div class="studio__precision-slider-shell">${dimSlider}</div>
          <output class="studio__background-treatment-value" data-background-dim-value>35%</output>
        </div>
        <div class="studio__background-treatment-rail">
          <label class="studio__background-treatment-toggle">
            <input type="checkbox" data-background-blur-toggle>
            <span>Blur</span>
          </label>
          <div class="studio__precision-slider-shell">${blurSlider}</div>
          <output class="studio__background-treatment-value" data-background-blur-value>Off</output>
        </div>
        <label class="studio__background-blend-field">
          <span class="studio__background-treatment-label">Blend</span>
          <select class="popup__select" data-background-blend-mode aria-label="Background blend mode">
            ${blendOptions}
          </select>
        </label>
      </div>
      <div class="studio__background-blend-plate">
        <label class="studio__background-blend-plate-field">
          <span class="studio__background-treatment-label">Blend plate</span>
          <select class="popup__select" data-background-blend-plate-source aria-label="Blend plate source">
            ${plateOptions}
          </select>
        </label>
        <span class="studio__background-blend-plate-swatch" data-background-blend-plate-swatch aria-hidden="true"></span>
        <span class="studio__background-blend-plate-copy">
          <strong data-background-blend-plate-name>Legacy void</strong>
          <small>Blend combines the image with this solid; Dim darkens afterward.</small>
        </span>
        <details class="studio__background-blend-plate-custom" data-background-blend-plate-custom hidden>
          <summary>Open custom HSV color</summary>
          <div data-background-blend-plate-picker>
            ${renderColorPickerFields({
              hexAriaLabel: 'Custom blend plate color hex',
              note: 'Full-range solid color — hue, saturation, brightness, or exact HEX.',
            })}
          </div>
        </details>
      </div>
      <label class="studio__background-holo-toggle">
        <input type="checkbox" data-background-holo>
        <span>
          <strong>Holo drift</strong>
          <small>Gentle chromatic offset and moving sheen</small>
        </span>
      </label>
      <div class="studio__background-color-sampler">
        <button type="button" class="studio__background-eyedropper" data-background-eyedropper aria-pressed="false">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14.8 3.2a2.5 2.5 0 0 1 3.5 0l2.5 2.5a2.5 2.5 0 0 1 0 3.5l-2.1 2.1-1.4-1.4-7.6 7.6-3.9.8.8-3.9 7.6-7.6-1.4-1.4 2-2.2Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
          </svg>
          Sample for bars
        </button>
        <span class="studio__background-sampled-color" data-background-sampled-color aria-hidden="true" hidden></span>
        <output class="studio__background-sample-status" data-background-sample-status aria-live="polite">Pick a clear background pixel to color the bars.</output>
      </div>
      <details class="studio__background-motion" data-background-motion>
        <summary>
          <span>Animated GIF motion</span>
          <span class="popup__micro">Advanced</span>
        </summary>
        <div class="studio__background-motion-body">
          <div class="studio__background-treatment-rail">
            <span class="studio__background-treatment-label">Speed</span>
            <div class="studio__precision-slider-shell">${gifSpeedSlider}</div>
            <output class="studio__background-treatment-value" data-background-gif-speed-value>1.00×</output>
          </div>
          <label class="studio__background-motion-toggle">
            <input type="checkbox" data-background-gif-react aria-keyshortcuts="Space">
            <span>Let voice energy gently drive GIF speed</span>
          </label>
          <p class="popup__field-desc">Static images ignore these controls. Reduced motion always freezes GIFs at frame zero.</p>
        </div>
      </details>
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
    // BUG FIX: Y-axis slider keyboard direction
    // Fix: pointer values remain top→bottom, but keyboard arrows follow their spatial names.
    // Sync: physical-slider.ts; scripts/test-background-control-ui.mjs
    dataAttrs: {
      'background-position-slider': axis,
      ...(horizontal ? {} : { 'keyboard-inverted': 'true' }),
    },
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
      <p class="popup__field-desc studio__precision-help" id="background-position-keyboard-help">
        Drag the frame, or focus it: arrows move .05, Shift + arrows move .01, +/− zoom, Esc centers.
      </p>
      <div class="studio__precision-stage">
        <div class="studio__precision-preview-cell">${renderPreviewBlock('background-precision')}</div>
        ${renderPrecisionAxis('y')}
        ${renderPrecisionAxis('x')}
      </div>
      <div class="studio__precision-zoom-row">
        <span class="studio__precision-tool-label">Custom zoom</span>
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
      <div class="studio__precision-variant-row" aria-label="Next-take framing variant">
        <span class="studio__precision-tool-label">Next-take A/B</span>
        <span class="popup__micro">Keep one alternate framing in this Studio session.</span>
        <span class="studio__precision-variant-actions">
          <button type="button" class="studio__precision-history-btn" data-background-center>Center</button>
          <button type="button" class="studio__precision-history-btn" data-background-variant-save disabled>Save variant</button>
          <button type="button" class="studio__precision-history-btn" data-background-variant-swap disabled>Swap A/B</button>
        </span>
        <output class="popup__micro studio__precision-variant-status" data-background-variant-status>
          No alternate framing saved.
        </output>
      </div>
      <output
        class="studio__sr-only"
        data-background-position-status
        aria-live="polite"
        aria-atomic="true"
      ></output>
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
      ${renderBackgroundTreatment()}
      ${renderBackgroundFraming()}
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
  const centerButton = panel.querySelector<HTMLButtonElement>('[data-background-center]')!;
  const variantSaveButton = panel.querySelector<HTMLButtonElement>('[data-background-variant-save]')!;
  const variantSwapButton = panel.querySelector<HTMLButtonElement>('[data-background-variant-swap]')!;
  const variantStatus = panel.querySelector<HTMLOutputElement>('[data-background-variant-status]')!;
  const positionStatus = panel.querySelector<HTMLOutputElement>('[data-background-position-status]')!;
  const presetButtons = [...panel.querySelectorAll<HTMLButtonElement>('[data-background-preset]')];
  const presetSection = panel.querySelector<HTMLElement>('.studio__background-presets')!;
  const presetApply = panel.querySelector<HTMLButtonElement>('[data-background-preset-apply]')!;
  const presetStatus = panel.querySelector<HTMLOutputElement>('[data-background-preset-status]')!;
  const dimSlider = panel.querySelector<HTMLElement>('[data-background-dim-slider]')!;
  const dimValue = panel.querySelector<HTMLOutputElement>('[data-background-dim-value]')!;
  const blurToggle = panel.querySelector<HTMLInputElement>('[data-background-blur-toggle]')!;
  const blurSlider = panel.querySelector<HTMLElement>('[data-background-blur-slider]')!;
  const blurValue = panel.querySelector<HTMLOutputElement>('[data-background-blur-value]')!;
  const blendSelect = panel.querySelector<HTMLSelectElement>('[data-background-blend-mode]')!;
  const blendPlateSelect = panel.querySelector<HTMLSelectElement>('[data-background-blend-plate-source]')!;
  const blendPlateSwatch = panel.querySelector<HTMLElement>('[data-background-blend-plate-swatch]')!;
  const blendPlateName = panel.querySelector<HTMLElement>('[data-background-blend-plate-name]')!;
  const blendPlateCustom = panel.querySelector<HTMLDetailsElement>('[data-background-blend-plate-custom]')!;
  const blendPlatePickerRoot = panel.querySelector<HTMLElement>('[data-background-blend-plate-picker]')!;
  const holoToggle = panel.querySelector<HTMLInputElement>('[data-background-holo]')!;
  const gifSpeedSlider = panel.querySelector<HTMLElement>('[data-background-gif-speed-slider]')!;
  const gifSpeedValue = panel.querySelector<HTMLOutputElement>('[data-background-gif-speed-value]')!;
  const gifReactToggle = panel.querySelector<HTMLInputElement>('[data-background-gif-react]')!;
  const eyeDropperButton = panel.querySelector<HTMLButtonElement>('[data-background-eyedropper]')!;
  const sampledColor = panel.querySelector<HTMLElement>('[data-background-sampled-color]')!;
  const sampleStatus = panel.querySelector<HTMLOutputElement>('[data-background-sample-status]')!;
  const framingAspectButtons = [...panel.querySelectorAll<HTMLButtonElement>('[data-background-framing-aspect-button]')];
  const framingThirdsButton = panel.querySelector<HTMLButtonElement>('[data-background-framing-thirds]')!;
  const compareButton = panel.querySelector<HTMLButtonElement>('[data-background-compare]')!;
  const framingStatus = panel.querySelector<HTMLOutputElement>('[data-background-framing-status]')!;
  const framingOverlay = root.querySelector<HTMLElement>('[data-background-framing-overlay]');
  const framingThirdsOverlay = framingOverlay?.querySelector<HTMLElement>('[data-background-framing-thirds]') ?? null;
  const framingLabel = framingOverlay?.querySelector<HTMLElement>('[data-background-framing-label]') ?? null;
  const samplingHost = root.querySelector<HTMLElement>('.studio-v4') ?? root;

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
  let emittingComparePreview = false;
  let recordingActive = false;
  let backgroundAvailable = false;
  let framingAspect: BackgroundFramingAspect = 'native';
  let framingThirds = false;
  let compareActive = false;
  let layoutVariant: {
    backgroundId: string;
    layout: NormalizedUserBackgroundLayout;
  } | null = null;
  let lastNonZeroBlur = 6;
  let samplingTargets: BackgroundColorSampleTarget[] = [];
  let sampleMissCount = 0;
  let blendPlatePersistTimer = 0;
  let blendPlateEditActive = false;
  let blendPlatePicker!: ReturnType<typeof mountColorPickerControls>;
  let scaleMode: BackgroundScaleMode = layout.scaleMode;
  let position: BackgroundImagePosition = layout.position;

  function cloneLayout(next: NormalizedUserBackgroundLayout): NormalizedUserBackgroundLayout {
    return { ...next, customPosition: { ...next.customPosition } };
  }

  function announceLayout(next: NormalizedUserBackgroundLayout, action: string): void {
    const message = formatBackgroundLayoutAnnouncement(next, action);
    // Re-arm an identical polite announcement without adding visible status churn.
    positionStatus.value = positionStatus.value === message ? `${message}\u00a0` : message;
  }

  function syncVariantUi(message?: string): void {
    const blocked = recordingActive || compareActive || Boolean(previewedPresetId);
    const available = Boolean(
      layoutVariant
      && committedBackgroundId
      && layoutVariant.backgroundId === committedBackgroundId,
    );
    variantSaveButton.textContent = available ? 'Replace variant' : 'Save variant';
    variantSaveButton.disabled = blocked || !committedBackgroundId;
    variantSwapButton.disabled = blocked || !available;
    variantStatus.value = message ?? (blocked
      ? 'Next-take A/B is paused during recording, compare, or preset audition.'
      : available
        ? 'Alternate ready; Swap A/B exchanges it with the current framing.'
        : 'No alternate framing saved.');
  }

  function clearLayoutVariant(message?: string): void {
    layoutVariant = null;
    syncVariantUi(message);
  }

  function presetForId(
    id: string | null | undefined,
  ): BackgroundLayoutPresetDefinition | undefined {
    return BACKGROUND_LAYOUT_PRESETS.find((preset) => preset.id === id);
  }

  function syncPresetUi(message?: string): void {
    presetSection.classList.toggle('studio__background-presets--recording', recordingActive);
    presetSection.classList.toggle('studio__background-presets--comparing', compareActive);
    for (const button of presetButtons) {
      const id = button.dataset.backgroundPreset;
      const selected = id === selectedPresetId;
      const previewed = id === previewedPresetId;
      button.classList.toggle('studio__background-preset--selected', selected);
      button.classList.toggle('studio__background-preset--previewing', previewed);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
      button.disabled = recordingActive || compareActive;
    }
    presetApply.disabled = recordingActive || compareActive || !selectedPresetId;
    syncVariantUi();
    if (recordingActive) {
      presetStatus.value = 'Preset audition is paused while recording to prevent flashes in the captured video.';
      return;
    }
    if (compareActive) {
      presetStatus.value = 'Preset audition is paused during Theme-only compare.';
      return;
    }
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
    comparePreview = false,
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
    emittingComparePreview = comparePreview;
    try {
      onLayoutChange(patch, { persist, presetPreview, comparePreview });
    } finally {
      emittingPresetPreview = false;
      emittingComparePreview = false;
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
      if (axis) {
        setPhysicalSliderValue(slider, layout.customPosition[axis]);
        slider.setAttribute(
          'aria-valuetext',
          `${axis === 'x' ? 'Horizontal' : 'Vertical'} position ${layout.customPosition[axis].toFixed(2)}`,
        );
      }
    }
    setPhysicalSliderValue(
      scaleSlider,
      scaleToSlider(
        layout.manualScale,
        MIN_USER_BACKGROUND_MANUAL_SCALE,
        MAX_USER_BACKGROUND_MANUAL_SCALE,
      ),
    );
    scaleSlider.setAttribute('aria-valuetext', `Background zoom ${layout.manualScale.toFixed(2)} times`);
    scaleValue.value = `${layout.manualScale.toFixed(2)}×`;
    safeLock.checked = layout.lockToSafeText;
  }

  function syncTreatmentValues(): void {
    setPhysicalSliderValue(dimSlider, Math.round(layout.dim * 100));
    dimValue.value = `${Math.round(layout.dim * 100)}%`;
    if (layout.blur > 0) lastNonZeroBlur = layout.blur;
    blurToggle.checked = layout.blur > 0;
    setPhysicalSliderValue(blurSlider, layout.blur > 0 ? layout.blur : lastNonZeroBlur);
    blurSlider.setAttribute('aria-disabled', blurToggle.checked ? 'false' : 'true');
    blurValue.value = blurToggle.checked ? `${layout.blur.toFixed(0)} px` : 'Off';
    for (const option of blendSelect.options) {
      const selected = option.value === layout.blendMode;
      option.selected = selected;
      option.toggleAttribute('selected', selected);
    }
    for (const option of blendPlateSelect.options) {
      const selected = option.value === layout.blendPlateSource;
      option.selected = selected;
      option.toggleAttribute('selected', selected);
    }
    const fallbackPlateColors: Record<BackgroundBlendPlateSource, string> = {
      legacy: '#080a10',
      'theme-tint': '#52647a',
      'bar-color': '#00e5ff',
      'mid-gray': '#808080',
      'soft-white': '#e8edf2',
      custom: layout.blendPlateColor,
    };
    const resolvedPlateColor = options.getBlendPlateColor?.(layout)
      ?? fallbackPlateColors[layout.blendPlateSource];
    blendPlateSwatch.style.background = resolvedPlateColor;
    blendPlateName.textContent = `${BACKGROUND_BLEND_PLATE_LABELS[layout.blendPlateSource]} · ${resolvedPlateColor}`;
    blendPlateCustom.hidden = layout.blendPlateSource !== 'custom';
    if (layout.blendPlateSource === 'custom' && !blendPlatePicker.isUserAdjusting()) {
      blendPlatePicker.sync({ barColor: layout.blendPlateColor });
    }
    holoToggle.checked = layout.holo;
    setPhysicalSliderValue(gifSpeedSlider, Math.round(layout.gifSpeed * 100));
    gifSpeedValue.value = `${layout.gifSpeed.toFixed(2)}×`;
    gifReactToggle.checked = layout.gifReactToAudio;
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
    syncTreatmentValues();
  }

  function previewPreset(preset: BackgroundLayoutPresetDefinition): void {
    // BUG FIX: preset hover/focus could replace an active Theme-only comparison
    // Fix: compare owns the transient background identity until finishCompare restores the committed image.
    // Sync: restorePresetPreview; preset event handlers; scripts/test-background-control-ui.mjs
    if (recordingActive || compareActive) {
      syncPresetUi();
      return;
    }
    const next = resolveBackgroundLayoutPreset(preset, committedLayout);
    previewedPresetId = preset.id;
    syncPresetUi();
    syncLayout(next, false);
    // CHANGED: preset audition updates the same live layout callback but marks it non-persistent.
    // WHY: hero, mini-preview, and active audition stay honest while hover/focus leaves prefs untouched.
    emit(false, preset.backgroundId, true);
  }

  function restorePresetPreview(message?: string): void {
    // BUG FIX: a stale preset mouse-away restore could re-show the personal image while compare stayed pressed
    // Fix: retire any preset layout and re-assert the null-image compare seam instead of restoring committed media.
    // Sync: reconcilePresetPreview; finishCompare; scripts/test-background-control-ui.mjs
    if (compareActive) {
      hoveredPresetId = null;
      focusedPresetId = null;
      previewedPresetId = null;
      if (!userBackgroundLayoutsEqual(layout, committedLayout)) syncLayout(committedLayout, false);
      emit(false, null, false, true);
      syncPresetUi(message);
      return;
    }
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
    if (compareActive) {
      restorePresetPreview('Preset audition is paused during Theme-only compare.');
      return;
    }
    if (recordingActive) {
      restorePresetPreview();
      return;
    }
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

  function syncFramingUi(message?: string): void {
    const activeDefinition = BACKGROUND_FRAMING_ASPECTS.find((aspect) => aspect.id === framingAspect)
      ?? BACKGROUND_FRAMING_ASPECTS[0];
    for (const button of framingAspectButtons) {
      const active = button.dataset.backgroundFramingAspectButton === framingAspect;
      button.classList.toggle('studio__background-framing-aspect--active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    framingThirdsButton.classList.toggle('studio__background-framing-toggle--active', framingThirds);
    framingThirdsButton.setAttribute('aria-pressed', framingThirds ? 'true' : 'false');
    compareButton.classList.toggle('studio__background-compare--active', compareActive);
    compareButton.setAttribute('aria-pressed', compareActive ? 'true' : 'false');
    compareButton.disabled = recordingActive || !backgroundAvailable;
    if (framingOverlay) {
      framingOverlay.dataset.backgroundFramingAspect = framingAspect;
      framingOverlay.hidden = !backgroundAvailable || (framingAspect === 'native' && !framingThirds);
    }
    if (framingThirdsOverlay) framingThirdsOverlay.hidden = !framingThirds;
    if (framingLabel) framingLabel.textContent = activeDefinition.label;
    if (message) {
      framingStatus.value = message;
    } else if (compareActive) {
      framingStatus.value = 'Current theme & style only — personal image hidden. Preview without image; export unchanged.';
    } else if (framingAspect === 'native' && !framingThirds) {
      framingStatus.value = 'Full 16:9 frame. Turn on Thirds or choose a crop guide.';
    } else {
      framingStatus.value = `${activeDefinition.label}${framingThirds ? ' with thirds' : ''} · guide only; export remains 16:9.`;
    }
  }

  function finishCompare(message?: string, restoreCommitted = true): void {
    if (!compareActive) {
      syncFramingUi(message);
      return;
    }
    compareActive = false;
    hoveredPresetId = null;
    focusedPresetId = null;
    previewedPresetId = null;
    // BUG FIX: compare exit could preserve a desynchronized preset layout or bypass its single restore owner
    // Fix: normalize every exit through finishCompare and restore the exact committed media/layout when requested.
    // Sync: toggleCompare; sync; syncRecordingState; scripts/test-background-control-ui.mjs
    syncLayout(committedLayout, false);
    if (restoreCommitted) emit(false, committedBackgroundId, false, true);
    syncFramingUi(message);
    syncPresetUi();
  }

  function toggleCompare(): void {
    if (recordingActive || !backgroundAvailable) return;
    if (compareActive) {
      finishCompare('Personal background restored.');
      return;
    }
    finishColorSampling('Color sampling cancelled for comparison.');
    hoveredPresetId = null;
    focusedPresetId = null;
    previewedPresetId = null;
    syncLayout(committedLayout, false);
    compareActive = true;
    syncFramingUi();
    syncPresetUi();
    // CHANGED: Theme-only compare removes the personal image non-destructively in the live preview.
    // WHY: one existing hot-swap path keeps the comparison faithful without a second canvas or saved preference.
    emit(false, null, false, true);
  }

  function syncRecordingState(next: boolean): void {
    if (recordingActive === next) return;
    if (next) {
      // BUG FIX: Theme-only compare could survive until the first captured frame
      // Fix: restore the personal image at the capture boundary before Studio waits for its decode.
      // Sync: studio-recorder.ts; voice-recorder.ts
      if (compareActive) finishCompare('Compare paused while recording; personal background restored.');
      recordingActive = true;
      // BUG FIX: recording-time preset hover could create flash-heavy captured video
      // Fix: restore the committed frame before capture starts, then disable every transient preset entry point.
      // Sync: studio-recorder.ts; mount-clip-studio.ts; scripts/test-background-control-ui.mjs
      hoveredPresetId = null;
      focusedPresetId = null;
      restorePresetPreview();
      syncFramingUi();
      return;
    }
    recordingActive = false;
    syncPresetUi();
    syncFramingUi();
  }

  function finishColorSampling(message?: string): void {
    const wasSampling = samplingTargets.length > 0;
    for (const target of samplingTargets) {
      target.surface.removeEventListener('pointerdown', onCanvasSample, true);
    }
    samplingTargets = [];
    sampleMissCount = 0;
    samplingHost.classList.remove('studio__background-layout--sampling');
    eyeDropperButton.setAttribute('aria-pressed', 'false');
    if (wasSampling) options.onColorSamplingChange?.(false);
    if (message) sampleStatus.value = message;
  }

  function onCanvasSample(event: PointerEvent): void {
    const surface = event.currentTarget as HTMLElement | null;
    const target = samplingTargets.find((candidate) => candidate.surface === surface);
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // BUG FIX: precision mini was locked by sampling but could not produce a sample
    // Fix: resolve the bitmap paired with whichever registered preview surface received the click.
    // Sync: mount-clip-studio.ts; studio-v4-controls.css; scripts/test-background-control-ui.mjs
    const hex = sampleCanvasColorAtClient(target.canvas, event.clientX, event.clientY);
    if (!hex) {
      sampleMissCount += 1;
      // BUG FIX: failed eye-dropper clicks looked inert and left users unsure which tool owned the canvas
      // Fix: keep sampling active and escalate the live hint after repeated unavailable/transparent pixels.
      // Sync: scripts/test-background-control-ui.mjs
      sampleStatus.value = sampleMissCount >= 3
        ? 'Still sampling—choose a visible background pixel, or press Esc to cancel.'
        : 'That pixel could not be sampled. Choose another clear background area.';
      return;
    }
    sampledColor.style.background = hex;
    sampledColor.hidden = false;
    finishColorSampling(`${hex} applied to the bar color.`);
    options.onSampleColor?.(hex);
  }

  function beginColorSampling(): void {
    if (samplingTargets.length > 0) {
      finishColorSampling('Color sampling cancelled.');
      return;
    }
    if (compareActive) finishCompare('Personal background restored for color sampling.');
    const providedTargets = options.getEyeDropperTargets?.() ?? [];
    const fallbackCanvas = options.getEyeDropperCanvas?.()
      ?? root.querySelector<HTMLCanvasElement>(
        '.studio__hero [data-preview-canvas][data-preview-kind="primary"]',
      );
    const fallbackSurface = options.getEyeDropperSurface?.()
      ?? root.querySelector<HTMLElement>('[data-background-manipulator]')
      ?? fallbackCanvas;
    const candidates = providedTargets.length > 0
      ? providedTargets
      : fallbackCanvas && fallbackSurface
        ? [{ canvas: fallbackCanvas, surface: fallbackSurface }]
        : [];
    samplingTargets = candidates.filter(
      (target, index, all) => all.findIndex((other) => other.surface === target.surface) === index,
    );
    if (samplingTargets.length === 0) {
      sampleStatus.value = 'Open a background preview before sampling a color.';
      return;
    }
    sampleMissCount = 0;
    samplingHost.classList.add('studio__background-layout--sampling');
    eyeDropperButton.setAttribute('aria-pressed', 'true');
    sampleStatus.value = 'Click either preview to sample a clear pixel. Press Esc to cancel.';
    // BUG FIX: precision mini was locked by sampling but could not produce a sample
    // Fix: register every preview surface while direct manipulation is suspended on both.
    // Sync: background-direct-manipulation.ts; mount-clip-studio.ts; studio-v4-controls.css
    options.onColorSamplingChange?.(true);
    for (const target of samplingTargets) {
      target.surface.addEventListener('pointerdown', onCanvasSample, true);
    }
  }

  function onSamplerKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || samplingTargets.length === 0) return;
    event.preventDefault();
    finishColorSampling('Color sampling cancelled.');
    eyeDropperButton.focus();
  }

  for (const button of presetButtons) {
    const preset = presetForId(button.dataset.backgroundPreset);
    if (!preset) continue;
    button.addEventListener('pointerenter', () => {
      if (recordingActive || compareActive) return;
      hoveredPresetId = preset.id;
      reconcilePresetPreview();
    });
    button.addEventListener('pointerleave', () => {
      if (recordingActive || compareActive) return;
      hoveredPresetId = null;
      reconcilePresetPreview();
    });
    button.addEventListener('focus', () => {
      if (recordingActive || compareActive) return;
      focusedPresetId = preset.id;
      reconcilePresetPreview();
    });
    button.addEventListener('blur', () => {
      if (recordingActive || compareActive) return;
      focusedPresetId = null;
      reconcilePresetPreview();
    });
    button.addEventListener('click', () => {
      // BUG FIX: disabled preset controls still received synthetic pointer/focus events during compare
      // Fix: guard every audition entry point in logic, not only via disabled styling.
      // Sync: previewPreset; restorePresetPreview; scripts/test-background-control-ui.mjs
      if (recordingActive || compareActive) return;
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
    if (recordingActive || compareActive) return;
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
    if (committedBackgroundId && committedBackgroundId !== preset.backgroundId) {
      clearLayoutVariant('Alternate cleared because the personal background changed.');
    }
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
      announceLayout(layout, `${button.getAttribute('aria-label') ?? 'Position'} selected`);
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
      announceLayout(layout, button.title);
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
      announceLayout(layout, button.title);
    });
  }

  const disposeSliders = wirePhysicalSliders(panel, {
    isDisabled: (slider) =>
      slider.dataset.backgroundBlurSlider === 'true' && !blurToggle.checked,
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
      } else if (slider.dataset.backgroundDimSlider === 'true') {
        layout = normalizeUserBackgroundLayout({ ...layout, dim: value / 100 });
      } else if (slider.dataset.backgroundBlurSlider === 'true') {
        lastNonZeroBlur = value;
        layout = normalizeUserBackgroundLayout({ ...layout, blur: value });
      } else if (slider.dataset.backgroundGifSpeedSlider === 'true') {
        layout = normalizeUserBackgroundLayout({ ...layout, gifSpeed: value / 100 });
      } else {
        return;
      }
      syncLayout(layout);
      emit(false);
    },
    onInteractionEnd(slider) {
      emit(true);
      const axis = slider.dataset.backgroundPositionSlider as BackgroundPositionAxis | undefined;
      if (axis) announceLayout(layout, `${axis.toUpperCase()} position changed`);
      else if (slider.dataset.backgroundScaleSlider === 'true') announceLayout(layout, 'Zoom changed');
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
  for (const button of framingAspectButtons) {
    button.addEventListener('click', () => {
      const next = button.dataset.backgroundFramingAspectButton as BackgroundFramingAspect | undefined;
      if (!next || !BACKGROUND_FRAMING_ASPECTS.some((aspect) => aspect.id === next)) return;
      framingAspect = next;
      syncFramingUi();
    });
  }
  framingThirdsButton.addEventListener('click', () => {
    framingThirds = !framingThirds;
    syncFramingUi();
  });
  compareButton.addEventListener('click', toggleCompare);
  safeLock.addEventListener('change', () => {
    options.onGestureStart?.();
    layout = constrainForSafeText(normalizeUserBackgroundLayout({
      ...layout,
      lockToSafeText: safeLock.checked,
    }));
    syncLayout(layout);
    emit();
  });
  blurToggle.addEventListener('change', () => {
    options.onGestureStart?.();
    layout = normalizeUserBackgroundLayout({
      ...layout,
      blur: blurToggle.checked ? Math.max(1, lastNonZeroBlur) : 0,
    });
    syncLayout(layout);
    emit();
  });
  blendSelect.addEventListener('change', () => {
    options.onGestureStart?.();
    layout = normalizeUserBackgroundLayout({
      ...layout,
      blendMode: blendSelect.value as GlobalCompositeOperation,
    });
    syncLayout(layout);
    emit();
  });
  blendPlateSelect.addEventListener('change', () => {
    options.onGestureStart?.();
    layout = normalizeUserBackgroundLayout({
      ...layout,
      blendPlateSource: blendPlateSelect.value as BackgroundBlendPlateSource,
    });
    syncLayout(layout);
    if (layout.blendPlateSource === 'custom') blendPlateCustom.open = true;
    emit();
  });
  holoToggle.addEventListener('change', () => {
    options.onGestureStart?.();
    // CHANGED: the experimental holo treatment persists through the same normalized layout patch.
    // WHY: it must remain a personal-image property with preview/capture parity and no new state seam.
    layout = normalizeUserBackgroundLayout({
      ...layout,
      holo: holoToggle.checked,
    });
    syncLayout(layout);
    emit();
  });
  gifReactToggle.addEventListener('change', () => {
    options.onGestureStart?.();
    layout = normalizeUserBackgroundLayout({
      ...layout,
      gifReactToAudio: gifReactToggle.checked,
    });
    syncLayout(layout);
    emit();
  });
  eyeDropperButton.addEventListener('click', beginColorSampling);
  root.addEventListener('keydown', onSamplerKeydown, true);
  undoButton.addEventListener('click', () => options.onUndo?.());
  redoButton.addEventListener('click', () => options.onRedo?.());
  centerButton.addEventListener('click', () => {
    options.onGestureStart?.();
    layout = constrainForSafeText(normalizeUserBackgroundLayout({
      ...layout,
      position: 'center',
      customPosition: { x: 0.5, y: 0.5 },
    }));
    syncLayout(layout);
    emit();
    announceLayout(layout, 'Centered');
  });
  variantSaveButton.addEventListener('click', () => {
    if (!committedBackgroundId) return;
    // CHANGED: Phase 7 keeps one session-only framing snapshot for rapid next-take A/B choices.
    // WHY: captured pixels already own per-take truth, so an alternate layout needs no new preference or take schema.
    layoutVariant = {
      backgroundId: committedBackgroundId,
      layout: cloneLayout(layout),
    };
    syncVariantUi('Alternate framing saved for this background.');
    announceLayout(layout, 'Alternate framing saved');
  });
  variantSwapButton.addEventListener('click', () => {
    if (!layoutVariant || layoutVariant.backgroundId !== committedBackgroundId) return;
    options.onGestureStart?.();
    const previous = cloneLayout(layout);
    const next = cloneLayout(layoutVariant.layout);
    layoutVariant = { backgroundId: layoutVariant.backgroundId, layout: previous };
    syncLayout(next);
    emit();
    syncVariantUi('Framing swapped; the previous view is now the alternate.');
    announceLayout(layout, 'Framing variant selected');
  });

  blendPlatePicker = mountColorPickerControls(blendPlatePickerRoot, (overrides) => {
    if (syncing) return;
    if (!blendPlateEditActive) {
      blendPlateEditActive = true;
      options.onGestureStart?.();
    }
    layout = normalizeUserBackgroundLayout({
      ...layout,
      blendPlateColor: overrides.barColor,
    });
    syncTreatmentValues();
    emit(false);
    if (blendPlatePersistTimer) window.clearTimeout(blendPlatePersistTimer);
    blendPlatePersistTimer = window.setTimeout(() => {
      blendPlatePersistTimer = 0;
      blendPlateEditActive = false;
      emit(true);
    }, 200);
  });

  syncGuideVisibility();
  syncFramingUi();
  syncVariantUi();

  return {
    sync(prefs) {
      // BUG FIX: authoritative preference sync could clear compare outside its restore owner
      // Fix: retire through finishCompare without re-emitting the stale pre-sync background identity.
      if (compareActive) finishCompare(undefined, false);
      const hasBackground = Boolean(prefs.appearance.customBackgroundId);
      backgroundAvailable = hasBackground;
      panel.hidden = !hasBackground;
      if (!hasBackground) {
        finishColorSampling();
        committedBackgroundId = null;
        clearLayoutVariant();
        syncFramingUi();
        return;
      }
      const nextBackgroundId = prefs.appearance.customBackgroundId ?? null;
      if (committedBackgroundId && committedBackgroundId !== nextBackgroundId) {
        clearLayoutVariant('Alternate cleared because the personal background changed.');
      }
      committedBackgroundId = nextBackgroundId;
      syncLayout(userBackgroundLayoutFromAppearance(prefs.appearance), true);
      syncFramingUi();
    },
    syncLayout(next) {
      syncLayout(next, !emittingPresetPreview && !emittingComparePreview);
    },
    announceLayout,
    syncRecordingState,
    syncHistory(canUndo, canRedo) {
      undoButton.disabled = !canUndo;
      redoButton.disabled = !canRedo;
    },
    isSnapEnabled: () => snapEnabled,
    isGuidesEnabled: () => guidesEnabled,
    dispose() {
      if (compareActive) finishCompare();
      if (blendPlatePersistTimer) {
        window.clearTimeout(blendPlatePersistTimer);
        blendPlatePersistTimer = 0;
        blendPlateEditActive = false;
        emit(true);
      }
      blendPlatePicker.endInteraction();
      finishColorSampling();
      root.removeEventListener('keydown', onSamplerKeydown, true);
      disposeSliders();
    },
  };
}
