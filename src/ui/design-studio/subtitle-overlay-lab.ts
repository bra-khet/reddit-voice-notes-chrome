import {
  resolveCanvasOverlayGlowHex,
  resolveInnerBorderColor,
} from '@/src/transcription/subtitle-effects';
import { normalizeHexColor } from '@/src/theme/color-utils';
import {
  renderSubtitleOverlay,
  type SubtitleOverlayFrameDebugInfo,
  type SubtitleOverlayRenderMetrics,
  type SubtitleOverlayResult,
} from '@/src/transcription/subtitle-overlay-renderer';
import {
  OVERLAY_CONCAT_STAGE,
  renderSubtitleOverlayParallel,
} from '@/src/transcription/subtitle-overlay-parallel';
import {
  CUE_OVERLAY_CACHE_MAX_ENTRIES,
  CUE_OVERLAY_CACHE_PHASE_BUCKETS,
  type CueOverlayCacheStats,
} from '@/src/transcription/subtitle-overlay-cue-cache';
import {
  buildOverlayLabTimingSummary,
  OVERLAY_LAB_TIMING_LOG_VERSION,
  type OverlayLabEffectSnapshot,
  type OverlayLabRenderConfig,
  type OverlayLabTimingSummary,
} from '@/src/ui/design-studio/overlay-lab-timing-summary';
import {
  DEFAULT_SUBTITLE_SPECIAL_HUE,
  normalizeSubtitleStyle,
  type SubtitleGlowColorSource,
  type SubtitleGlowHueRotateMode,
  type SubtitleGlowMode,
  type SubtitleStyleConfig,
  type TranscriptResult,
} from '@/src/transcription/types';
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '@/src/utils/constants';
import { renderSubtitleOverlayWebCodecs } from '@/src/transcription/subtitle-overlay-webcodecs';
import { bakeWithCanvasOverlay } from '@/src/ui/design-studio/subtitle-canvas-bake';
import {
  formatBakeChronosLine,
  snapshotBakeChronos,
} from '@/src/ui/design-studio/bake-chronos';
import { renderSubtitleOverlayComparison } from '@/src/ui/design-studio/subtitle-overlay-compare';
import {
  OVERLAY_LAB_SEGMENT_SETS,
  overlayLabDurationSeconds,
  resolveOverlayLabTranscriptResult,
  type OverlayLabSegmentSetId,
} from '@/src/ui/design-studio/subtitle-overlay-lab-segments';
import {
  renderPhysicalSliderHtml,
  setPhysicalSliderValue,
  wirePhysicalSliders,
} from '@/src/ui/design-studio/physical-slider';

const LAB_STORAGE_KEY = 'rvn:subtitle-overlay-lab';

