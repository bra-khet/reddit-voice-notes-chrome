import {
  clearSessionTranscriptStore,
  loadSessionTranscript,
  revertSessionTranscriptEdits,
  saveSessionTranscriptEdits,
  type SessionTranscriptSnapshot,
} from '@/src/storage/session-transcript-db';
import {
  loadUserPreferences,
  readSubtitlesEnabledLocal,
  SESSION_TRANSCRIPT_READY_KEY,
  saveTranscriptPreferences,
  setSubtitlesEnabled,
  writeSubtitlesEnabledLocal,
  type UserPreferencesV1,
} from '@/src/settings/user-preferences';
import {
  DEFAULT_TRANSCRIPT_CONFIG,
  normalizeSubtitleStyle,
  normalizeTranscriptConfig,
  transcriptConfigForProfileStorage,
  type SubtitleStyleConfig,
  type TranscriptConfig,
  type TranscriptResult,
} from '@/src/transcription/types';
import { rebuildTextFromSegments } from '@/src/transcription/transcript-editing';
import type { SubtitlePreviewOptions } from '@/src/transcription/subtitle-preview';
import { bakeSubtitlesInStudio } from '@/src/ui/design-studio/subtitle-bake';
import {
  mountSubtitleSegmentEditor,
  renderSubtitleSegmentEditorFields,
} from '@/src/ui/design-studio/subtitle-segment-editor';

export interface SubtitleControlsHandle {
  dispose(): void;
  flushPersist(): Promise<void>;
  getDraftConfig(): TranscriptConfig;
  getProfileSnapshotConfig(): TranscriptConfig;
  getPreviewOptions(): SubtitlePreviewOptions | undefined;
  syncFromPreferences(prefs: UserPreferencesV1): void;
}

const TRANSCRIPT_SAVE_DEBOUNCE_MS = 250;
const TRANSCRIPT_POLL_MS = 2000;

const POSITION_OPTIONS: { value: SubtitleStyleConfig['position']; label: string }[] = [
  { value: 'bottom', label: 'Bottom' },
  { value: 'center', label: 'Center' },
  { value: 'top', label: 'Top' },
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
        <div class="studio__subtitles-bake" data-subtitle-bake-block>
          <button
            type="button"
            class="popup__profile-btn popup__profile-btn--save studio__bake-btn"
            data-subtitle-bake
            disabled
          >
            Bake subtitles into MP4
          </button>
          <p class="popup__field-desc studio__bake-status" data-subtitle-bake-status>
            Confirm your transcript edits, then bake. The Reddit recorder will pick up the captioned MP4.
          </p>
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
  const resetBtn = panel.querySelector<HTMLButtonElement>('[data-subtitle-reset]')!;
  const bakeBtn = panel.querySelector<HTMLButtonElement>('[data-subtitle-bake]')!;
  const bakeStatusEl = panel.querySelector<HTMLElement>('[data-subtitle-bake-status]')!;

  let draftConfig: TranscriptConfig = normalizeTranscriptConfig(DEFAULT_TRANSCRIPT_CONFIG);
  let lastSnapshot: SessionTranscriptSnapshot | null = null;
  let dismissedSnapshotCapturedAt = 0;
  let syncing = false;
  let saveTimer = 0;
  let baking = false;
  let bakeAbort: AbortController | null = null;

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

  function syncBakeButton(): void {
    const edited = segmentEditor.getEditedResult();
    const hasSegments = (edited?.segments?.length ?? 0) > 0;
    const { dirty, confirmed } = segmentEditor.getState();
    const canBake = hasSegments && confirmed && !dirty && !baking;
    bakeBtn.disabled = !canBake;
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
    return normalizeSubtitleStyle({
      ...draftConfig.style,
      enabled: draftConfig.transcriptionEnabled,
      position: positionSelect.value as SubtitleStyleConfig['position'],
      fontSize: Number(fontSizeInput.value),
      backdrop: {
        ...draftConfig.style.backdrop,
        enabled: backdropInput.checked,
        opacity,
      },
    });
  }

  async function loadTranscriptSource(): Promise<void> {
    lastSnapshot = await loadSessionTranscript();
    updateSourceCopy();
    mergeIdbTranscriptIfNewer();
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
      if (!edited || baking || dirty || !confirmed) {
        bakeStatusEl.textContent = dirty
          ? 'Confirm & save your transcript edits before baking.'
          : 'Transcript not ready for bake yet.';
        return;
      }

      baking = true;
      bakeAbort = new AbortController();
      bakeBtn.disabled = true;
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
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        bakeStatusEl.textContent = `Bake failed: ${message}`;
      } finally {
        baking = false;
        bakeAbort = null;
        syncBakeButton();
      }
    })();
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

  const onVisibility = (): void => {
    if (document.visibilityState !== 'visible') return;
    void loadTranscriptSource();
  };

  document.addEventListener('visibilitychange', onVisibility);

  const pollTimer = window.setInterval(() => {
    void loadTranscriptSource();
  }, TRANSCRIPT_POLL_MS);

  const onTranscriptReady = (changes: Record<string, unknown>, area: string): void => {
    if (area !== 'local' || !(SESSION_TRANSCRIPT_READY_KEY in changes)) return;
    void loadTranscriptSource();
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
      };
    },
  };
}