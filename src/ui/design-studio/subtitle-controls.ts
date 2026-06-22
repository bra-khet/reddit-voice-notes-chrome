import {
  clearSessionTranscriptStore,
  loadSessionTranscript,
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
import type { SubtitlePreviewOptions } from '@/src/transcription/subtitle-preview';

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
            Preview captions on the canvas. Enabled subtitles burn into your MP4 on export.
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
        <label class="popup__field studio__field--compact">
          <span class="popup__field-label">Transcript</span>
          <textarea
            class="popup__textarea studio__subtitles-text"
            rows="5"
            data-subtitle-text
            placeholder="Transcript appears here after you record and stop on Reddit."
            aria-label="Editable transcript text"
          ></textarea>
        </label>
        <p class="studio__subtitles-meta popup__field-desc" data-subtitle-meta hidden></p>
        <div class="popup__profile-actions studio__inline-actions">
          <button
            type="button"
            class="popup__profile-btn popup__profile-btn--delete"
            data-subtitle-reset
          >
            Clear transcript
          </button>
        </div>
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
      </div>
    </div>
  `;
}

export interface SubtitleControlHandlers {
  /** Style / enabled edits — may affect profile dirty state. */
  onSettingsChange?: () => void;
  /** Transcript text merge — preview only. */
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
  const textArea = panel.querySelector<HTMLTextAreaElement>('[data-subtitle-text]')!;
  const metaEl = panel.querySelector<HTMLElement>('[data-subtitle-meta]')!;
  const positionSelect = panel.querySelector<HTMLSelectElement>('[data-subtitle-position]')!;
  const fontSizeInput = panel.querySelector<HTMLInputElement>('[data-subtitle-font-size]')!;
  const fontSizeValueEl = panel.querySelector<HTMLElement>('[data-subtitle-font-size-value]')!;
  const backdropInput = panel.querySelector<HTMLInputElement>('[data-subtitle-backdrop]')!;
  const backdropOpacityInput = panel.querySelector<HTMLInputElement>('[data-subtitle-backdrop-opacity]')!;
  const backdropOpacityValueEl = panel.querySelector<HTMLElement>(
    '[data-subtitle-backdrop-opacity-value]',
  )!;
  const resetBtn = panel.querySelector<HTMLButtonElement>('[data-subtitle-reset]')!;

  let draftConfig: TranscriptConfig = normalizeTranscriptConfig(DEFAULT_TRANSCRIPT_CONFIG);
  let lastSnapshot: SessionTranscriptSnapshot | null = null;
  /** IDB snapshots at or before this ms are ignored (user clear / re-enable / reset). */
  let dismissedSnapshotCapturedAt = 0;
  let syncing = false;
  let saveTimer = 0;

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
      ...draftConfig,
      transcriptionEnabled: enabled,
      style: normalizeSubtitleStyle({
        ...mergeStyleFromControls(),
        enabled,
      }),
    });
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
    applyResultToDraft(null);
    notifyDraftChange();
  }

  function mergeIdbTranscriptIfNewer(): void {
    if (!lastSnapshot) return;
    if (lastSnapshot.capturedAt <= dismissedSnapshotCapturedAt) return;
    if (lastSnapshot.capturedAt <= (draftConfig.resultCapturedAt ?? 0)) return;

    draftConfig = normalizeTranscriptConfig({
      ...draftConfig,
      result: lastSnapshot.result,
      resultCapturedAt: lastSnapshot.capturedAt,
    });
    syncing = true;
    applyResultToDraft(draftConfig.result ?? null);
    syncStyleControls();
    syncing = false;
    notifyPreviewChange();
  }

  function previewText(): string {
    const edited = textArea.value.trim();
    if (edited) return edited;
    return draftConfig.result?.text?.trim() ?? '';
  }

  function applyResultToDraft(result: TranscriptResult | null): void {
    draftConfig = {
      ...draftConfig,
      result: result
        ? {
            ...result,
            source: result.source === 'manual' ? 'manual' : 'vosk',
          }
        : null,
    };
    textArea.value = result?.text ?? '';
    if (result?.segments?.length) {
      metaEl.textContent = `${result.segments.length} segment(s) · edit text freely; timing preserved for export later.`;
      metaEl.hidden = false;
    } else {
      metaEl.hidden = true;
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

    const chars = lastSnapshot.result.text.length;
    const segments = lastSnapshot.result.segments.length;
    sourceEl.textContent = `Last transcript: ${segments} segment(s) · ${chars} chars · ${formatSavedAt(lastSnapshot.capturedAt)}`;
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

  function syncControlsFromDraft(): void {
    syncEnabledUi();
    applyResultToDraft(draftConfig.result ?? null);
    syncStyleControls();
    notifyDraftChange();
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
    // CHANGED: re-enabling subtitles waits for a new recording transcript.
    // WHY: IDB poll was resurrecting cleared / stale session text (BUG-020).
    if (enabled) {
      void loadTranscriptSource().then(() => {
        dismissCurrentSessionTranscript();
      });
    }
    writeSubtitlesEnabledLocal(enabled);
    void setSubtitlesEnabled(enabled).then(() => persistNow());
    notifyDraftChange();
  });

  textArea.addEventListener('input', () => {
    if (syncing) return;
    const text = textArea.value;
    if (!text.trim()) {
      dismissCurrentSessionTranscript();
      schedulePersist();
      return;
    }
    const base = draftConfig.result ?? {
      text: '',
      segments: [],
      source: 'manual' as const,
    };
    draftConfig = {
      ...draftConfig,
      result: {
        ...base,
        text,
        source: 'manual',
      },
      resultCapturedAt: Date.now(),
    };
    schedulePersist();
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

  // CHANGED: poll extension IDB while studio is open.
  // WHY: transcription completes on Reddit; studio does not receive tab-scoped progress relays.
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
    // CHANGED: init from localStorage syncs UI only — not profile dirty state (BUG-021 revert).
    // WHY: syncControlsFromDraft() fired onSettingsChange before prefs loaded, racing profile bar.
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
      document.removeEventListener('visibilitychange', onVisibility);
      browser.storage.onChanged.removeListener(onTranscriptReady);
      window.clearInterval(pollTimer);
      if (saveTimer) window.clearTimeout(saveTimer);
      writeSubtitlesEnabledLocal(draftConfig.transcriptionEnabled);
      void setSubtitlesEnabled(draftConfig.transcriptionEnabled).then(() => persistNow());
    },
    getDraftConfig: buildDraftConfig,
    getProfileSnapshotConfig(): TranscriptConfig {
      // BUG FIX: getDraftConfig is not defined (BUG-024)
      // Fix: use closure buildDraftConfig — method body cannot call sibling method by bare name.
      return transcriptConfigForProfileStorage(buildDraftConfig());
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