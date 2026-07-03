import {
  clearSessionTranscriptStore,
  loadSessionTranscript,
  revertSessionTranscriptEdits,
  saveSessionTranscriptEdits,
  type SessionTranscriptSnapshot,
} from '@/src/storage/session-transcript-db';
import {
  BAKED_MP4_READY_KEY,
  LAST_RECORDING_READY_KEY,
  loadUserPreferences,
  readSubtitlesEnabledLocal,
  SESSION_TRANSCRIPT_READY_KEY,
  saveTranscriptPreferences,
  setSubtitlesEnabled,
  writeSubtitlesEnabledLocal,
  type UserPreferencesV1,
} from '@/src/settings/user-preferences';
import { TRANSCRIBE_TIMEOUT_MS } from '@/src/transcription/constants';
import {
  isSubtitleOverlayLabEnabled,
  mountSubtitleOverlayLab,
  renderSubtitleOverlayLabHtml,
} from '@/src/ui/design-studio/subtitle-overlay-lab';
import {
  DEFAULT_SUBTITLE_SPECIAL_HUE,
  DEFAULT_TRANSCRIPT_CONFIG,
  normalizeSubtitleStyle,
  normalizeTranscriptConfig,
  transcriptConfigForProfileStorage,
  type SubtitleGlowColorSource,
  type SubtitleGlowHueRotateMode,
  type SubtitleGlowMode,
  type SubtitleStyleConfig,
  type SubtitleTextColor,
  type TranscriptConfig,
  type TranscriptResult,
} from '@/src/transcription/types';
import {
  mountColorPickerControls,
  renderColorPickerFields,
} from '@/src/ui/design-studio/color-picker';
import { rebuildTextFromSegments } from '@/src/transcription/transcript-editing';
import type { SubtitlePreviewOptions } from '@/src/transcription/subtitle-preview';
import {
  advanceBakeDisplayRatio,
  createBakeDisplayRatioState,
  estimateRemainingMs,
  formatBakeChronosLine,
  type BakeDisplayRatioState,
} from '@/src/ui/design-studio/bake-chronos';
import { bakeSubtitlesInStudio, type SubtitleBakeProgress } from '@/src/ui/design-studio/subtitle-bake';
import {
  mountSubtitleSegmentEditor,
  renderSubtitleSegmentEditorFields,
  type TranscriptDeliveryStatus,
} from '@/src/ui/design-studio/subtitle-segment-editor';
import { renderPreviewBlock } from '@/src/ui/design-studio/preview-block';
import {
  renderPhysicalSliderHtml,
  setPhysicalSliderValue,
  wirePhysicalSliders,
} from '@/src/ui/design-studio/physical-slider';

export interface SubtitleControlsHandle {
  dispose(): void;
  flushPersist(): Promise<void>;
  getDraftConfig(): TranscriptConfig;
  getProfileSnapshotConfig(): TranscriptConfig;
  getPreviewOptions(): SubtitlePreviewOptions | undefined;
  syncFromPreferences(prefs: UserPreferencesV1): void;
  isTranscriptDirty(): boolean;
  getTranscriptDeliveryStatus(): TranscriptDeliveryStatus;
  hasSessionRecording(): boolean;
  hasTranscriptCues(): boolean;
  isBakedForCurrentSession(): boolean;
  confirmTranscriptEdits(): Promise<void>;
  discardTranscriptEdits(): Promise<void>;
}

const TRANSCRIPT_SAVE_DEBOUNCE_MS = 250;
const TRANSCRIPT_POLL_MS = 2000;

type BakeButtonUiState = 'unavailable' | 'ready' | 'baking' | 'complete';

const BAKE_BTN_STATE_CLASS: Record<BakeButtonUiState, string> = {
  unavailable: 'studio-v4__bake-btn--unavailable',
  ready: 'studio-v4__bake-btn--ready',
  baking: 'studio-v4__bake-btn--baking',
  complete: 'studio-v4__bake-btn--complete',
};

// CHANGED: top → center → bottom (visual order on screen)
// WHY: dropdown order regressed to bottom-first before; keep top-first in source
const POSITION_OPTIONS: { value: SubtitleStyleConfig['position']; label: string }[] = [
  { value: 'top', label: 'Top' },
  { value: 'center', label: 'Center' },
  { value: 'bottom', label: 'Bottom' },
];

// Values are keys into FONT_ASSETS in subtitle-burnin.ts — must stay in sync.
// All fonts are from the DejaVu family; labels name the actual TTF that renders in the baked video.
const FONT_FAMILY_OPTIONS: { value: string; label: string }[] = [
  { value: 'dejavu-sans', label: 'Sans' },
  { value: 'dejavu-serif', label: 'Serif' },
  { value: 'dejavu-mono', label: 'Mono' },
  { value: 'dejavu-bold', label: 'Bold' },
];

function formatSavedAt(ms: number): string {
  try {
    return new Date(ms).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return 'recent session';
  }
}

