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
  DEFAULT_SUBTITLE_SPECIAL_HUE,
  DEFAULT_TRANSCRIPT_CONFIG,
  normalizeSubtitleStyle,
  normalizeTranscriptConfig,
  transcriptConfigForProfileStorage,
  type SubtitleGlowColorSource,
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
import { bakeSubtitlesInStudio } from '@/src/ui/design-studio/subtitle-bake';
import {
  mountSubtitleSegmentEditor,
  renderSubtitleSegmentEditorFields,
  type TranscriptDeliveryStatus,
} from '@/src/ui/design-studio/subtitle-segment-editor';
import { renderPreviewBlock } from '@/src/ui/design-studio/preview-block';

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

// CHANGED: top → center → bottom (visual order on screen)
// WHY: dropdown order regressed to bottom-first before; keep top-first in source
const POSITION_OPTIONS: { value: SubtitleStyleConfig['position']; label: string }[] = [
  { value: 'top', label: 'Top' },
  { value: 'center', label: 'Center' },
  { value: 'bottom', label: 'Bottom' },
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
              class="studio-v4__bake-btn studio__bake-btn"
              data-subtitle-bake
              disabled
            >
              Bake subtitles into MP4
            </button>
            <div class="studio__bake-unsaved" data-bake-unsaved-dialog hidden>
              <p class="popup__field-desc studio__bake-unsaved-copy">
                You have unsaved transcript edits. Save before baking, or go back to the editor.
              </p>
              <div class="popup__profile-actions studio__inline-actions studio-v4__guard-actions">
                <button type="button" class="popup__button popup__button--secondary studio-v4__guard-cancel" data-bake-unsaved-cancel>
                  Cancel
                </button>
                <button type="button" class="popup__button popup__button--secondary studio-v4__guard-discard" data-bake-edit-back>
                  Edit transcript
                </button>
                <button type="button" class="popup__profile-btn popup__profile-btn--save studio-v4__guard-apply" data-bake-save-continue>
                  Save &amp; bake
                </button>
              </div>
            </div>
            <p class="popup__field-desc studio__bake-status" data-subtitle-bake-status>
              Confirm your transcript edits, then bake. The Reddit recorder will pick up the captioned MP4.
            </p>
          </div>
        </div>
        ${renderSubtitleSegmentEditorFields()}
        <label class="popup__field studio__field--compact">
          <span class="popup__field-label">Position</span>
          <select class="popup__select" data-subtitle-position aria-label="Subtitle position"></select>
        </label>
        <label class="popup__field studio__field--compact">
          <span class="popup__field-label">
            Font size <span data-subtitle-font-size-value>22px</span>
          </span>
          <input
            class="popup__range"
            type="range"
            min="14"
            max="36"
            step="1"
            value="22"
            data-subtitle-font-size
            aria-label="Subtitle font size"
          />
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
          <input
            class="popup__range"
            type="range"
            min="30"
            max="95"
            step="1"
            value="72"
            data-subtitle-backdrop-opacity
            aria-label="Subtitle backdrop opacity"
          />
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
            </select>
          </label>
          <label class="popup__field studio__field--compact">
            <span class="popup__field-label">
              Glow strength <span data-subtitle-glow-opacity-value>55%</span>
            </span>
            <input
              class="popup__range"
              type="range"
              min="20"
              max="90"
              step="1"
              value="55"
              data-subtitle-glow-opacity
              aria-label="Subtitle glow strength"
            />
          </label>
        </div>
        <div class="studio__subtitle-special-hue" data-subtitle-special-hue-panel hidden>
          <p class="popup__field-label studio__subtitle-special-hue-label">Special hue</p>
          <p class="popup__field-desc">Shared by text and glow when either uses Special hue.</p>
          ${renderColorPickerFields()}
          <label class="popup__toggle-row studio__subtitles-toggle">
            <span class="popup__toggle-copy">
              <span class="popup__toggle-label">
                Rainbow pulse
                <span class="popup__micro studio__rainbow-bake-hint">Bake: stepped</span>
              </span>
              <p class="popup__field-desc">
                Rotates special-hue text and glow through the wheel over time (~3 s per cycle). Live preview is smoother than baked MP4.
              </p>
            </span>
            <input
              class="popup__toggle-input"
              type="checkbox"
              data-subtitle-special-hue-rainbow
              aria-label="Rainbow pulse on special hue"
            />
          </label>
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
  const fontSizeInput = panel.querySelector<HTMLInputElement>('[data-subtitle-font-size]')!;
  const fontSizeValueEl = panel.querySelector<HTMLElement>('[data-subtitle-font-size-value]')!;
  const backdropInput = panel.querySelector<HTMLInputElement>('[data-subtitle-backdrop]')!;
  const backdropOpacityInput = panel.querySelector<HTMLInputElement>('[data-subtitle-backdrop-opacity]')!;
  const backdropOpacityValueEl = panel.querySelector<HTMLElement>(
    '[data-subtitle-backdrop-opacity-value]',
  )!;
  const textColorSelect = panel.querySelector<HTMLSelectElement>('[data-subtitle-text-color]')!;
  const specialHuePanel = panel.querySelector<HTMLElement>('[data-subtitle-special-hue-panel]')!;
  const specialHueRainbowInput = panel.querySelector<HTMLInputElement>(
    '[data-subtitle-special-hue-rainbow]',
  )!;
  const glowInput = panel.querySelector<HTMLInputElement>('[data-subtitle-glow]')!;
  const glowOptionsEl = panel.querySelector<HTMLElement>('[data-subtitle-glow-options]')!;
  const glowModeSelect = panel.querySelector<HTMLSelectElement>('[data-subtitle-glow-mode]')!;
  const glowColorSelect = panel.querySelector<HTMLSelectElement>('[data-subtitle-glow-color]')!;
  const glowOpacityInput = panel.querySelector<HTMLInputElement>('[data-subtitle-glow-opacity]')!;
  const glowOpacityValueEl = panel.querySelector<HTMLElement>('[data-subtitle-glow-opacity-value]')!;
  const resetBtn = panel.querySelector<HTMLButtonElement>('[data-subtitle-reset]')!;
  const bakeBtn = panel.querySelector<HTMLButtonElement>('[data-subtitle-bake]')!;
  const bakeStatusEl = panel.querySelector<HTMLElement>('[data-subtitle-bake-status]')!;
  const bakeUnsavedDialog = panel.querySelector<HTMLElement>('[data-bake-unsaved-dialog]')!;
  const bakeSaveContinueBtn = panel.querySelector<HTMLButtonElement>('[data-bake-save-continue]')!;
  const bakeEditBackBtn = panel.querySelector<HTMLButtonElement>('[data-bake-edit-back]')!;
  const bakeUnsavedCancelBtn = panel.querySelector<HTMLButtonElement>('[data-bake-unsaved-cancel]')!;

  let draftConfig: TranscriptConfig = normalizeTranscriptConfig(DEFAULT_TRANSCRIPT_CONFIG);
  let lastSnapshot: SessionTranscriptSnapshot | null = null;
  let dismissedSnapshotCapturedAt = 0;
  let syncing = false;
  let saveTimer = 0;
  let baking = false;
  let bakeAbort: AbortController | null = null;
  let lastRecordingReadyAt = 0;
  let lastBakedAt = 0;
  let pendingTranscriptTimer: number | null = null;
  let pendingTranscriptSince = 0;

  const segmentEditor = mountSubtitleSegmentEditor(panel, {
    onStateChange: () => {
      syncBakeButton();
      syncDraftFromEditor();
      notifyPreviewChange();
    },
    async onSaveEdits(edited) {
      await saveSessionTranscriptEdits(edited, { confirmed: true });
      lastSnapshot = await loadSessionTranscript();
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

  function hideBakeUnsavedDialog(): void {
    bakeUnsavedDialog.hidden = true;
  }

  function showBakeUnsavedDialog(): void {
    bakeUnsavedDialog.hidden = false;
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
        segmentEditor.setTranscriptDeliveryStatus('ready');
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
      segmentEditor.setTranscriptDeliveryStatus(snapshotAt > 0 ? 'ready' : 'idle');
    } finally {
      notifySettingsChange();
    }
  }

  function syncBakeButton(): void {
    const edited = segmentEditor.getEditedResult();
    const hasSegments = (edited?.segments?.length ?? 0) > 0;
    const canBake = hasSegments && !baking;
    bakeBtn.disabled = !canBake;
  }

  async function runSubtitleBake(): Promise<void> {
    const edited = segmentEditor.getEditedResult();
    if (!edited) {
      bakeStatusEl.textContent = 'Transcript not ready for bake yet.';
      return;
    }

    baking = true;
    bakeAbort = new AbortController();
    bakeBtn.disabled = true;
    hideBakeUnsavedDialog();
    bakeStatusEl.textContent = 'Preparing subtitle bake…';

    try {
      const config = buildDraftConfig();
      await bakeSubtitlesInStudio({
        editedResult: edited,
        style: config.style,
        signal: bakeAbort.signal,
        onProgress: (progress) => {
          bakeStatusEl.textContent = progress.message ?? 'Baking subtitles…';
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

  function syncGlowOptionsUi(): void {
    const glowOn = glowInput.checked;
    const borderMode = glowModeSelect.value === 'border';
    glowOptionsEl.hidden = !glowOn;
    glowModeSelect.disabled = !glowOn;
    glowColorSelect.disabled = !glowOn;
    glowOpacityInput.disabled = !glowOn || borderMode;
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
    const fontSize = style.fontSize ?? 22;
    fontSizeInput.value = String(fontSize);
    fontSizeValueEl.textContent = `${fontSize}px`;
    backdropInput.checked = style.backdrop?.enabled !== false;
    const opacityPct = Math.round((style.backdrop?.opacity ?? 0.72) * 100);
    backdropOpacityInput.value = String(opacityPct);
    backdropOpacityValueEl.textContent = `${opacityPct}%`;
    backdropOpacityInput.disabled = !backdropInput.checked;
    textColorSelect.value = style.textColor ?? 'white';
    specialHueRainbowInput.checked = style.specialHueRainbow === true;
    glowInput.checked = style.glow?.enabled === true;
    glowModeSelect.value = style.glow?.mode ?? 'halo';
    glowColorSelect.value = style.glow?.colorSource ?? 'theme';
    const glowOpacityPct = Math.round((style.glow?.opacity ?? 0.55) * 100);
    glowOpacityInput.value = String(glowOpacityPct);
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
    const opacity = Number(backdropOpacityInput.value) / 100;
    const glowOpacity = Number(glowOpacityInput.value) / 100;
    return normalizeSubtitleStyle({
      ...draftConfig.style,
      enabled: draftConfig.transcriptionEnabled,
      position: positionSelect.value as SubtitleStyleConfig['position'],
      fontSize: Number(fontSizeInput.value),
      textColor: textColorSelect.value as SubtitleTextColor,
      backdrop: {
        ...draftConfig.style.backdrop,
        enabled: backdropInput.checked,
        opacity,
      },
      specialHue: draftConfig.style.specialHue ?? DEFAULT_SUBTITLE_SPECIAL_HUE,
      specialHueRainbow: specialHueRainbowInput.checked,
      glow: {
        ...draftConfig.style.glow,
        enabled: glowInput.checked,
        mode: glowModeSelect.value as SubtitleGlowMode,
        colorSource: glowColorSelect.value as SubtitleGlowColorSource,
        opacity: glowOpacity,
      },
    });
  }

  async function loadTranscriptSource(): Promise<void> {
    lastSnapshot = await loadSessionTranscript();
    updateSourceCopy();
    mergeIdbTranscriptIfNewer();
    await refreshTranscriptDeliveryStatus();
  }

  enabledInput.addEventListener('change', () => {
    if (syncing) return;
    const enabled = enabledInput.checked;
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
      void loadTranscriptSource().then(() => {
        dismissCurrentSessionTranscript();
      });
    }
    writeSubtitlesEnabledLocal(enabled);
    void setSubtitlesEnabled(enabled).then(() => persistNow());
    notifyDraftChange();
  });

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
      const edited = segmentEditor.getEditedResult();
      const { dirty, confirmed } = segmentEditor.getState();
      if (!edited || baking) {
        bakeStatusEl.textContent = 'Transcript not ready for bake yet.';
        return;
      }
      if (dirty) {
        showBakeUnsavedDialog();
        bakeStatusEl.textContent = 'Save your transcript edits before baking, or choose an option below.';
        return;
      }
      if (!confirmed) {
        bakeStatusEl.textContent = 'Confirm & save your transcript edits before baking.';
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

  fontSizeInput.addEventListener('input', () => {
    if (syncing) return;
    fontSizeValueEl.textContent = `${fontSizeInput.value}px`;
    draftConfig = { ...draftConfig, style: mergeStyleFromControls() };
    schedulePersist();
    notifyDraftChange();
  });

  backdropInput.addEventListener('change', () => {
    if (syncing) return;
    backdropOpacityInput.disabled = !backdropInput.checked;
    draftConfig = { ...draftConfig, style: mergeStyleFromControls() };
    schedulePersist();
    notifyDraftChange();
  });

  backdropOpacityInput.addEventListener('input', () => {
    if (syncing) return;
    backdropOpacityValueEl.textContent = `${backdropOpacityInput.value}%`;
    draftConfig = { ...draftConfig, style: mergeStyleFromControls() };
    schedulePersist();
    notifyDraftChange();
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
    syncSpecialHueUi();
    draftConfig = { ...draftConfig, style: mergeStyleFromControls() };
    schedulePersist();
    notifyDraftChange();
  });

  specialHueRainbowInput.addEventListener('change', () => {
    if (syncing) return;
    draftConfig = { ...draftConfig, style: mergeStyleFromControls() };
    schedulePersist();
    notifyDraftChange();
  });

  glowOpacityInput.addEventListener('input', () => {
    if (syncing) return;
    glowOpacityValueEl.textContent = `${glowOpacityInput.value}%`;
    draftConfig = { ...draftConfig, style: mergeStyleFromControls() };
    schedulePersist();
    notifyDraftChange();
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
      clearPendingTranscriptTimer();
      document.removeEventListener('visibilitychange', onVisibility);
      browser.storage.onChanged.removeListener(onTranscriptReady);
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