/** Gated QA panel — DEV builds always on; production via localStorage `rvn:subtitle-overlay-lab=1`. */
export function isSubtitleOverlayLabEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return localStorage.getItem(LAB_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export interface OverlayLabTimingEntry {
  stage: string;
  ratio?: number;
  elapsedMs: number;
  note?: string;
}

export interface OverlayLabTimingLog {
  /** Schema version — v2 adds summary, renderConfig, effects, cache stats. */
  version: number;
  action: 'render' | 'compare' | 'bake';
  segmentSet: OverlayLabSegmentSetId;
  cueCount: number;
  durationSeconds: number;
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  entries: OverlayLabTimingEntry[];
  renderConfig?: OverlayLabRenderConfig;
  effects?: OverlayLabEffectSnapshot;
  summary?: OverlayLabTimingSummary;
  error?: string;
}

export interface SubtitleOverlayLabOptions {
  getBaseStyle: () => SubtitleStyleConfig;
  getSessionEdited: () => TranscriptResult | null | undefined;
  getThemeBarColor?: () => string | undefined;
}

export interface SubtitleOverlayLabHandle {
  dispose(): void;
}

function previewInnerBorderHex(style: SubtitleStyleConfig, themeBarColor: string): string {
  const outerHex = resolveCanvasOverlayGlowHex(style, themeBarColor, 0);
  const glow = style.glow;
  const userChoseSpecialHue =
    style.textColor === 'special' ||
    glow?.colorSource === 'special' ||
    normalizeHexColor(style.specialHue ?? '') !== normalizeHexColor(DEFAULT_SUBTITLE_SPECIAL_HUE);
  return resolveInnerBorderColor(outerHex, userChoseSpecialHue ? style.specialHue : undefined);
}

function mergeLabStyle(
  base: SubtitleStyleConfig,
  controls: {
    textGradient: boolean;
    textGradientWave: boolean;
    glowEnabled: boolean;
    glowMode: SubtitleGlowMode;
    glowColorSource: SubtitleGlowColorSource;
    hueRotateMode: SubtitleGlowHueRotateMode;
    dualBorder: boolean;
    backdropBorderRadius: number;
  },
): SubtitleStyleConfig {
  return normalizeSubtitleStyle({
    ...base,
    textGradient: controls.textGradient,
    textGradientWave: controls.textGradientWave,
    backdrop: {
      ...base.backdrop,
      borderRadius: controls.backdropBorderRadius,
    },
    glow: {
      ...base.glow,
      enabled: controls.glowEnabled,
      mode: controls.glowMode,
      colorSource: controls.glowColorSource,
      hueRotateMode: controls.hueRotateMode,
      dualBorder: controls.dualBorder,
    },
  });
}

function readLabControls(panel: HTMLElement): {
  segmentSet: OverlayLabSegmentSetId;
  textGradient: boolean;
  textGradientWave: boolean;
  glowEnabled: boolean;
  glowMode: SubtitleGlowMode;
  glowColorSource: SubtitleGlowColorSource;
  hueRotateMode: SubtitleGlowHueRotateMode;
  dualBorder: boolean;
  backdropBorderRadius: number;
  singleFrameDebug: boolean;
  parallelRender: boolean;
  webCodecsRender: boolean;
} {
  const segmentSet =
    (panel.querySelector<HTMLSelectElement>('[data-overlay-lab-segment-set]')?.value as
      | OverlayLabSegmentSetId
      | undefined) ?? 'session';
  const backdropRadiusEl = panel.querySelector<HTMLElement>('[data-overlay-lab-backdrop-radius]');
  return {
    segmentSet,
    textGradient: panel.querySelector<HTMLInputElement>('[data-overlay-lab-text-gradient]')?.checked === true,
    textGradientWave:
      panel.querySelector<HTMLInputElement>('[data-overlay-lab-text-gradient-wave]')?.checked === true,
    glowEnabled: panel.querySelector<HTMLInputElement>('[data-overlay-lab-glow]')?.checked === true,
    glowMode:
      (panel.querySelector<HTMLSelectElement>('[data-overlay-lab-glow-mode]')?.value as
        | SubtitleGlowMode
        | undefined) ?? 'halo',
    glowColorSource:
      (panel.querySelector<HTMLSelectElement>('[data-overlay-lab-glow-color]')?.value as
        | SubtitleGlowColorSource
        | undefined) ?? 'theme',
    hueRotateMode:
      (panel.querySelector<HTMLSelectElement>('[data-overlay-lab-hue-rotate-mode]')?.value as
        | SubtitleGlowHueRotateMode
        | undefined) ?? 'rainbow',
    dualBorder: panel.querySelector<HTMLInputElement>('[data-overlay-lab-dual-border]')?.checked === true,
    backdropBorderRadius: Number(backdropRadiusEl?.dataset.value ?? 8),
    singleFrameDebug:
      panel.querySelector<HTMLInputElement>('[data-overlay-lab-single-frame-debug]')?.checked === true,
    parallelRender:
      panel.querySelector<HTMLInputElement>('[data-overlay-lab-parallel-render]')?.checked === true,
    webCodecsRender:
      panel.querySelector<HTMLInputElement>('[data-overlay-lab-webcodecs]')?.checked === true,
  };
}

export function renderSubtitleOverlayLabHtml(): string {
  const segmentOptions = OVERLAY_LAB_SEGMENT_SETS.map(
    (set) => `<option value="${set.id}">${set.label}</option>`,
  ).join('');

  return `
    <details class="studio__subtitle-overlay-lab" data-subtitle-overlay-lab open>
      <summary class="studio__subtitle-overlay-lab-summary">
        v5.3.4 Subtitle Overlay Lab
        <span class="popup__micro">QA</span>
      </summary>
      <p class="popup__field-desc studio__subtitle-overlay-lab-intro">
        Persistent visual QA harness — synthetic segment sets, rich-effect toggles, side-by-side compare,
        downloads, and timing logs. Uses session transcript when set to Session; compare and full bake
        still need a recorded base MP4.
      </p>
      <label class="popup__field studio__field--compact">
        <span class="popup__field-label">Test segment set</span>
        <select class="popup__select" data-overlay-lab-segment-set aria-label="Overlay lab segment set">
          ${segmentOptions}
        </select>
      </label>
      <div class="studio__subtitle-overlay-lab-effects" data-overlay-lab-effects>
        <p class="popup__field-label">Effect toggles (lab)</p>
        <label class="popup__toggle-row studio__subtitles-toggle">
          <span class="popup__toggle-copy">
            <span class="popup__toggle-label">Theme glow</span>
          </span>
          <input class="popup__toggle-input" type="checkbox" data-overlay-lab-glow aria-label="Lab theme glow" />
        </label>
        <label class="popup__field studio__field--compact">
          <span class="popup__field-label">Glow style</span>
          <select class="popup__select" data-overlay-lab-glow-mode aria-label="Lab glow style">
            <option value="halo">Halo (soft)</option>
            <option value="border">Border (solid)</option>
          </select>
        </label>
        <label class="popup__field studio__field--compact">
          <span class="popup__field-label">Glow color</span>
          <select class="popup__select" data-overlay-lab-glow-color aria-label="Lab glow color">
            <option value="theme">Theme hue</option>
            <option value="black">Black</option>
            <option value="white">White</option>
            <option value="special">Special hue</option>
            <option value="rainbow">Hue rotate</option>
          </select>
        </label>
        <label class="popup__field studio__field--compact" data-overlay-lab-hue-rotate-panel hidden>
          <span class="popup__field-label">Hue rotate mode</span>
          <select class="popup__select" data-overlay-lab-hue-rotate-mode aria-label="Lab hue rotate mode">
            <option value="rainbow">Rainbow (full wheel)</option>
            <option value="monochromatic">Monochromatic (theme family)</option>
          </select>
        </label>
        <label class="popup__toggle-row studio__subtitles-toggle">
          <span class="popup__toggle-copy">
            <span class="popup__toggle-label">Dual border</span>
          </span>
          <input class="popup__toggle-input" type="checkbox" data-overlay-lab-dual-border aria-label="Lab dual border" />
        </label>
        <label class="popup__toggle-row studio__subtitles-toggle">
          <span class="popup__toggle-copy">
            <span class="popup__toggle-label">Text gradient</span>
          </span>
          <input class="popup__toggle-input" type="checkbox" data-overlay-lab-text-gradient aria-label="Lab text gradient" checked />
        </label>
        <label class="popup__toggle-row studio__subtitles-toggle">
          <span class="popup__toggle-copy">
            <span class="popup__toggle-label">Text gradient wave</span>
          </span>
          <input class="popup__toggle-input" type="checkbox" data-overlay-lab-text-gradient-wave aria-label="Lab text gradient wave" />
        </label>
        <label class="popup__field studio__field--compact">
          <span class="popup__field-label">
            Backdrop radius <span data-overlay-lab-backdrop-radius-value>8px</span>
          </span>
          ${renderPhysicalSliderHtml({
            min: 0,
            max: 24,
            step: 1,
            value: 8,
            ariaLabel: 'Lab backdrop border radius',
            dataAttrs: { 'overlay-lab-backdrop-radius': '' },
          })}
        </label>
        <div class="studio__subtitle-overlay-lab-inner-border" data-overlay-lab-inner-border-preview>
          <span class="popup__field-label">Inner border preview</span>
          <span class="studio__subtitle-overlay-lab-swatch" data-overlay-lab-inner-border-swatch aria-hidden="true"></span>
          <code class="studio__subtitle-overlay-lab-hex" data-overlay-lab-inner-border-hex>#000000</code>
          <p class="popup__field-desc">Computed from outer glow + special hue — canvas dual border only.</p>
        </div>
      </div>
      <label class="popup__toggle-row studio__subtitles-toggle">
        <span class="popup__toggle-copy">
          <span class="popup__toggle-label">Single-frame debug</span>
          <p class="popup__field-desc">Pause after each painted frame during overlay render.</p>
        </span>
        <input
          class="popup__toggle-input"
          type="checkbox"
          data-overlay-lab-single-frame-debug
          aria-label="Single-frame debug for canvas overlay render"
        />
      </label>
      <label class="popup__toggle-row studio__subtitles-toggle">
        <span class="popup__toggle-copy">
          <span class="popup__toggle-label">Parallel chunked render (v5.3.9)</span>
          <p class="popup__field-desc">Force concurrent chunk captures + FFmpeg concat for A/B timing. Ignored with single-frame debug.</p>
        </span>
        <input
          class="popup__toggle-input"
          type="checkbox"
          data-overlay-lab-parallel-render
          aria-label="Parallel chunked render for canvas overlay"
        />
      </label>
      <label class="popup__toggle-row studio__subtitles-toggle">
        <span class="popup__toggle-copy">
          <span class="popup__toggle-label">WebCodecs encode (v5.3.10)</span>
          <p class="popup__field-desc">
            VideoEncoder dual-stream IVF path (probe-gated, MediaRecorder fallback). Render action
            reports timing only — segments have no direct preview; use full bake to view. Ignored
            with single-frame debug.
          </p>
        </span>
        <input
          class="popup__toggle-input"
          type="checkbox"
          data-overlay-lab-webcodecs
          aria-label="WebCodecs encode for canvas overlay"
        />
      </label>
      <div class="popup__profile-actions studio__inline-actions studio__subtitle-overlay-lab-actions">
        <button type="button" class="popup__profile-btn popup__profile-btn--negate" data-overlay-lab-render-btn>
          Render overlay
        </button>
        <button type="button" class="popup__profile-btn popup__profile-btn--negate" data-overlay-lab-compare-btn>
          Compare drawtext vs canvas
        </button>
        <button type="button" class="popup__profile-btn popup__profile-btn--negate" data-overlay-lab-bake-btn>
          Run full bake (canvas)
        </button>
      </div>
    </details>
    <div class="studio__transcript-modal" data-subtitle-overlay-preview-modal hidden>
      <div
        class="studio__transcript-dialog studio__transcript-dialog--overlay-preview"
        data-subtitle-overlay-preview-dialog
        role="dialog"
        aria-labelledby="subtitle-overlay-preview-title"
      >
        <h3 class="studio__transcript-dialog-title" id="subtitle-overlay-preview-title">
          Subtitle Overlay Lab
        </h3>
        <p class="popup__field-desc" data-subtitle-overlay-preview-status>Rendering…</p>
        <img
          class="studio__subtitle-overlay-preview-frame"
          data-subtitle-overlay-preview-frame
          alt="Canvas overlay frame debug preview"
          hidden
        />
        <div class="studio__subtitle-overlay-compare" data-subtitle-overlay-compare-panel hidden>
          <p class="popup__field-label studio__subtitle-overlay-compare-label">Old drawtext (baked on base MP4)</p>
          <video
            class="studio__subtitle-overlay-preview-video"
            data-subtitle-overlay-compare-drawtext
            controls
            playsinline
            muted
          ></video>
          <p class="popup__field-label studio__subtitle-overlay-compare-label">New Canvas v5.3.4 (overlay only)</p>
          <div class="studio__subtitle-overlay-canvas-wrap">
            <video
              class="studio__subtitle-overlay-preview-video studio__subtitle-overlay-preview-video--alpha"
              data-subtitle-overlay-compare-canvas
              controls
              playsinline
              muted
            ></video>
          </div>
        </div>
        <video
          class="studio__subtitle-overlay-preview-video"
          data-subtitle-overlay-preview-video
          controls
          autoplay
          playsinline
          muted
        ></video>
        <div class="popup__profile-actions studio__inline-actions studio-v4__guard-actions studio__subtitle-overlay-lab-downloads">
          <button
            type="button"
            class="popup__button popup__button--secondary studio-v4__guard-cancel"
            data-subtitle-overlay-preview-close
          >
            Close
          </button>
          <button
            type="button"
            class="popup__profile-btn popup__profile-btn--save"
            data-overlay-lab-download-overlay
            disabled
          >
            Overlay.webm
          </button>
          <button
            type="button"
            class="popup__profile-btn popup__profile-btn--save"
            data-overlay-lab-download-drawtext
            disabled
          >
            Drawtext.mp4
          </button>
          <button
            type="button"
            class="popup__profile-btn popup__profile-btn--save"
            data-overlay-lab-download-composite
            disabled
          >
            Composite.mp4
          </button>
          <button
            type="button"
            class="popup__profile-btn popup__profile-btn--save"
            data-overlay-lab-download-timing
            disabled
          >
            Timing log
          </button>
        </div>
      </div>
    </div>
  `;
}

export function mountSubtitleOverlayLab(
  panel: HTMLElement,
  options: SubtitleOverlayLabOptions,
): SubtitleOverlayLabHandle {
  const labRoot = panel.querySelector<HTMLElement>('[data-subtitle-overlay-lab]');
  if (!labRoot) {
    return { dispose() {} };
  }

  const renderBtn = panel.querySelector<HTMLButtonElement>('[data-overlay-lab-render-btn]');
  const compareBtn = panel.querySelector<HTMLButtonElement>('[data-overlay-lab-compare-btn]');
  const bakeBtn = panel.querySelector<HTMLButtonElement>('[data-overlay-lab-bake-btn]');
  const overlayPreviewModal = panel.querySelector<HTMLElement>('[data-subtitle-overlay-preview-modal]');
  const overlayPreviewVideo = panel.querySelector<HTMLVideoElement>('[data-subtitle-overlay-preview-video]');
  const overlayPreviewStatus = panel.querySelector<HTMLElement>('[data-subtitle-overlay-preview-status]');
  const overlayPreviewClose = panel.querySelector<HTMLButtonElement>('[data-subtitle-overlay-preview-close]');
  const overlayPreviewFrameImg = panel.querySelector<HTMLImageElement>('[data-subtitle-overlay-preview-frame]');
  const overlayPreviewDialog = panel.querySelector<HTMLElement>('[data-subtitle-overlay-preview-dialog]');
  const overlayComparePanel = panel.querySelector<HTMLElement>('[data-subtitle-overlay-compare-panel]');
  const overlayCompareDrawtextVideo = panel.querySelector<HTMLVideoElement>(
    '[data-subtitle-overlay-compare-drawtext]',
  );
  const overlayCompareCanvasVideo = panel.querySelector<HTMLVideoElement>(
    '[data-subtitle-overlay-compare-canvas]',
  );
  const downloadOverlayBtn = panel.querySelector<HTMLButtonElement>('[data-overlay-lab-download-overlay]');
  const downloadDrawtextBtn = panel.querySelector<HTMLButtonElement>('[data-overlay-lab-download-drawtext]');
  const downloadCompositeBtn = panel.querySelector<HTMLButtonElement>('[data-overlay-lab-download-composite]');
  const downloadTimingBtn = panel.querySelector<HTMLButtonElement>('[data-overlay-lab-download-timing]');
  const hueRotatePanel = panel.querySelector<HTMLElement>('[data-overlay-lab-hue-rotate-panel]');
  const innerBorderSwatch = panel.querySelector<HTMLElement>('[data-overlay-lab-inner-border-swatch]');
  const innerBorderHexEl = panel.querySelector<HTMLElement>('[data-overlay-lab-inner-border-hex]');
  const backdropRadiusInput = panel.querySelector<HTMLElement>('[data-overlay-lab-backdrop-radius]');
  const backdropRadiusValueEl = panel.querySelector<HTMLElement>('[data-overlay-lab-backdrop-radius-value]');
  const textGradientWaveInput = panel.querySelector<HTMLInputElement>('[data-overlay-lab-text-gradient-wave]');
  const textGradientInput = panel.querySelector<HTMLInputElement>('[data-overlay-lab-text-gradient]');
  const glowInput = panel.querySelector<HTMLInputElement>('[data-overlay-lab-glow]');
  const glowColorSelect = panel.querySelector<HTMLSelectElement>('[data-overlay-lab-glow-color]');

  let overlayUrl: string | null = null;
  let drawtextUrl: string | null = null;
  let compositeUrl: string | null = null;
  let timingLog: OverlayLabTimingLog | null = null;
  let busy = false;

  const revokeUrl = (url: string | null): void => {
    if (!url) return;
    URL.revokeObjectURL(url);
    if (overlayUrl === url) overlayUrl = null;
    if (drawtextUrl === url) drawtextUrl = null;
    if (compositeUrl === url) compositeUrl = null;
  };

  const syncDownloadButtons = (): void => {
    if (downloadOverlayBtn) downloadOverlayBtn.disabled = !overlayUrl;
    if (downloadDrawtextBtn) downloadDrawtextBtn.disabled = !drawtextUrl;
    if (downloadCompositeBtn) downloadCompositeBtn.disabled = !compositeUrl;
    if (downloadTimingBtn) downloadTimingBtn.disabled = !timingLog;
  };

  const setPreviewMode = (mode: 'single' | 'compare' | 'baked'): void => {
    if (overlayComparePanel) overlayComparePanel.hidden = mode !== 'compare';
    if (overlayPreviewVideo) overlayPreviewVideo.hidden = mode !== 'single' && mode !== 'baked';
    overlayPreviewDialog?.classList.toggle('studio__transcript-dialog--overlay-compare', mode === 'compare');
  };

  const hideModal = (): void => {
    if (overlayPreviewModal) overlayPreviewModal.hidden = true;
    setPreviewMode('single');
    if (overlayPreviewFrameImg) {
      overlayPreviewFrameImg.hidden = true;
      overlayPreviewFrameImg.removeAttribute('src');
    }
    if (overlayPreviewVideo) {
      overlayPreviewVideo.pause();
      overlayPreviewVideo.muted = true;
      overlayPreviewVideo.removeAttribute('src');
      overlayPreviewVideo.load();
    }
    if (overlayCompareDrawtextVideo) {
      overlayCompareDrawtextVideo.pause();
      overlayCompareDrawtextVideo.removeAttribute('src');
      overlayCompareDrawtextVideo.load();
    }
    if (overlayCompareCanvasVideo) {
      overlayCompareCanvasVideo.pause();
      overlayCompareCanvasVideo.removeAttribute('src');
      overlayCompareCanvasVideo.load();
    }
  };

  const resolveLabContext = (): {
    edited: TranscriptResult;
    style: SubtitleStyleConfig;
    durationSeconds: number;
    controls: ReturnType<typeof readLabControls>;
  } | null => {
    const controls = readLabControls(panel);
    const sessionEdited = options.getSessionEdited();
    const edited = resolveOverlayLabTranscriptResult(controls.segmentSet, sessionEdited);
    if (!edited?.segments?.length) return null;
    const style = mergeLabStyle(options.getBaseStyle(), controls);
    const durationSeconds = overlayLabDurationSeconds(controls.segmentSet, edited);
    return { edited, style, durationSeconds, controls };
  };

  const syncLabEffectUi = (): void => {
    const controls = readLabControls(panel);
    const gradientOn = controls.textGradient;
    if (textGradientWaveInput) {
      textGradientWaveInput.disabled = !gradientOn;
      if (!gradientOn) textGradientWaveInput.checked = false;
    }
    const hueRotate = controls.glowColorSource === 'rainbow';
    if (hueRotatePanel) hueRotatePanel.hidden = !controls.glowEnabled || !hueRotate;
    const themeBarColor = options.getThemeBarColor?.() ?? '#00e5ff';
    const style = mergeLabStyle(options.getBaseStyle(), controls);
    const innerHex = previewInnerBorderHex(style, themeBarColor);
    if (innerBorderSwatch) innerBorderSwatch.style.backgroundColor = innerHex;
    if (innerBorderHexEl) innerBorderHexEl.textContent = innerHex;
  };

  const seedLabFromBaseStyle = (): void => {
    const base = options.getBaseStyle();
    if (glowInput) glowInput.checked = base.glow?.enabled === true;
    const glowModeSelect = panel.querySelector<HTMLSelectElement>('[data-overlay-lab-glow-mode]');
    if (glowModeSelect) glowModeSelect.value = base.glow?.mode ?? 'halo';
    if (glowColorSelect) glowColorSelect.value = base.glow?.colorSource ?? 'theme';
    const hueRotateModeSelect = panel.querySelector<HTMLSelectElement>('[data-overlay-lab-hue-rotate-mode]');
    if (hueRotateModeSelect) hueRotateModeSelect.value = base.glow?.hueRotateMode ?? 'rainbow';
    const dualBorderInput = panel.querySelector<HTMLInputElement>('[data-overlay-lab-dual-border]');
    if (dualBorderInput) dualBorderInput.checked = base.glow?.dualBorder === true;
    if (textGradientInput) textGradientInput.checked = base.textGradient !== false;
    if (textGradientWaveInput) textGradientWaveInput.checked = base.textGradientWave === true;
    const radius = base.backdrop?.borderRadius ?? 8;
    if (backdropRadiusInput) {
      setPhysicalSliderValue(backdropRadiusInput, radius);
      if (backdropRadiusValueEl) backdropRadiusValueEl.textContent = `${radius}px`;
    }
    syncLabEffectUi();
  };

  seedLabFromBaseStyle();

  const unwireBackdropRadius = backdropRadiusInput
    ? wirePhysicalSliders(backdropRadiusInput, {
        onValueChange(_slider, value) {
          if (backdropRadiusValueEl) backdropRadiusValueEl.textContent = `${value}px`;
          syncLabEffectUi();
        },
      })
    : () => {};

  const onLabControlChange = (): void => syncLabEffectUi();
  labRoot.addEventListener('change', onLabControlChange);
  labRoot.addEventListener('input', onLabControlChange);

  const buildLabRenderConfig = (): OverlayLabRenderConfig => ({
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    fps: 30,
    cueCacheEnabled: true,
    phaseBuckets: CUE_OVERLAY_CACHE_PHASE_BUCKETS,
    cacheMaxEntries: CUE_OVERLAY_CACHE_MAX_ENTRIES,
  });

  const buildLabEffectSnapshot = (
    controls: ReturnType<typeof readLabControls>,
  ): OverlayLabEffectSnapshot => ({
    textGradient: controls.textGradient,
    textGradientWave: controls.textGradientWave,
    glowEnabled: controls.glowEnabled,
    glowMode: controls.glowMode,
    glowColorSource: controls.glowColorSource,
    hueRotateMode: controls.hueRotateMode,
    dualBorder: controls.dualBorder,
    backdropBorderRadius: controls.backdropBorderRadius,
  });

  const startTimingLog = (
    action: OverlayLabTimingLog['action'],
    segmentSet: OverlayLabSegmentSetId,
    cueCount: number,
    durationSeconds: number,
    controls: ReturnType<typeof readLabControls>,
  ): { log: OverlayLabTimingLog; startedAtMs: number } => {
    const startedAtMs = performance.now();
    const log: OverlayLabTimingLog = {
      version: OVERLAY_LAB_TIMING_LOG_VERSION,
      action,
      segmentSet,
      cueCount,
      durationSeconds,
      startedAt: new Date().toISOString(),
      finishedAt: '',
      elapsedMs: 0,
      entries: [],
      renderConfig: buildLabRenderConfig(),
      effects: buildLabEffectSnapshot(controls),
    };
    timingLog = log;
    syncDownloadButtons();
    return { log, startedAtMs };
  };

  const finishTimingLog = (
    log: OverlayLabTimingLog,
    startedAtMs: number,
    renderMetrics?: SubtitleOverlayRenderMetrics | null,
    error?: string,
  ): void => {
    log.finishedAt = new Date().toISOString();
    log.elapsedMs = Math.round(performance.now() - startedAtMs);
    if (error) log.error = error;
    log.summary = buildOverlayLabTimingSummary({
      totalMs: log.elapsedMs,
      durationSeconds: log.durationSeconds,
      cueCount: log.cueCount,
      entries: log.entries,
      renderMetrics,
    });
    timingLog = log;
    syncDownloadButtons();
  };

  const appendTimingEntry = (
    log: OverlayLabTimingLog,
    startedAtMs: number,
    stage: string,
    ratio?: number,
    note?: string,
  ): void => {
    log.entries.push({
      stage,
      ratio,
      elapsedMs: Math.round(performance.now() - startedAtMs),
      note,
    });
  };

  const triggerDownload = (url: string | null, filename: string): void => {
    if (!url) return;
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  };

  renderBtn?.addEventListener('click', () => {
    void (async () => {
      if (busy) return;
      const ctx = resolveLabContext();
      if (!ctx) {
        console.warn('[Reddit Voice Notes] Overlay lab: no segments to render');
        return;
      }
      busy = true;
      const { edited, style, durationSeconds, controls } = ctx;
      const themeBarColor = options.getThemeBarColor?.();
      const { log, startedAtMs } = startTimingLog(
        'render',
        controls.segmentSet,
        edited.segments.length,
        durationSeconds,
        controls,
      );
      let renderMetrics: SubtitleOverlayRenderMetrics | null = null;

      if (overlayPreviewModal) overlayPreviewModal.hidden = false;
      setPreviewMode('single');
      revokeUrl(overlayUrl);
      revokeUrl(drawtextUrl);
      revokeUrl(compositeUrl);
      drawtextUrl = null;
      compositeUrl = null;
      syncDownloadButtons();
      if (overlayPreviewStatus) {
        overlayPreviewStatus.textContent =
          `Rendering ${edited.segments.length} cue(s)… (capture + FFmpeg finalize)`;
      }
      if (overlayPreviewFrameImg) {
        overlayPreviewFrameImg.hidden = !controls.singleFrameDebug;
        overlayPreviewFrameImg.removeAttribute('src');
      }

      console.time('overlay-lab-render');
      try {
        appendTimingEntry(log, startedAtMs, 'render-start');
        const labRenderOptions = {
          width: CANVAS_WIDTH,
          height: CANVAS_HEIGHT,
          fps: 30,
          background: 'transparent' as const,
          offline: true,
          themeBarColor,
          singleFrameDebug: controls.singleFrameDebug,
          enableCueCache: !controls.singleFrameDebug,
          onFrameDebug: controls.singleFrameDebug
            ? async (info: SubtitleOverlayFrameDebugInfo) => {
                if (overlayPreviewFrameImg) {
                  overlayPreviewFrameImg.hidden = false;
                  overlayPreviewFrameImg.src = info.imageUrl;
                }
                if (overlayPreviewStatus) {
                  overlayPreviewStatus.textContent =
                    `Frame ${info.frameIndex + 1} @ ${info.timestampSeconds.toFixed(2)}s…`;
                }
              }
            : undefined,
          debug: {
            onCacheStats: (stats: CueOverlayCacheStats) => {
              appendTimingEntry(
                log,
                startedAtMs,
                'cue-cache-stats',
                undefined,
                JSON.stringify(stats),
              );
            },
          },
        };
        // v5.3.10 A/B: WebCodecs dual-stream encode. Produces IVF segments
        // (not a playable WebM), so this branch reports timing + metrics and
        // skips the preview player; the full-bake button is the visual check.
        if (controls.webCodecsRender && !controls.singleFrameDebug) {
          const webCodecsResult = await renderSubtitleOverlayWebCodecs(
            edited.segments,
            style,
            durationSeconds,
            {
              ...labRenderOptions,
              parallel: controls.parallelRender ? 'force' : 'auto',
            },
            {
              onPlan: (plan) => {
                appendTimingEntry(
                  log,
                  startedAtMs,
                  'webcodecs-plan',
                  undefined,
                  JSON.stringify(
                    plan.map((chunk) => ({
                      startFrame: chunk.startFrame,
                      frameCount: chunk.frameCount,
                      cutQuality: chunk.cutQuality,
                    })),
                  ),
                );
              },
              onSegmentEncoded: (meta) => {
                appendTimingEntry(
                  log,
                  startedAtMs,
                  'webcodecs-segment',
                  undefined,
                  JSON.stringify({
                    index: meta.index,
                    frames: meta.frameCount,
                    encodeMs: meta.encodeMs,
                    paintMs: meta.paintMs,
                    colorBytes: meta.colorBytes,
                    alphaBytes: meta.alphaBytes,
                    cueCount: meta.cueSpan.cueCount,
                  }),
                );
              },
            },
          );
          if (webCodecsResult) {
            console.timeEnd('overlay-lab-render');
            renderMetrics = webCodecsResult.renderMetrics;
            appendTimingEntry(
              log,
              startedAtMs,
              'webcodecs-result',
              undefined,
              JSON.stringify({
                codec: webCodecsResult.codec,
                chunkCount: webCodecsResult.chunkCount,
                stitchMs: webCodecsResult.stitchMs,
                alphaLimitedRange: webCodecsResult.calibration.limitedRange,
                colorBytes: webCodecsResult.colorIvf.byteLength,
                alphaBytes: webCodecsResult.alphaIvf.byteLength,
              }),
            );
            appendTimingEntry(log, startedAtMs, 'render-complete');
            finishTimingLog(log, startedAtMs, renderMetrics);
            if (overlayPreviewStatus) {
              overlayPreviewStatus.textContent =
                `WebCodecs segments ready (${webCodecsResult.chunkCount} × ${webCodecsResult.codec}, ` +
                `${webCodecsResult.renderMetrics.renderWallMs}ms, ` +
                `${webCodecsResult.renderMetrics.realtimeFactor.toFixed(2)}× realtime). ` +
                'IVF has no direct preview — run the full bake to view.';
            }
            syncDownloadButtons();
            return;
          }
          // Probe/encode declined — record it and A/B via MediaRecorder below.
          appendTimingEntry(log, startedAtMs, 'webcodecs-unavailable');
        }

        // v5.3.9 A/B: forced parallel chunked render vs classic serial path.
        let renderResult: SubtitleOverlayResult;
        if (controls.parallelRender && !controls.singleFrameDebug) {
          const parallelResult = await renderSubtitleOverlayParallel(
            edited.segments,
            style,
            durationSeconds,
            { ...labRenderOptions, parallel: 'force' },
            {
              onPlan: (plan) => {
                appendTimingEntry(
                  log,
                  startedAtMs,
                  'parallel-plan',
                  undefined,
                  JSON.stringify(
                    plan.map((chunk) => ({
                      startFrame: chunk.startFrame,
                      frameCount: chunk.frameCount,
                      cutQuality: chunk.cutQuality,
                    })),
                  ),
                );
              },
              // Shared stage label — lets computeOverlayLabStageDurations report
              // concatMs for the Lab's render action too (v5.3.9.1).
              onConcatPhase: (phase) => {
                appendTimingEntry(log, startedAtMs, OVERLAY_CONCAT_STAGE, undefined, phase);
              },
            },
          );
          appendTimingEntry(
            log,
            startedAtMs,
            'parallel-result',
            undefined,
            JSON.stringify({
              wasParallel: parallelResult.wasParallel,
              chunkCount: parallelResult.chunkCount,
            }),
          );
          renderResult = parallelResult;
        } else {
          renderResult = await renderSubtitleOverlay(
            edited.segments,
            style,
            durationSeconds,
            labRenderOptions,
          );
        }
        renderMetrics = renderResult.renderMetrics ?? null;
        const objectUrl = URL.createObjectURL(renderResult.overlayBlob);
        console.timeEnd('overlay-lab-render');
        appendTimingEntry(log, startedAtMs, 'render-complete');
        finishTimingLog(log, startedAtMs, renderMetrics);

        overlayUrl = objectUrl;
        if (overlayPreviewVideo) {
          overlayPreviewVideo.src = objectUrl;
          void overlayPreviewVideo.play().catch(() => {});
        }
        if (overlayPreviewStatus) {
          overlayPreviewStatus.textContent =
            `Overlay ready (${durationSeconds.toFixed(1)}s, ${edited.segments.length} cue(s)).`;
        }
        syncDownloadButtons();
      } catch (error: unknown) {
        console.timeEnd('overlay-lab-render');
        const message = error instanceof Error ? error.message : String(error);
        finishTimingLog(log, startedAtMs, renderMetrics, message);
        if (overlayPreviewStatus) overlayPreviewStatus.textContent = `Render failed: ${message}`;
        console.error('[Reddit Voice Notes] Overlay lab render failed', error);
      } finally {
        busy = false;
      }
    })();
  });

  compareBtn?.addEventListener('click', () => {
    void (async () => {
      if (busy) return;
      const ctx = resolveLabContext();
      if (!ctx) {
        console.warn('[Reddit Voice Notes] Overlay lab compare: no segments');
        return;
      }
      busy = true;
      const { edited, style, durationSeconds, controls } = ctx;
      const themeBarColor = options.getThemeBarColor?.();
      const { log, startedAtMs } = startTimingLog(
        'compare',
        controls.segmentSet,
        edited.segments.length,
        durationSeconds,
        controls,
      );

      if (overlayPreviewModal) overlayPreviewModal.hidden = false;
      setPreviewMode('compare');
      revokeUrl(overlayUrl);
      revokeUrl(drawtextUrl);
      revokeUrl(compositeUrl);
      overlayUrl = null;
      drawtextUrl = null;
      compositeUrl = null;
      syncDownloadButtons();
      if (overlayPreviewStatus) {
        overlayPreviewStatus.textContent =
          `Comparing drawtext vs canvas (${edited.segments.length} cue(s))…`;
      }
      if (overlayPreviewFrameImg) overlayPreviewFrameImg.hidden = true;
      if (overlayPreviewVideo) {
        overlayPreviewVideo.pause();
        overlayPreviewVideo.removeAttribute('src');
        overlayPreviewVideo.load();
      }

      console.time('overlay-lab-compare');
      try {
        appendTimingEntry(log, startedAtMs, 'compare-start');
        const result = await renderSubtitleOverlayComparison(
          edited,
          style,
          durationSeconds,
          themeBarColor,
          {
            onCanvasOverlayReady: (canvasUrl) => {
              overlayUrl = canvasUrl;
              if (overlayCompareCanvasVideo) {
                overlayCompareCanvasVideo.src = canvasUrl;
                void overlayCompareCanvasVideo.play().catch(() => {});
              }
              syncDownloadButtons();
            },
          },
        );
        console.timeEnd('overlay-lab-compare');
        appendTimingEntry(log, startedAtMs, 'compare-complete');
        finishTimingLog(log, startedAtMs, null);

        overlayUrl = result.canvasOverlayUrl;
        drawtextUrl = result.drawtextBakedUrl;
        if (overlayCompareDrawtextVideo) {
          overlayCompareDrawtextVideo.src = result.drawtextBakedUrl;
          void overlayCompareDrawtextVideo.play().catch(() => {});
        }
        if (overlayCompareCanvasVideo) {
          overlayCompareCanvasVideo.src = result.canvasOverlayUrl;
          void overlayCompareCanvasVideo.play().catch(() => {});
        }
        if (overlayPreviewStatus) {
          overlayPreviewStatus.textContent =
            'Side-by-side ready — Old drawtext (full MP4) vs New Canvas (overlay.webm).';
        }
        syncDownloadButtons();
      } catch (error: unknown) {
        console.timeEnd('overlay-lab-compare');
        const message = error instanceof Error ? error.message : String(error);
        finishTimingLog(log, startedAtMs, null, message);
        if (overlayPreviewStatus) overlayPreviewStatus.textContent = `Compare failed: ${message}`;
        console.error('[Reddit Voice Notes] Overlay lab compare failed', error);
      } finally {
        busy = false;
      }
    })();
  });

  bakeBtn?.addEventListener('click', () => {
    void (async () => {
      if (busy) return;
      const ctx = resolveLabContext();
      if (!ctx) {
        console.warn('[Reddit Voice Notes] Overlay lab bake: no segments');
        return;
      }
      busy = true;
      const { edited, style, durationSeconds, controls } = ctx;
      const themeBarColor = options.getThemeBarColor?.();
      const { log, startedAtMs } = startTimingLog(
        'bake',
        controls.segmentSet,
        edited.segments.length,
        durationSeconds,
        controls,
      );
      let bakeRenderMetrics: SubtitleOverlayRenderMetrics | null = null;

      if (overlayPreviewModal) overlayPreviewModal.hidden = false;
      setPreviewMode('baked');
      revokeUrl(overlayUrl);
      revokeUrl(drawtextUrl);
      revokeUrl(compositeUrl);
      overlayUrl = null;
      drawtextUrl = null;
      compositeUrl = null;
      syncDownloadButtons();
      if (overlayPreviewStatus) {
        overlayPreviewStatus.textContent =
          `Canvas overlay bake (${edited.segments.length} cue(s)) — render + composite…`;
      }
      if (overlayPreviewFrameImg) overlayPreviewFrameImg.hidden = true;
      if (overlayCompareDrawtextVideo) {
        overlayCompareDrawtextVideo.pause();
        overlayCompareDrawtextVideo.removeAttribute('src');
        overlayCompareDrawtextVideo.load();
      }
      if (overlayCompareCanvasVideo) {
        overlayCompareCanvasVideo.pause();
        overlayCompareCanvasVideo.removeAttribute('src');
        overlayCompareCanvasVideo.load();
      }

      console.time('overlay-lab-bake');
      try {
        appendTimingEntry(log, startedAtMs, 'bake-start');
        const bakedBlob = await bakeWithCanvasOverlay({
          editedResult: edited,
          style,
          durationSeconds,
          themeBarColor,
          // BUG FIX: Lab bake button ignored the parallel A/B toggle
          // Fix: without this, bakeWithCanvasOverlay's parallelBake default
          //      (true) always won, so "toggle off" bake QA runs were never
          //      actually serial — both toggle-on/off bake timing JSONs showed
          //      the same fast (chunked) render, making them useless for a
          //      true before/after comparison. Wire the same toggle the
          //      "Render overlay" button already respects.
          parallelBake: controls.parallelRender,
          // v5.3.10 — explicit at every call site (v5.3.9.1 lesson: silent
          // encoder defaults make Lab A/B toggle runs meaningless).
          encoder: controls.webCodecsRender ? 'webcodecs' : 'mediarecorder',
          onRenderMetrics: (metrics) => {
            bakeRenderMetrics = metrics;
            appendTimingEntry(
              log,
              startedAtMs,
              'cue-cache-stats',
              undefined,
              JSON.stringify(metrics.cueCache),
            );
          },
          onProgress: (ratio, stage) => {
            appendTimingEntry(log, startedAtMs, stage, ratio);
            if (overlayPreviewStatus) {
              const chronos = snapshotBakeChronos(startedAtMs, ratio);
              const chronosLine = formatBakeChronosLine(chronos);
              const stageLabel =
                stage.startsWith('canvas-overlay-render') || stage.includes('overlay-render')
                  ? 'Rendering'
                  : stage.includes('alpha-normalize')
                    ? 'Preparing overlay'
                    : stage.includes('composite') || stage.startsWith('burnin')
                      ? 'Compositing'
                      : 'Baking';
              overlayPreviewStatus.textContent =
                `${stageLabel}… ${Math.round(ratio * 100)}% · ${chronosLine}`;
            }
          },
        });
        console.timeEnd('overlay-lab-bake');
        appendTimingEntry(log, startedAtMs, 'bake-complete');
        finishTimingLog(log, startedAtMs, bakeRenderMetrics);

        compositeUrl = URL.createObjectURL(bakedBlob);
        if (overlayPreviewVideo) {
          overlayPreviewVideo.src = compositeUrl;
          overlayPreviewVideo.muted = false;
          void overlayPreviewVideo.play().catch(() => {});
        }
        if (overlayPreviewStatus) {
          overlayPreviewStatus.textContent =
            `Composite ready — final.mp4 (${durationSeconds.toFixed(1)}s, ${edited.segments.length} cue(s)).`;
        }
        syncDownloadButtons();
      } catch (error: unknown) {
        console.timeEnd('overlay-lab-bake');
        const message = error instanceof Error ? error.message : String(error);
        finishTimingLog(log, startedAtMs, bakeRenderMetrics, message);
        if (overlayPreviewStatus) overlayPreviewStatus.textContent = `Canvas bake failed: ${message}`;
        console.error('[Reddit Voice Notes] Overlay lab bake failed', error);
      } finally {
        busy = false;
      }
    })();
  });

  overlayPreviewClose?.addEventListener('click', hideModal);

  downloadOverlayBtn?.addEventListener('click', () => {
    triggerDownload(overlayUrl, 'overlay.webm');
  });
  downloadDrawtextBtn?.addEventListener('click', () => {
    triggerDownload(drawtextUrl, 'drawtext-compare.mp4');
  });
  downloadCompositeBtn?.addEventListener('click', () => {
    triggerDownload(compositeUrl, 'final.mp4');
  });
  downloadTimingBtn?.addEventListener('click', () => {
    if (!timingLog) return;
    const blob = new Blob([JSON.stringify(timingLog, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, `overlay-lab-timing-${timingLog.action}.json`);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  return {
    dispose() {
      hideModal();
      revokeUrl(overlayUrl);
      revokeUrl(drawtextUrl);
      revokeUrl(compositeUrl);
      labRoot.removeEventListener('change', onLabControlChange);
      labRoot.removeEventListener('input', onLabControlChange);
      unwireBackdropRadius();
    },
  };
}