export function renderSubtitleControlFields(): string {
  return `
    <div class="studio__subtitles" data-subtitle-controls>
      <p class="studio__subtitles-source" data-subtitle-source>
        Loading transcript…
      </p>
      <label class="popup__toggle-row studio__subtitles-toggle">
        <span class="popup__toggle-copy">
          <span class="popup__toggle-label">Subtitles</span>
          <p class="popup__field-desc">
            Review and edit your transcript in Design Studio, then bake captions into the MP4 when ready.
          </p>
        </span>
        <input
          class="popup__toggle-input"
          type="checkbox"
          data-subtitle-enabled
          aria-label="Enable subtitle preview"
        />
      </label>
      <div class="studio__subtitles-body" data-subtitle-body hidden>
        <div class="studio__subtitles-top" data-subtitle-top-block>
          ${renderPreviewBlock('subtitle-text')}
          <div class="studio__subtitles-bake" data-subtitle-bake-block>
            <button
              type="button"
              class="studio-v4__bake-btn studio-v4__bake-btn--unavailable studio__bake-btn"
              data-subtitle-bake
              disabled
            >
              Not ready to bake
            </button>
            <div class="studio__bake-unsaved" data-bake-unsaved-dialog hidden>
              <p class="popup__field-desc studio__bake-unsaved-copy">
                You have unsaved transcript edits. Confirm &amp; bake to apply them now, or go back to keep editing.
              </p>
              <div class="popup__profile-actions studio__inline-actions studio-v4__guard-actions">
                <button type="button" class="popup__profile-btn popup__profile-btn--negate studio-v4__guard-cancel" data-bake-unsaved-cancel>
                  Cancel
                </button>
                <button type="button" class="popup__profile-btn popup__profile-btn--negate studio-v4__guard-discard" data-bake-edit-back>
                  Back to editor
                </button>
                <button type="button" class="popup__profile-btn popup__profile-btn--amber studio-v4__guard-apply" data-bake-save-continue>
                  Confirm &amp; bake
                </button>
              </div>
            </div>
            <p class="popup__field-desc studio__bake-status" data-subtitle-bake-status>
              Confirm your transcript edits, then bake. The Reddit recorder will pick up the captioned MP4.
            </p>
            <div class="studio__bake-chronos" data-subtitle-bake-chronos hidden>
              <div
                class="studio__bake-chronos-meter"
                data-subtitle-bake-chronos-meter
                role="progressbar"
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow="0"
                aria-label="Subtitle bake progress"
              >
                <span class="studio__bake-chronos-meter-fill" data-subtitle-bake-chronos-fill></span>
              </div>
              <p class="popup__field-desc studio__bake-chronos-time" data-subtitle-bake-chronos-time></p>
            </div>
            <p class="popup__field-desc studio__bake-repeatable-hint" data-subtitle-bake-repeatable>
              Repeatable — rebake anytime after transcript edits or a fresh recording.
            </p>
            <p class="popup__field-desc studio__bake-duration-hint">
              Canvas bakes on longer clips or with rich effects (glow, gradient, dual border) may take several minutes — progress updates below while you wait.
            </p>
          </div>
        </div>
        ${isSubtitleOverlayLabEnabled() ? renderSubtitleOverlayLabHtml() : ''}
        ${renderSubtitleSegmentEditorFields()}
        <label class="popup__field studio__field--compact">
          <span class="popup__field-label">Position</span>
          <select class="popup__select" data-subtitle-position aria-label="Subtitle position"></select>
        </label>
        <label class="popup__field studio__field--compact">
          <span class="popup__field-label">
            Font
            <span class="popup__micro" title="Baked MP4 always uses DejaVu Sans">preview only</span>
          </span>
          <select class="popup__select" data-subtitle-font-family aria-label="Subtitle font family (preview only)"></select>
        </label>
        <label class="popup__field studio__field--compact">
          <span class="popup__field-label">
            Font size <span data-subtitle-font-size-value>22px</span>
          </span>
          ${renderPhysicalSliderHtml({
            min: 14,
            max: 36,
            step: 1,
            value: 22,
            ariaLabel: 'Subtitle font size',
            dataAttrs: { 'subtitle-font-size': '' },
          })}
        </label>
        <label class="popup__toggle-row studio__subtitles-toggle">
          <span class="popup__toggle-copy">
            <span class="popup__toggle-label">Backdrop plate</span>
            <p class="popup__field-desc">Semi-opaque plate behind text for readability over bars.</p>
          </span>
          <input
            class="popup__toggle-input"
            type="checkbox"
            data-subtitle-backdrop
            aria-label="Subtitle backdrop"
            checked
          />
        </label>
        <label class="popup__field studio__field--compact">
          <span class="popup__field-label">
            Backdrop opacity <span data-subtitle-backdrop-opacity-value>72%</span>
          </span>
          ${renderPhysicalSliderHtml({
            min: 30,
            max: 95,
            step: 1,
            value: 72,
            ariaLabel: 'Subtitle backdrop opacity',
            dataAttrs: { 'subtitle-backdrop-opacity': '' },
          })}
        </label>
        <label class="popup__field studio__field--compact">
          <span class="popup__field-label">Text color</span>
          <select class="popup__select" data-subtitle-text-color aria-label="Subtitle text color">
            <option value="theme">Theme hue</option>
            <option value="white">White</option>
            <option value="black">Black</option>
            <option value="special">Special hue</option>
          </select>
        </label>
        <label class="popup__toggle-row studio__subtitles-toggle">
          <span class="popup__toggle-copy">
            <span class="popup__toggle-label">Text gradient</span>
            <p class="popup__field-desc">
              Subtle vertical highlight on caption fill — canvas overlay bake only; drawtext compare stays flat.
            </p>
          </span>
          <input
            class="popup__toggle-input"
            type="checkbox"
            data-subtitle-text-gradient
            aria-label="Canvas text gradient"
            checked
          />
        </label>
        <label class="popup__toggle-row studio__subtitles-toggle">
          <span class="popup__toggle-copy">
            <span class="popup__toggle-label">Text gradient wave</span>
            <p class="popup__field-desc">
              Slowly sweeps the highlight downward through caption glyphs — canvas overlay only; requires Text gradient.
            </p>
          </span>
          <input
            class="popup__toggle-input"
            type="checkbox"
            data-subtitle-text-gradient-wave
            aria-label="Canvas text gradient wave"
          />
        </label>
        <label class="popup__toggle-row studio__subtitles-toggle">
          <span class="popup__toggle-copy">
            <span class="popup__toggle-label">Theme glow</span>
            <p class="popup__field-desc">
              Colored halo or solid border — stacks with backdrop. Shares Special hue with text color.
            </p>
          </span>
          <input
            class="popup__toggle-input"
            type="checkbox"
            data-subtitle-glow
            aria-label="Subtitle theme glow"
          />
        </label>
        <div class="studio__subtitle-effects" data-subtitle-glow-options hidden>
          <label class="popup__field studio__field--compact">
            <span class="popup__field-label">Glow style</span>
            <select class="popup__select" data-subtitle-glow-mode aria-label="Subtitle glow style">
              <option value="halo">Halo (soft)</option>
              <option value="border">Border (solid)</option>
            </select>
          </label>
          <label class="popup__field studio__field--compact">
            <span class="popup__field-label">Glow color</span>
            <select class="popup__select" data-subtitle-glow-color aria-label="Subtitle glow color">
              <option value="theme">Theme hue</option>
              <option value="black">Black</option>
              <option value="white">White</option>
              <option value="special">Special hue</option>
              <option value="rainbow">Hue rotate</option>
            </select>
          </label>
          <label class="popup__field studio__field--compact" data-subtitle-glow-hue-rotate-panel hidden>
            <span class="popup__field-label">Hue rotate mode</span>
            <select class="popup__select" data-subtitle-glow-hue-rotate-mode aria-label="Subtitle glow hue rotate mode">
              <option value="rainbow">Rainbow (full wheel)</option>
              <option value="monochromatic">Monochromatic (theme family)</option>
            </select>
            <p class="popup__field-desc">Canvas overlay bake only — smooth per-frame rotation at ~45°/s.</p>
          </label>
          <label class="popup__field studio__field--compact">
            <span class="popup__field-label">
              Glow strength <span data-subtitle-glow-opacity-value>55%</span>
            </span>
            ${renderPhysicalSliderHtml({
              min: 20,
              max: 90,
              step: 1,
              value: 55,
              ariaLabel: 'Subtitle glow strength',
              dataAttrs: { 'subtitle-glow-opacity': '' },
            })}
          </label>
          <label class="popup__toggle-row studio__subtitles-toggle">
            <span class="popup__toggle-copy">
              <span class="popup__toggle-label">Dual border</span>
              <p class="popup__field-desc">
                Inner + outer contrasting outline — canvas overlay bake only; drawtext compare stays single border.
              </p>
            </span>
            <input
              class="popup__toggle-input"
              type="checkbox"
              data-subtitle-glow-dual-border
              aria-label="Canvas dual contrasting border"
            />
          </label>
        </div>
        <div class="studio__subtitle-special-hue" data-subtitle-special-hue-panel hidden>
          <p class="popup__field-label studio__subtitle-special-hue-label">Special hue</p>
          <p class="popup__field-desc">Shared by text and glow when either uses Special hue.</p>
          ${renderColorPickerFields()}
        </div>
        <div class="popup__profile-actions studio__inline-actions">
          <button
            type="button"
            class="popup__profile-btn popup__profile-btn--delete"
            data-subtitle-reset
          >
            Clear transcript
          </button>
        </div>
      </div>
      <div class="studio__subtitle-disable-guard" data-subtitle-disable-guard hidden>
        <div
          class="studio__subtitle-disable-dialog"
          role="dialog"
          aria-labelledby="subtitle-disable-guard-title"
        >
          <h3 class="studio__subtitle-disable-title" id="subtitle-disable-guard-title">
            Turn off subtitles?
          </h3>
          <p class="popup__field-desc studio__subtitle-disable-copy">
            Disabling subtitles clears your current transcript from Design Studio. Record again
            anytime to transcribe fresh — you can rebake as often as you like.
          </p>
          <div class="popup__profile-actions studio__inline-actions studio-v4__guard-actions">
            <button
              type="button"
              class="popup__button popup__button--secondary studio-v4__guard-cancel"
              data-subtitle-disable-cancel
            >
              Keep subtitles on
            </button>
            <button
              type="button"
              class="popup__profile-btn popup__profile-btn--delete studio-v4__guard-discard"
              data-subtitle-disable-confirm
            >
              Turn off &amp; clear
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

export interface SubtitleControlHandlers {
  onSettingsChange?: () => void;
  onPreviewChange?: () => void;
  getThemeBarColor?: () => string;
}

export function mountSubtitleControls(
  root: HTMLElement,
  handlers?: SubtitleControlHandlers,
): SubtitleControlsHandle {
  const panel = root.querySelector<HTMLElement>('[data-subtitle-controls]')!;
  const sourceEl = panel.querySelector<HTMLElement>('[data-subtitle-source]')!;
  const bodyEl = panel.querySelector<HTMLElement>('[data-subtitle-body]')!;
  const enabledInput = panel.querySelector<HTMLInputElement>('[data-subtitle-enabled]')!;
  const positionSelect = panel.querySelector<HTMLSelectElement>('[data-subtitle-position]')!;
  const fontFamilySelect = panel.querySelector<HTMLSelectElement>('[data-subtitle-font-family]')!;
  // Physical analog sliders (div[role=slider], value in dataset) — not <input>.
  const fontSizeInput = panel.querySelector<HTMLElement>('[data-subtitle-font-size]')!;
  const fontSizeValueEl = panel.querySelector<HTMLElement>('[data-subtitle-font-size-value]')!;
  const backdropInput = panel.querySelector<HTMLInputElement>('[data-subtitle-backdrop]')!;
  const backdropOpacityInput = panel.querySelector<HTMLElement>('[data-subtitle-backdrop-opacity]')!;
  const backdropOpacityValueEl = panel.querySelector<HTMLElement>(
    '[data-subtitle-backdrop-opacity-value]',
  )!;
  const textColorSelect = panel.querySelector<HTMLSelectElement>('[data-subtitle-text-color]')!;
  const textGradientInput = panel.querySelector<HTMLInputElement>('[data-subtitle-text-gradient]')!;
  const textGradientWaveInput = panel.querySelector<HTMLInputElement>('[data-subtitle-text-gradient-wave]')!;
  const specialHuePanel = panel.querySelector<HTMLElement>('[data-subtitle-special-hue-panel]')!;
  const glowInput = panel.querySelector<HTMLInputElement>('[data-subtitle-glow]')!;
  const glowOptionsEl = panel.querySelector<HTMLElement>('[data-subtitle-glow-options]')!;
  const glowModeSelect = panel.querySelector<HTMLSelectElement>('[data-subtitle-glow-mode]')!;
  const glowColorSelect = panel.querySelector<HTMLSelectElement>('[data-subtitle-glow-color]')!;
  const glowHueRotatePanel = panel.querySelector<HTMLElement>('[data-subtitle-glow-hue-rotate-panel]')!;
  const glowHueRotateModeSelect = panel.querySelector<HTMLSelectElement>(
    '[data-subtitle-glow-hue-rotate-mode]',
  )!;
  const glowOpacityInput = panel.querySelector<HTMLElement>('[data-subtitle-glow-opacity]')!;
  const glowOpacityValueEl = panel.querySelector<HTMLElement>('[data-subtitle-glow-opacity-value]')!;
  const glowDualBorderInput = panel.querySelector<HTMLInputElement>('[data-subtitle-glow-dual-border]')!;
  const resetBtn = panel.querySelector<HTMLButtonElement>('[data-subtitle-reset]')!;
  const bakeBtn = panel.querySelector<HTMLButtonElement>('[data-subtitle-bake]')!;
  const bakeStatusEl = panel.querySelector<HTMLElement>('[data-subtitle-bake-status]')!;
  const bakeChronosEl = panel.querySelector<HTMLElement>('[data-subtitle-bake-chronos]')!;
  const bakeChronosMeterEl = panel.querySelector<HTMLElement>('[data-subtitle-bake-chronos-meter]')!;
  const bakeChronosFillEl = panel.querySelector<HTMLElement>('[data-subtitle-bake-chronos-fill]')!;
  const bakeChronosTimeEl = panel.querySelector<HTMLElement>('[data-subtitle-bake-chronos-time]')!;
  const bakeUnsavedDialog = panel.querySelector<HTMLElement>('[data-bake-unsaved-dialog]')!;
  const bakeSaveContinueBtn = panel.querySelector<HTMLButtonElement>('[data-bake-save-continue]')!;
  const bakeEditBackBtn = panel.querySelector<HTMLButtonElement>('[data-bake-edit-back]')!;
  const bakeUnsavedCancelBtn = panel.querySelector<HTMLButtonElement>('[data-bake-unsaved-cancel]')!;
  const disableGuardEl = panel.querySelector<HTMLElement>('[data-subtitle-disable-guard]')!;
  const disableCancelBtn = panel.querySelector<HTMLButtonElement>('[data-subtitle-disable-cancel]')!;
  const disableConfirmBtn = panel.querySelector<HTMLButtonElement>('[data-subtitle-disable-confirm]')!;

  let draftConfig: TranscriptConfig = normalizeTranscriptConfig(DEFAULT_TRANSCRIPT_CONFIG);
  let lastSnapshot: SessionTranscriptSnapshot | null = null;
  let dismissedSnapshotCapturedAt = 0;
  let syncing = false;
  let saveTimer = 0;
  let baking = false;
  let bakeDisplayRatio: BakeDisplayRatioState = createBakeDisplayRatioState();
  let bakeAbort: AbortController | null = null;
  let lastRecordingReadyAt = 0;
  let lastBakedAt = 0;
  let pendingTranscriptTimer: number | null = null;
  let pendingTranscriptSince = 0;

  const segmentEditor = mountSubtitleSegmentEditor(panel, {
    // CHANGED: Phase 6 — give the editor the live subtitle style so Smart Split +
    // the overflow badge measure cue text against the same font the preview uses.
    getSubtitleStyle: () => mergeStyleFromControls(),
    onStateChange: () => {
      syncBakeButton();
      syncDraftFromEditor();
      notifyPreviewChange();
    },
    async onSaveEdits(edited) {
      await saveSessionTranscriptEdits(edited, { confirmed: true });
      lastSnapshot = await loadSessionTranscript();
      // CHANGED: recompute delivery status after a confirmed save (v5.3 Phase 4).
      // WHY: saveSessionTranscriptEdits drops error/isScaffolded, so a filled-in
      //      scaffold must leave the red 'no-speech'/'failed' state for 'ready'
      //      instead of staying alarmed after the user has added captions.
      await refreshTranscriptDeliveryStatus();
      syncDraftFromEditor();
      syncBakeButton();
      updateSourceCopy();
    },
    async onDiscardEdits() {
      await revertSessionTranscriptEdits();
      const snapshot = await loadSessionTranscript();
      if (snapshot) {
        lastSnapshot = snapshot;
        segmentEditor.setTranscript(snapshot.originalResult, snapshot.editedResult, {
          savedBaseline: snapshot.editedResult,
        });
      }
      syncDraftFromEditor();
      syncBakeButton();
      updateSourceCopy();
    },
  });

  for (const option of POSITION_OPTIONS) {
    const el = document.createElement('option');
    el.value = option.value ?? 'bottom';
    el.textContent = option.label;
    positionSelect.append(el);
  }

  for (const option of FONT_FAMILY_OPTIONS) {
    const el = document.createElement('option');
    el.value = option.value;
    el.textContent = option.label;
    fontFamilySelect.append(el);
  }

  const specialHuePicker = mountColorPickerControls(specialHuePanel, (overrides) => {
    if (syncing) return;
    const hex = overrides.barColor ?? DEFAULT_SUBTITLE_SPECIAL_HUE;
    draftConfig = {
      ...draftConfig,
      style: normalizeSubtitleStyle({
        ...mergeStyleFromControls(),
        specialHue: hex,
      }),
    };
    schedulePersist();
    notifyDraftChange();
  });

  function notifySettingsChange(): void {
    handlers?.onSettingsChange?.();
  }

  function notifyPreviewChange(): void {
    handlers?.onPreviewChange?.();
  }

  function notifyDraftChange(): void {
    notifySettingsChange();
    notifyPreviewChange();
  }

  function buildDraftConfig(): TranscriptConfig {
    const enabled = draftConfig.transcriptionEnabled;
    return normalizeTranscriptConfig({
      transcriptionEnabled: enabled,
      style: normalizeSubtitleStyle({
        ...mergeStyleFromControls(),
        enabled,
      }),
      result: segmentEditor.getEditedResult(),
      resultCapturedAt: draftConfig.resultCapturedAt,
    });
  }

  /** Profile dirty checks — style/toggle only; session transcript text is IDB-scoped. */
  function buildProfileStyleConfig(): TranscriptConfig {
    const enabled = draftConfig.transcriptionEnabled;
    return transcriptConfigForProfileStorage(
      normalizeTranscriptConfig({
        transcriptionEnabled: enabled,
        style: normalizeSubtitleStyle({
          ...mergeStyleFromControls(),
          enabled,
        }),
        result: null,
      }),
    );
  }

  function schedulePersist(): void {
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = 0;
      void saveTranscriptPreferences(buildDraftConfig()).catch((error: unknown) => {
        console.warn('[Reddit Voice Notes] Transcript prefs save failed', error);
      });
    }, TRANSCRIPT_SAVE_DEBOUNCE_MS);
  }

  async function persistNow(): Promise<void> {
    if (saveTimer) {
      window.clearTimeout(saveTimer);
      saveTimer = 0;
    }
    try {
      await saveTranscriptPreferences(buildDraftConfig());
    } catch (error: unknown) {
      console.warn('[Reddit Voice Notes] Transcript prefs save failed', error);
    }
  }

  function syncDraftFromEditor(): void {
    const edited = segmentEditor.getEditedResult();
    draftConfig = {
      ...draftConfig,
      result: edited,
      resultCapturedAt: lastSnapshot?.capturedAt,
    };
  }

  function clearPendingTranscriptTimer(): void {
    if (pendingTranscriptTimer !== null) {
      window.clearTimeout(pendingTranscriptTimer);
      pendingTranscriptTimer = null;
    }
  }

  async function refreshSessionStatusCache(): Promise<void> {
    const stored = await browser.storage.local.get([
      LAST_RECORDING_READY_KEY,
      BAKED_MP4_READY_KEY,
    ]);
    lastRecordingReadyAt =
      typeof stored[LAST_RECORDING_READY_KEY] === 'number' ? stored[LAST_RECORDING_READY_KEY] : 0;
    lastBakedAt = typeof stored[BAKED_MP4_READY_KEY] === 'number' ? stored[BAKED_MP4_READY_KEY] : 0;
    syncBakeButton();
    handlers?.onSettingsChange?.();
  }

  function hasSessionRecording(): boolean {
    return lastRecordingReadyAt > 0 || (lastSnapshot?.capturedAt ?? 0) > 0;
  }

  function isBakedForCurrentSession(): boolean {
    return (
      lastBakedAt > 0 &&
      lastRecordingReadyAt > 0 &&
      lastBakedAt >= lastRecordingReadyAt
    );
  }

  function hasTranscriptCues(): boolean {
    return (segmentEditor.getEditedResult()?.segments?.length ?? 0) > 0;
  }

  function hasStoredTranscript(): boolean {
    if ((lastSnapshot?.editedResult?.segments?.length ?? 0) > 0) return true;
    return hasTranscriptCues();
  }

  function showDisableGuard(): void {
    disableGuardEl.hidden = false;
    disableCancelBtn.focus();
  }

  function hideDisableGuard(): void {
    disableGuardEl.hidden = true;
  }

  function hideBakeUnsavedDialog(): void {
    bakeUnsavedDialog.hidden = true;
  }

  function showBakeUnsavedDialog(): void {
    bakeUnsavedDialog.hidden = false;
  }

  // CHANGED: map a current snapshot to its delivery status (v5.3 Phase 3).
  // WHY: a graceful-failure scaffold snapshot carries error/isScaffolded — without
  //      this it read as plain 'ready' (the "transcribed" QA symptom). A current
  //      snapshot of any kind short-circuits the 120s pending timer.
  function deliveryStatusForSnapshot(
    snapshot: SessionTranscriptSnapshot | null,
  ): TranscriptDeliveryStatus {
    const errorType = snapshot?.error?.type;
    if (errorType === 'no-speech') return 'no-speech';
    if (errorType === 'timeout') return 'timeout';
    if (errorType === 'inference-error' || errorType === 'empty-result') return 'failed';
    if (snapshot?.isScaffolded) return 'scaffolded';
    return 'ready';
  }

  async function refreshTranscriptDeliveryStatus(): Promise<void> {
    try {
      if (!draftConfig.transcriptionEnabled) {
        clearPendingTranscriptTimer();
        segmentEditor.setTranscriptDeliveryStatus('idle');
        return;
      }

      const stored = await browser.storage.local.get(LAST_RECORDING_READY_KEY);
      const recordingReadyAt =
        typeof stored[LAST_RECORDING_READY_KEY] === 'number' ? stored[LAST_RECORDING_READY_KEY] : 0;
      const snapshotAt = lastSnapshot?.capturedAt ?? 0;

      if (snapshotAt > 0 && recordingReadyAt > 0 && snapshotAt >= recordingReadyAt) {
        clearPendingTranscriptTimer();
        const resolved = deliveryStatusForSnapshot(lastSnapshot);
        // Diagnostic (v5.3): confirm the Studio sees the scaffold's failure metadata.
        // If `resolved` is 'ready'/'scaffolded' for a known failure, the snapshot
        // lost its error somewhere upstream; if it's correct here but the strip
        // still shows "Transcribed", the strip input is stale.
        console.log('[Reddit Voice Notes] Subtitle delivery resolved', {
          resolved,
          errorType: lastSnapshot?.error?.type ?? null,
          isScaffolded: lastSnapshot?.isScaffolded ?? false,
        });
        segmentEditor.setTranscriptDeliveryStatus(resolved);
        return;
      }

      if (recordingReadyAt > snapshotAt && recordingReadyAt > 0) {
        if (pendingTranscriptSince !== recordingReadyAt) {
          pendingTranscriptSince = recordingReadyAt;
          clearPendingTranscriptTimer();
          pendingTranscriptTimer = window.setTimeout(() => {
            void (async () => {
              const storedAgain = await browser.storage.local.get(LAST_RECORDING_READY_KEY);
              const recAt =
                typeof storedAgain[LAST_RECORDING_READY_KEY] === 'number'
                  ? storedAgain[LAST_RECORDING_READY_KEY]
                  : 0;
              const snapAt = lastSnapshot?.capturedAt ?? 0;
              if (recAt > snapAt && recAt > 0) {
                segmentEditor.setTranscriptDeliveryStatus('timeout');
                notifySettingsChange();
              }
            })();
          }, TRANSCRIBE_TIMEOUT_MS);
        }
        segmentEditor.setTranscriptDeliveryStatus('pending');
        return;
      }

      clearPendingTranscriptTimer();
      // BUG FIX: stale IDB transcript marked delivery ready without a current recording
      // Fix: only ready when snapshot capturedAt is at or after last recording ready.
      if (recordingReadyAt > 0 && snapshotAt >= recordingReadyAt) {
        segmentEditor.setTranscriptDeliveryStatus(deliveryStatusForSnapshot(lastSnapshot));
      } else {
        segmentEditor.setTranscriptDeliveryStatus('idle');
      }
    } finally {
      syncBakeButton();
      notifySettingsChange();
    }
  }

  function transcriptMatchesCurrentRecording(): boolean {
    const recordingReadyAt = lastRecordingReadyAt;
    const snapshotAt = lastSnapshot?.capturedAt ?? draftConfig.resultCapturedAt ?? 0;
    if (recordingReadyAt <= 0) return false;
    return snapshotAt >= recordingReadyAt;
  }

  function canBakeNow(): boolean {
    if (baking || !draftConfig.transcriptionEnabled) return false;
    // Only require cues + confirmed edits — delivery status no longer gates the bake.
    // If Vosk never arrives the user can still manually enter/edit cues and bake.
    if (!hasTranscriptCues()) return false;
    const { dirty, confirmed } = segmentEditor.getState();
    if (dirty || !confirmed) return false;
    return true;
  }

  function resolveBakeButtonUiState(): BakeButtonUiState {
    if (baking) return 'baking';
    if (canBakeNow()) {
      return isBakedForCurrentSession() ? 'complete' : 'ready';
    }
    if (
      isBakedForCurrentSession() &&
      transcriptMatchesCurrentRecording() &&
      hasTranscriptCues()
    ) {
      return 'complete';
    }
    return 'unavailable';
  }

  function resolveUnavailableBakeLabel(): string {
    if (!hasTranscriptCues()) {
      const delivery = segmentEditor.getTranscriptDeliveryStatus();
      if (delivery === 'pending') return 'Waiting for transcript — or add cues manually';
      if (delivery === 'timeout' || delivery === 'ready') return 'No transcript — add cues manually to bake';
      if (!transcriptMatchesCurrentRecording()) return 'Record on Reddit first';
      return 'No transcript to bake';
    }
    const { dirty } = segmentEditor.getState();
    if (dirty) return 'Confirm transcript edits first';
    return 'Not ready to bake';
  }

  function resolveUnavailableBakeHint(): string {
    const label = resolveUnavailableBakeLabel();
    if (label === 'Confirm transcript edits first') {
      return 'Confirm & save your transcript edits before baking.';
    }
    if (label.startsWith('Waiting for transcript')) {
      return 'Transcription is still running. You can also open the Subtitles panel and add cues manually.';
    }
    if (label.startsWith('No transcript — add')) {
      return 'Vosk found no speech. Open the Subtitles panel to add cues manually, then bake.';
    }
    if (label === 'Record on Reddit first') {
      return 'Record a voice note on Reddit, then reopen Design Studio.';
    }
    return label;
  }

  function setBakeChronosVisible(visible: boolean): void {
    bakeChronosEl.hidden = !visible;
    if (!visible) {
      bakeChronosFillEl.style.width = '0%';
      bakeChronosMeterEl.setAttribute('aria-valuenow', '0');
      bakeChronosTimeEl.textContent = '';
      bakeDisplayRatio = createBakeDisplayRatioState();
    }
  }

  function updateBakeChronosUi(progress: SubtitleBakeProgress): void {
    if (progress.stage === 'done' || progress.stage === 'error') {
      setBakeChronosVisible(false);
      return;
    }
    setBakeChronosVisible(true);
    const displayRatio = advanceBakeDisplayRatio(bakeDisplayRatio, progress.ratio);
    const pct = Math.min(100, Math.max(0, Math.round(displayRatio * 100)));
    bakeChronosFillEl.style.width = `${pct}%`;
    bakeChronosMeterEl.setAttribute('aria-valuenow', String(pct));
    if (progress.elapsedMs != null) {
      bakeChronosTimeEl.textContent = formatBakeChronosLine({
        elapsedMs: progress.elapsedMs,
        estimatedRemainingMs: estimateRemainingMs(progress.elapsedMs, displayRatio),
      });
    }
  }

  function syncBakeButton(): void {
    const state = resolveBakeButtonUiState();
    for (const className of Object.values(BAKE_BTN_STATE_CLASS)) {
      bakeBtn.classList.remove(className);
    }
    bakeBtn.classList.add(BAKE_BTN_STATE_CLASS[state]);

    switch (state) {
      case 'baking':
        bakeBtn.disabled = true;
        bakeBtn.textContent = 'Baking subtitles…';
        bakeBtn.setAttribute('aria-busy', 'true');
        break;
      case 'ready':
        bakeBtn.disabled = false;
        bakeBtn.textContent = 'Bake subtitles into MP4';
        bakeBtn.removeAttribute('aria-busy');
        break;
      case 'complete':
        bakeBtn.disabled = false;
        bakeBtn.textContent = 'Subtitles baked — bake again';
        bakeBtn.removeAttribute('aria-busy');
        break;
      default:
        bakeBtn.disabled = true;
        bakeBtn.textContent = resolveUnavailableBakeLabel();
        bakeBtn.removeAttribute('aria-busy');
        break;
    }
  }

  async function runSubtitleBake(): Promise<void> {
    const edited = segmentEditor.getEditedResult();
    if (!edited) {
      bakeStatusEl.textContent = 'Transcript not ready for bake yet.';
      return;
    }

    baking = true;
    bakeAbort = new AbortController();
    syncBakeButton();
    hideBakeUnsavedDialog();
    bakeStatusEl.textContent = 'Preparing subtitle bake…';
    bakeDisplayRatio = createBakeDisplayRatioState();
    setBakeChronosVisible(true);
    bakeChronosTimeEl.textContent = '0:00 elapsed';

    try {
      const config = buildDraftConfig();
      await bakeSubtitlesInStudio({
        editedResult: edited,
        style: config.style,
        signal: bakeAbort.signal,
        onProgress: (progress) => {
          bakeStatusEl.textContent = progress.message ?? 'Baking subtitles…';
          updateBakeChronosUi(progress);
        },
      });
      bakeStatusEl.textContent =
        'Subtitles baked. Switch to your Reddit tab and attach the MP4 from the recorder.';
      await refreshSessionStatusCache();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      bakeStatusEl.textContent = `Bake failed: ${message}`;
    } finally {
      baking = false;
      bakeAbort = null;
      setBakeChronosVisible(false);
      syncBakeButton();
    }
  }

  function dismissCurrentSessionTranscript(): void {
    dismissedSnapshotCapturedAt = Math.max(
      dismissedSnapshotCapturedAt,
      lastSnapshot?.capturedAt ?? Date.now(),
    );
    draftConfig = {
      ...draftConfig,
      result: null,
      resultCapturedAt: undefined,
    };
    segmentEditor.setTranscript(null);
    syncBakeButton();
    notifyDraftChange();
  }

  function applySnapshotToUi(snapshot: SessionTranscriptSnapshot): void {
    lastSnapshot = snapshot;
    segmentEditor.setTranscript(snapshot.originalResult, snapshot.editedResult, {
      savedBaseline: snapshot.editedResult,
    });
    draftConfig = {
      ...draftConfig,
      result: snapshot.editedResult,
      resultCapturedAt: snapshot.capturedAt,
    };
    syncBakeButton();
    updateSourceCopy();
    void refreshTranscriptDeliveryStatus();
    notifyPreviewChange();
  }

  function mergeIdbTranscriptIfNewer(): void {
    if (!lastSnapshot) return;
    if (lastSnapshot.capturedAt <= dismissedSnapshotCapturedAt) return;
    // BUG FIX: IDB poll stomps unsaved transcript edits (eloquent-4a)
    // Fix: skip merge while the segment editor has local unsaved changes.
    if (segmentEditor.getState().dirty) return;
    if (lastSnapshot.capturedAt <= (draftConfig.resultCapturedAt ?? 0)) return;

    syncing = true;
    applySnapshotToUi(lastSnapshot);
    syncStyleControls();
    syncing = false;
  }

  function previewText(): string {
    const edited = segmentEditor.getEditedResult();
    if (edited?.segments?.length) {
      return rebuildTextFromSegments(edited.segments);
    }
    return edited?.text?.trim() ?? '';
  }

  function syncTextGradientOptionsUi(): void {
    const gradientOn = textGradientInput.checked;
    textGradientWaveInput.disabled = !gradientOn;
    if (!gradientOn) {
      textGradientWaveInput.checked = false;
    }
  }

  function syncGlowOptionsUi(): void {
    const glowOn = glowInput.checked;
    const borderMode = glowModeSelect.value === 'border';
    const hueRotate = glowColorSelect.value === 'rainbow';
    glowOptionsEl.hidden = !glowOn;
    glowModeSelect.disabled = !glowOn;
    glowColorSelect.disabled = !glowOn;
    glowDualBorderInput.disabled = !glowOn;
    glowHueRotatePanel.hidden = !glowOn || !hueRotate;
    glowHueRotateModeSelect.disabled = !glowOn || !hueRotate;
    glowOpacityInput.classList.toggle('is-disabled', !glowOn || borderMode);
  }

  function syncSpecialHueUi(): void {
    const needsSpecial =
      textColorSelect.value === 'special' || (glowInput.checked && glowColorSelect.value === 'special');
    specialHuePanel.hidden = !needsSpecial;
    if (needsSpecial) {
      specialHuePicker.sync({
        barColor: draftConfig.style.specialHue ?? DEFAULT_SUBTITLE_SPECIAL_HUE,
      });
    }
  }

  function syncStyleControls(): void {
    syncing = true;
    const style = draftConfig.style;
    positionSelect.value = style.position ?? 'bottom';
    fontFamilySelect.value = style.fontFamily ?? 'dejavu-sans';
    const fontSize = style.fontSize ?? 22;
    setPhysicalSliderValue(fontSizeInput, fontSize);
    fontSizeValueEl.textContent = `${fontSize}px`;
    backdropInput.checked = style.backdrop?.enabled !== false;
    const opacityPct = Math.round((style.backdrop?.opacity ?? 0.72) * 100);
    setPhysicalSliderValue(backdropOpacityInput, opacityPct);
    backdropOpacityValueEl.textContent = `${opacityPct}%`;
    backdropOpacityInput.classList.toggle('is-disabled', !backdropInput.checked);
    textColorSelect.value = style.textColor ?? 'white';
    textGradientInput.checked = style.textGradient !== false;
    textGradientWaveInput.checked = style.textGradientWave === true;
    syncTextGradientOptionsUi();
    glowInput.checked = style.glow?.enabled === true;
    glowModeSelect.value = style.glow?.mode ?? 'halo';
    glowColorSelect.value = style.glow?.colorSource ?? 'theme';
    glowHueRotateModeSelect.value = style.glow?.hueRotateMode ?? 'rainbow';
    glowDualBorderInput.checked = style.glow?.dualBorder === true;
    const glowOpacityPct = Math.round((style.glow?.opacity ?? 0.55) * 100);
    setPhysicalSliderValue(glowOpacityInput, glowOpacityPct);
    glowOpacityValueEl.textContent = `${glowOpacityPct}%`;
    syncGlowOptionsUi();
    syncSpecialHueUi();
    syncing = false;
  }

  function syncEnabledUi(): void {
    const enabled = draftConfig.transcriptionEnabled;
    enabledInput.checked = enabled;
    bodyEl.hidden = !enabled;
  }

  function updateSourceCopy(): void {
    if (!lastSnapshot) {
      sourceEl.textContent =
        'No transcript yet — record a voice note on Reddit, then reopen Design Studio. Transcription runs in parallel with export (~40 MB model).';
      return;
    }

    const chars = lastSnapshot.editedResult.text.length;
    const segments = lastSnapshot.editedResult.segments.length;
    const dirty = segmentEditor.getState().dirty;
    const dirtyLabel = dirty ? ' · unsaved edits' : '';
    sourceEl.textContent = `Last transcript: ${segments} segment(s) · ${chars} chars · ${formatSavedAt(lastSnapshot.capturedAt)}${dirtyLabel}`;
  }

  function mergeStyleFromControls(): SubtitleStyleConfig {
    const opacity = Number(backdropOpacityInput.dataset.value) / 100;
    const glowOpacity = Number(glowOpacityInput.dataset.value) / 100;
    return normalizeSubtitleStyle({
      ...draftConfig.style,
      enabled: draftConfig.transcriptionEnabled,
      position: positionSelect.value as SubtitleStyleConfig['position'],
      fontFamily: fontFamilySelect.value,
      fontSize: Number(fontSizeInput.dataset.value),
      textColor: textColorSelect.value as SubtitleTextColor,
      textGradient: textGradientInput.checked,
      textGradientWave: textGradientWaveInput.checked,
      backdrop: {
        ...draftConfig.style.backdrop,
        enabled: backdropInput.checked,
        opacity,
      },
      specialHue: draftConfig.style.specialHue ?? DEFAULT_SUBTITLE_SPECIAL_HUE,
      glow: {
        ...draftConfig.style.glow,
        enabled: glowInput.checked,
        mode: glowModeSelect.value as SubtitleGlowMode,
        colorSource: glowColorSelect.value as SubtitleGlowColorSource,
        hueRotateMode: glowHueRotateModeSelect.value as SubtitleGlowHueRotateMode,
        opacity: glowOpacity,
        dualBorder: glowDualBorderInput.checked,
      },
    });
  }

  async function loadTranscriptSource(): Promise<void> {
    lastSnapshot = await loadSessionTranscript();
    updateSourceCopy();
    mergeIdbTranscriptIfNewer();
    await refreshTranscriptDeliveryStatus();
  }

  async function applySubtitlesEnabled(enabled: boolean, clearTranscript: boolean): Promise<void> {
    if (!enabled && clearTranscript) {
      await clearSessionTranscriptStore();
      lastSnapshot = null;
      dismissedSnapshotCapturedAt = Date.now();
      dismissCurrentSessionTranscript();
      updateSourceCopy();
    }

    draftConfig = {
      ...draftConfig,
      transcriptionEnabled: enabled,
      style: normalizeSubtitleStyle({
        ...draftConfig.style,
        enabled,
      }),
    };
    syncEnabledUi();
    if (enabled) {
      await loadTranscriptSource();
    }
    writeSubtitlesEnabledLocal(enabled);
    await setSubtitlesEnabled(enabled);
    await persistNow();
    notifyDraftChange();
  }

  enabledInput.addEventListener('change', () => {
    if (syncing) return;
    const enabled = enabledInput.checked;

    if (!enabled && hasStoredTranscript()) {
      syncing = true;
      enabledInput.checked = true;
      syncing = false;
      showDisableGuard();
      return;
    }

    void applySubtitlesEnabled(enabled, false);
  });

  disableCancelBtn.addEventListener('click', () => {
    hideDisableGuard();
    syncing = true;
    enabledInput.checked = true;
    syncing = false;
  });

  disableConfirmBtn.addEventListener('click', () => {
    hideDisableGuard();
    void applySubtitlesEnabled(false, true);
  });

  const onDisableGuardKeydown = (event: KeyboardEvent): void => {
    if (disableGuardEl.hidden || event.key !== 'Escape') return;
    event.preventDefault();
    hideDisableGuard();
    syncing = true;
    enabledInput.checked = true;
    syncing = false;
  };

  document.addEventListener('keydown', onDisableGuardKeydown);

  resetBtn.addEventListener('click', () => {
    void (async () => {
      await clearSessionTranscriptStore();
      lastSnapshot = null;
      dismissedSnapshotCapturedAt = Date.now();
      dismissCurrentSessionTranscript();
      updateSourceCopy();
      await persistNow();
    })();
  });

  bakeBtn.addEventListener('click', () => {
    void (async () => {
      if (baking) return;
      if (!canBakeNow()) {
        bakeStatusEl.textContent = resolveUnavailableBakeHint();
        return;
      }
      const edited = segmentEditor.getEditedResult();
      if (!edited) {
        bakeStatusEl.textContent = 'Transcript not ready for bake yet.';
        return;
      }
      await runSubtitleBake();
    })();
  });

  bakeSaveContinueBtn.addEventListener('click', () => {
    void (async () => {
      const edited = segmentEditor.getEditedResult();
      if (!edited || baking) return;
      try {
        await saveSessionTranscriptEdits(edited, { confirmed: true });
        segmentEditor.markConfirmedSaved();
        lastSnapshot = await loadSessionTranscript();
        syncDraftFromEditor();
        syncBakeButton();
        updateSourceCopy();
        await runSubtitleBake();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        bakeStatusEl.textContent = `Could not save transcript: ${message}`;
      }
    })();
  });

  bakeEditBackBtn.addEventListener('click', () => {
    hideBakeUnsavedDialog();
    bakeStatusEl.textContent = 'Review your transcript edits, then save and bake.';
    panel.querySelector<HTMLButtonElement>('[data-transcript-edit-open]')?.focus();
  });

  const overlayLabHandle = isSubtitleOverlayLabEnabled()
    ? mountSubtitleOverlayLab(panel, {
        getBaseStyle: mergeStyleFromControls,
        getSessionEdited: () => segmentEditor.getEditedResult(),
        getThemeBarColor: handlers?.getThemeBarColor,
      })
    : { dispose() {} };

  bakeUnsavedCancelBtn.addEventListener('click', () => {
    hideBakeUnsavedDialog();
    bakeStatusEl.textContent = 'Bake cancelled.';
  });

  positionSelect.addEventListener('change', () => {
    if (syncing) return;
    draftConfig = { ...draftConfig, style: mergeStyleFromControls() };
    schedulePersist();
    notifyDraftChange();
  });

  fontFamilySelect.addEventListener('change', () => {
    if (syncing) return;
    draftConfig = { ...draftConfig, style: mergeStyleFromControls() };
    schedulePersist();
    notifyDraftChange();
  });

  const unwireFontSize = wirePhysicalSliders(fontSizeInput, {
    onValueChange(_slider, value) {
      if (syncing) return;
      fontSizeValueEl.textContent = `${value}px`;
      draftConfig = { ...draftConfig, style: mergeStyleFromControls() };
      schedulePersist();
      notifyDraftChange();
    },
  });

  backdropInput.addEventListener('change', () => {
    if (syncing) return;
    backdropOpacityInput.classList.toggle('is-disabled', !backdropInput.checked);
    draftConfig = { ...draftConfig, style: mergeStyleFromControls() };
    schedulePersist();
    notifyDraftChange();
  });

  const unwireBackdropOpacity = wirePhysicalSliders(backdropOpacityInput, {
    isDisabled: () => !backdropInput.checked,
    onValueChange(_slider, value) {
      if (syncing) return;
      backdropOpacityValueEl.textContent = `${value}%`;
      draftConfig = { ...draftConfig, style: mergeStyleFromControls() };
      schedulePersist();
      notifyDraftChange();
    },
  });

  textColorSelect.addEventListener('change', () => {
    if (syncing) return;
    syncSpecialHueUi();
    draftConfig = { ...draftConfig, style: mergeStyleFromControls() };
    schedulePersist();
    notifyDraftChange();
  });

  glowInput.addEventListener('change', () => {
    if (syncing) return;
    syncGlowOptionsUi();
    syncSpecialHueUi();
    draftConfig = { ...draftConfig, style: mergeStyleFromControls() };
    schedulePersist();
    notifyDraftChange();
  });

  glowModeSelect.addEventListener('change', () => {
    if (syncing) return;
    syncGlowOptionsUi();
    draftConfig = { ...draftConfig, style: mergeStyleFromControls() };
    schedulePersist();
    notifyDraftChange();
  });

  glowColorSelect.addEventListener('change', () => {
    if (syncing) return;
    syncGlowOptionsUi();
    syncSpecialHueUi();
    draftConfig = { ...draftConfig, style: mergeStyleFromControls() };
    schedulePersist();
    notifyDraftChange();
  });

  glowHueRotateModeSelect.addEventListener('change', () => {
    if (syncing) return;
    draftConfig = { ...draftConfig, style: mergeStyleFromControls() };
    schedulePersist();
    notifyDraftChange();
  });

  glowDualBorderInput.addEventListener('change', () => {
    if (syncing) return;
    draftConfig = { ...draftConfig, style: mergeStyleFromControls() };
    schedulePersist();
    notifyDraftChange();
  });

  textGradientInput.addEventListener('change', () => {
    if (syncing) return;
    syncTextGradientOptionsUi();
    draftConfig = { ...draftConfig, style: mergeStyleFromControls() };
    schedulePersist();
    notifyDraftChange();
  });

  textGradientWaveInput.addEventListener('change', () => {
    if (syncing) return;
    draftConfig = { ...draftConfig, style: mergeStyleFromControls() };
    schedulePersist();
    notifyDraftChange();
  });

  const unwireGlowOpacity = wirePhysicalSliders(glowOpacityInput, {
    isDisabled: () => !glowInput.checked || glowModeSelect.value === 'border',
    onValueChange(_slider, value) {
      if (syncing) return;
      glowOpacityValueEl.textContent = `${value}%`;
      draftConfig = { ...draftConfig, style: mergeStyleFromControls() };
      schedulePersist();
      notifyDraftChange();
    },
  });

  const onVisibility = (): void => {
    if (document.visibilityState !== 'visible') return;
    void loadTranscriptSource();
  };

  document.addEventListener('visibilitychange', onVisibility);

  const pollTimer = window.setInterval(() => {
    void loadTranscriptSource();
  }, TRANSCRIPT_POLL_MS);

  const onTranscriptReady = (changes: Record<string, unknown>, area: string): void => {
    if (area !== 'local') return;
    if (SESSION_TRANSCRIPT_READY_KEY in changes) {
      void loadTranscriptSource();
      return;
    }
    if (LAST_RECORDING_READY_KEY in changes || BAKED_MP4_READY_KEY in changes) {
      void refreshSessionStatusCache();
      void refreshTranscriptDeliveryStatus();
    }
  };
  browser.storage.onChanged.addListener(onTranscriptReady);

  const localEnabled = readSubtitlesEnabledLocal();
  if (localEnabled !== null) {
    draftConfig = normalizeTranscriptConfig({
      ...draftConfig,
      transcriptionEnabled: localEnabled,
      style: { ...draftConfig.style, enabled: localEnabled },
    });
    syncEnabledUi();
    syncStyleControls();
    notifyPreviewChange();
  }

  void refreshSessionStatusCache();

  void loadUserPreferences().then((prefs) => {
    const settings = normalizeTranscriptConfig(prefs.transcriptConfig);
    draftConfig = {
      ...draftConfig,
      transcriptionEnabled: settings.transcriptionEnabled,
      style: settings.style,
      result: null,
      resultCapturedAt: undefined,
    };
    syncEnabledUi();
    syncStyleControls();
    void loadTranscriptSource();
    // BUG FIX: false Update profile highlight on Studio open (BUG-027)
    // Fix: async subtitle prefs load must refresh profile dirty after draft aligns.
    notifySettingsChange();
  });

  return {
    syncFromPreferences(prefs: UserPreferencesV1): void {
      syncing = true;
      const settings = normalizeTranscriptConfig(prefs.transcriptConfig);
      draftConfig = {
        ...draftConfig,
        transcriptionEnabled: settings.transcriptionEnabled,
        style: settings.style,
      };
      syncEnabledUi();
      syncStyleControls();
      syncing = false;
      void loadTranscriptSource();
    },
    async flushPersist(): Promise<void> {
      await persistNow();
    },
    dispose(): void {
      bakeAbort?.abort();
      overlayLabHandle.dispose();
      hideDisableGuard();
      clearPendingTranscriptTimer();
      document.removeEventListener('keydown', onDisableGuardKeydown);
      document.removeEventListener('visibilitychange', onVisibility);
      browser.storage.onChanged.removeListener(onTranscriptReady);
      unwireFontSize();
      unwireBackdropOpacity();
      unwireGlowOpacity();
      window.clearInterval(pollTimer);
      if (saveTimer) window.clearTimeout(saveTimer);
      writeSubtitlesEnabledLocal(draftConfig.transcriptionEnabled);
      void setSubtitlesEnabled(draftConfig.transcriptionEnabled).then(() => persistNow());
      segmentEditor.dispose();
    },
    getDraftConfig: buildDraftConfig,
    getProfileSnapshotConfig(): TranscriptConfig {
      return buildProfileStyleConfig();
    },
    getPreviewOptions(): SubtitlePreviewOptions | undefined {
      const config = normalizeTranscriptConfig({
        ...draftConfig,
        style: mergeStyleFromControls(),
      });
      if (!config.transcriptionEnabled) return undefined;
      return {
        enabled: true,
        text: previewText(),
        segments: segmentEditor.getEditedResult()?.segments,
        style: config.style,
        themeBarColor: handlers?.getThemeBarColor?.(),
      };
    },
    isTranscriptDirty(): boolean {
      return segmentEditor.getState().dirty;
    },
    getTranscriptDeliveryStatus(): TranscriptDeliveryStatus {
      return segmentEditor.getTranscriptDeliveryStatus();
    },
    hasSessionRecording,
    hasTranscriptCues,
    isBakedForCurrentSession,
    async confirmTranscriptEdits(): Promise<void> {
      const edited = segmentEditor.getEditedResult();
      if (!edited || !segmentEditor.getState().dirty) return;
      await saveSessionTranscriptEdits(edited, { confirmed: true });
      lastSnapshot = await loadSessionTranscript();
      segmentEditor.markConfirmedSaved();
      syncDraftFromEditor();
      syncBakeButton();
      updateSourceCopy();
    },
    async discardTranscriptEdits(): Promise<void> {
      await revertSessionTranscriptEdits();
      const snapshot = await loadSessionTranscript();
      if (snapshot) {
        lastSnapshot = snapshot;
        segmentEditor.setTranscript(snapshot.originalResult, snapshot.editedResult, {
          savedBaseline: snapshot.editedResult,
        });
      }
      syncDraftFromEditor();
      syncBakeButton();
      updateSourceCopy();
    },
  };
}