import { createSegmentCuePlayer } from '@/src/transcription/segment-cue-player';
import {
  buildDefaultNewSegment,
  formatCueRange,
  isTranscriptDirty,
  cloneTranscriptResult,
  normalizeEditedTranscriptResult,
} from '@/src/transcription/transcript-editing';
import {
  isSegmentEndOutOfBounds,
  normalizeSegmentSeconds,
  resolveClipDurationForOobCheck,
  resolveClipDurationSeconds,
  segmentHasOutOfBoundsEnd,
} from '@/src/transcription/segment-timing';
import type { TranscriptResult, TranscriptSegment } from '@/src/transcription/types';
import { LAST_RECORDING_READY_KEY } from '@/src/settings/user-preferences';
import { loadLastRecording, type LastRecordingSnapshot } from '@/src/storage/last-recording-db';

export interface SegmentEditorState {
  /** Immutable Vosk output — discard restores this. */
  voskOriginal: TranscriptResult | null;
  /** Last confirmed save — dirty compares edited against this. */
  savedBaseline: TranscriptResult | null;
  edited: TranscriptResult | null;
  dirty: boolean;
  confirmed: boolean;
}

export type TranscriptDeliveryStatus = 'idle' | 'pending' | 'ready' | 'timeout';

export interface SegmentEditorHandle {
  dispose(): void;
  getState(): SegmentEditorState;
  setTranscript(
    voskOriginal: TranscriptResult | null,
    edited?: TranscriptResult | null,
    options?: { savedBaseline?: TranscriptResult | null },
  ): void;
  getEditedResult(): TranscriptResult | null;
  /** After IDB persist — align baseline so dirty UI clears. */
  markConfirmedSaved(): void;
  setTranscriptDeliveryStatus(status: TranscriptDeliveryStatus): void;
}

export interface SegmentEditorHandlers {
  onStateChange?: (state: SegmentEditorState) => void;
  onSaveEdits?: (edited: TranscriptResult) => void | Promise<void>;
  onDiscardEdits?: () => void | Promise<void>;
}

const RECORDING_POLL_MS = 2000;
const OOB_LABEL = '⚠ OOB';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderSubtitleSegmentEditorFields(): string {
  return `
    <div class="studio__transcript" data-transcript-editor>
      <div class="studio__transcript-header">
        <span class="studio__transcript-label">Generated transcript</span>
        <span class="studio__transcript-badge" data-transcript-dirty-badge hidden>Unsaved</span>
        <span class="studio__transcript-badge studio__transcript-badge--pending" data-transcript-pending-badge hidden>Pending</span>
        <span class="studio__transcript-badge studio__transcript-badge--timeout" data-transcript-timeout-badge hidden>Timed out</span>
        <span class="studio__transcript-badge studio__transcript-badge--saved" data-transcript-saved-badge hidden>Ready</span>
      </div>
      <p class="studio__transcript-hint popup__field-desc">
        Review what Vosk produced. Open the editor to fix wording or timing before baking.
      </p>
      <div class="studio__transcript-preview" data-transcript-preview>
        <p class="studio__transcript-empty">No transcript yet — record on Reddit first.</p>
      </div>
      <div class="popup__profile-actions studio__inline-actions studio__transcript-actions">
        <button type="button" class="popup__profile-btn popup__profile-btn--save" data-transcript-edit-open>
          Edit transcript
        </button>
        <button
          type="button"
          class="popup__profile-btn popup__profile-btn--save"
          data-transcript-save
          hidden
        >
          Confirm &amp; save
        </button>
        <button
          type="button"
          class="popup__profile-btn popup__profile-btn--delete"
          data-transcript-discard
          hidden
        >
          Discard edits
        </button>
      </div>
      <div class="studio__transcript-modal" data-transcript-modal hidden>
        <div class="studio__transcript-dialog" role="dialog" aria-labelledby="transcript-editor-title">
          <header class="studio__transcript-dialog-header">
            <h3 class="studio__transcript-dialog-title" id="transcript-editor-title">Edit transcript</h3>
            <button type="button" class="studio__transcript-close" data-transcript-edit-close aria-label="Close editor">
              ×
            </button>
          </header>
          <p class="studio__transcript-dialog-copy popup__field-desc">
            Adjust each cue’s text and timing. Confirm &amp; save in the main panel when you are done.
          </p>
          <div class="studio__transcript-segments" data-transcript-segments></div>
          <button
            type="button"
            class="studio__transcript-add-segment"
            data-transcript-add-segment
            aria-label="Add cue"
          >
            + Add cue
          </button>
          <div class="studio__bake-unsaved studio__transcript-modal-unsaved" data-transcript-modal-unsaved hidden>
            <p class="popup__field-desc studio__bake-unsaved-copy">
              You have unsaved cue edits. Apply them to the preview, discard, or keep editing.
            </p>
            <div class="popup__profile-actions studio__inline-actions">
              <button
                type="button"
                class="popup__profile-btn popup__profile-btn--save"
                data-transcript-modal-unsaved-apply
              >
                Apply to preview
              </button>
              <button
                type="button"
                class="popup__profile-btn popup__profile-btn--delete"
                data-transcript-modal-unsaved-discard
              >
                Discard
              </button>
              <button
                type="button"
                class="popup__button popup__button--secondary"
                data-transcript-modal-unsaved-cancel
              >
                Keep editing
              </button>
            </div>
          </div>
          <div class="studio__transcript-dialog-actions" data-transcript-modal-actions>
            <button type="button" class="popup__profile-btn popup__profile-btn--save" data-transcript-modal-save>
              Apply to preview
            </button>
            <button type="button" class="popup__button popup__button--secondary" data-transcript-modal-cancel>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function mountSubtitleSegmentEditor(
  root: HTMLElement,
  handlers?: SegmentEditorHandlers,
): SegmentEditorHandle {
  const panel = root.querySelector<HTMLElement>('[data-transcript-editor]')!;
  const previewEl = panel.querySelector<HTMLElement>('[data-transcript-preview]')!;
  const dirtyBadge = panel.querySelector<HTMLElement>('[data-transcript-dirty-badge]')!;
  const pendingBadge = panel.querySelector<HTMLElement>('[data-transcript-pending-badge]')!;
  const timeoutBadge = panel.querySelector<HTMLElement>('[data-transcript-timeout-badge]')!;
  const savedBadge = panel.querySelector<HTMLElement>('[data-transcript-saved-badge]')!;
  const editOpenBtn = panel.querySelector<HTMLButtonElement>('[data-transcript-edit-open]')!;
  const saveBtn = panel.querySelector<HTMLButtonElement>('[data-transcript-save]')!;
  const discardBtn = panel.querySelector<HTMLButtonElement>('[data-transcript-discard]')!;
  const modalEl = panel.querySelector<HTMLElement>('[data-transcript-modal]')!;
  const segmentsEl = panel.querySelector<HTMLElement>('[data-transcript-segments]')!;
  const modalSaveBtn = panel.querySelector<HTMLButtonElement>('[data-transcript-modal-save]')!;
  const modalCancelBtn = panel.querySelector<HTMLButtonElement>('[data-transcript-modal-cancel]')!;
  const modalCloseBtn = panel.querySelector<HTMLButtonElement>('[data-transcript-edit-close]')!;
  const modalActionsEl = panel.querySelector<HTMLElement>('[data-transcript-modal-actions]')!;
  const modalUnsavedEl = panel.querySelector<HTMLElement>('[data-transcript-modal-unsaved]')!;
  const modalUnsavedApplyBtn = panel.querySelector<HTMLButtonElement>(
    '[data-transcript-modal-unsaved-apply]',
  )!;
  const modalUnsavedDiscardBtn = panel.querySelector<HTMLButtonElement>(
    '[data-transcript-modal-unsaved-discard]',
  )!;
  const modalUnsavedCancelBtn = panel.querySelector<HTMLButtonElement>(
    '[data-transcript-modal-unsaved-cancel]',
  )!;
  const addSegmentBtn = panel.querySelector<HTMLButtonElement>('[data-transcript-add-segment]')!;

  let voskOriginal: TranscriptResult | null = null;
  let savedBaseline: TranscriptResult | null = null;
  let edited: TranscriptResult | null = null;
  let modalDraft: TranscriptSegment[] = [];
  /** Snapshot when the modal opens — close/dismiss compares live DOM against this. */
  let modalOpenBaseline: TranscriptSegment[] = [];
  let lastRecording: LastRecordingSnapshot | null = null;
  let loadedSavedAt = 0;
  let deliveryStatus: TranscriptDeliveryStatus = 'idle';
  let playingSegmentIndex: number | null = null;

  const cuePlayer = createSegmentCuePlayer();

  function computeDirty(): boolean {
    if (!edited || !savedBaseline) return false;
    return isTranscriptDirty(savedBaseline, edited);
  }

  function segmentsDraftEqual(a: TranscriptSegment[], b: TranscriptSegment[]): boolean {
    if (a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) {
      const left = a[index];
      const right = b[index];
      if (
        normalizeSegmentSeconds(left.start) !== normalizeSegmentSeconds(right.start) ||
        normalizeSegmentSeconds(left.end) !== normalizeSegmentSeconds(right.end) ||
        left.text !== right.text
      ) {
        return false;
      }
    }
    return true;
  }

  function isModalDirty(): boolean {
    if (modalEl.hidden) return false;
    return !segmentsDraftEqual(readModalDraft(), modalOpenBaseline);
  }

  function hideModalUnsavedPrompt(): void {
    modalUnsavedEl.hidden = true;
    modalActionsEl.hidden = false;
  }

  function showModalUnsavedPrompt(): void {
    modalUnsavedEl.hidden = false;
    modalActionsEl.hidden = true;
  }

  function requestCloseModal(): void {
    if (!isModalDirty()) {
      closeModal();
      return;
    }
    showModalUnsavedPrompt();
  }

  function clipDurationForOob(): number | null {
    return resolveClipDurationForOobCheck(
      lastRecording?.meta.durationSeconds,
      cuePlayer.getDecodedDuration(),
    );
  }

  function clipDurationForPlayback(): number | null {
    return resolveClipDurationSeconds(
      lastRecording?.meta.durationSeconds,
      cuePlayer.getDecodedDuration(),
    );
  }

  function notify(): void {
    const dirty = computeDirty();
    handlers?.onStateChange?.({
      voskOriginal,
      savedBaseline,
      edited,
      dirty,
      confirmed: !dirty && Boolean(edited),
    });
  }

  function renderPreview(): void {
    const segments = edited?.segments ?? [];
    const clipDuration = clipDurationForOob();

    if (!edited) {
      previewEl.innerHTML =
        '<p class="studio__transcript-empty">No transcript yet — record on Reddit first.</p>';
      editOpenBtn.disabled = true;
      return;
    }

    editOpenBtn.disabled = false;

    if (segments.length === 0) {
      previewEl.innerHTML =
        '<p class="studio__transcript-empty">No cues yet — open the editor to add one.</p>';
      return;
    }
    const lines = segments
      .map((segment) => {
        const time = formatCueRange(segment.start, segment.end);
        const text = escapeHtml(segment.text.trim() || '(empty)');
        const oob =
          clipDuration !== null && segmentHasOutOfBoundsEnd(segment, clipDuration)
            ? `<span class="studio__transcript-oob-badge" title="Cue end exceeds recording length">${OOB_LABEL}</span>`
            : '';
        return `
          <div class="studio__transcript-cue">
            <span class="studio__transcript-cue-time">${time}</span>
            <span class="studio__transcript-cue-text">${text}${oob}</span>
          </div>
        `;
      })
      .join('');

    previewEl.innerHTML = lines;
  }

  function syncActionButtons(): void {
    const dirty = computeDirty();
    const hasTranscript = Boolean(edited?.segments?.length);
    dirtyBadge.hidden = !dirty;
    pendingBadge.hidden = dirty || deliveryStatus !== 'pending';
    timeoutBadge.hidden = dirty || deliveryStatus !== 'timeout';
    savedBadge.hidden = dirty || deliveryStatus !== 'ready' || !hasTranscript;
    saveBtn.hidden = !dirty;
    discardBtn.hidden = !dirty;
  }

  function setTranscriptDeliveryStatus(status: TranscriptDeliveryStatus): void {
    deliveryStatus = status;
    syncActionButtons();
  }

  function readRowTiming(row: HTMLElement): { start: number; end: number } {
    const startInput = row.querySelector<HTMLInputElement>('[data-segment-start]');
    const endInput = row.querySelector<HTMLInputElement>('[data-segment-end]');
    return {
      start: normalizeSegmentSeconds(Number(startInput?.value ?? 0)),
      end: normalizeSegmentSeconds(Number(endInput?.value ?? 0)),
    };
  }

  function syncRowOobBadge(row: HTMLElement): void {
    const badge = row.querySelector<HTMLElement>('[data-segment-oob]');
    if (!badge) return;

    const clipDuration = clipDurationForOob();
    const { end } = readRowTiming(row);
    const show = clipDuration !== null && isSegmentEndOutOfBounds(end, clipDuration);
    badge.hidden = !show;
  }

  function syncPlayButtonState(row: HTMLElement, index: number): void {
    const playBtn = row.querySelector<HTMLButtonElement>('[data-segment-play]');
    if (!playBtn) return;

    const hasSource = cuePlayer.hasSource();
    const { start, end } = readRowTiming(row);
    const clipDuration = clipDurationForPlayback();
    const startPastClip =
      clipDuration !== null && start >= clipDuration - 0.05;
    const invalidRange = end <= start;

    playBtn.disabled = !hasSource || startPastClip || invalidRange;
    playBtn.setAttribute('aria-pressed', playingSegmentIndex === index ? 'true' : 'false');
    playBtn.textContent = playingSegmentIndex === index ? '■' : '▶';
  }

  function syncSegmentRowUi(row: HTMLElement, index: number): void {
    syncRowOobBadge(row);
    syncPlayButtonState(row, index);
  }

  function renderModalSegments(): void {
    segmentsEl.innerHTML = '';
    const clipDuration = clipDurationForOob();

    for (let index = 0; index < modalDraft.length; index += 1) {
      const segment = modalDraft[index];
      const showOob =
        clipDuration !== null && segmentHasOutOfBoundsEnd(segment, clipDuration);
      const row = document.createElement('div');
      row.className = 'studio__transcript-segment';
      row.dataset.segmentIndex = String(index);
      row.innerHTML = `
        <div class="studio__transcript-segment-head">
          <span class="studio__transcript-segment-label">Cue ${index + 1}</span>
          <span class="studio__transcript-segment-head-actions">
            <button
              type="button"
              class="studio__transcript-cue-play"
              data-segment-play
              aria-label="Play cue audio"
              ${cuePlayer.hasSource() ? '' : 'disabled'}
            >▶</button>
            <span
              class="studio__transcript-oob-badge"
              data-segment-oob
              title="Cue end exceeds recording length"
              ${showOob ? '' : 'hidden'}
            >${OOB_LABEL}</span>
          </span>
        </div>
        <div class="studio__transcript-segment-times">
          <label class="studio__transcript-time-field">
            <span>Start (s)</span>
            <input type="number" min="0" step="0.1" value="${segment.start}" data-segment-start />
          </label>
          <label class="studio__transcript-time-field">
            <span>End (s)</span>
            <input type="number" min="0" step="0.1" value="${segment.end}" data-segment-end />
          </label>
        </div>
        <label class="studio__transcript-segment-text-field">
          <span>Text</span>
          <textarea rows="2" data-segment-text></textarea>
        </label>
      `;
      const textArea = row.querySelector<HTMLTextAreaElement>('[data-segment-text]');
      if (textArea) textArea.value = segment.text;
      syncSegmentRowUi(row, index);
      segmentsEl.append(row);
    }
  }

  function refreshModalSegmentUi(): void {
    const rows = segmentsEl.querySelectorAll<HTMLElement>('[data-segment-index]');
    rows.forEach((row) => {
      const index = Number(row.dataset.segmentIndex);
      syncSegmentRowUi(row, Number.isFinite(index) ? index : -1);
    });
  }

  function readModalDraft(): TranscriptSegment[] {
    const rows = segmentsEl.querySelectorAll<HTMLElement>('[data-segment-index]');
    const next: TranscriptSegment[] = [];

    rows.forEach((row) => {
      const startInput = row.querySelector<HTMLInputElement>('[data-segment-start]');
      const endInput = row.querySelector<HTMLInputElement>('[data-segment-end]');
      const textInput = row.querySelector<HTMLTextAreaElement>('[data-segment-text]');
      if (!startInput || !endInput || !textInput) return;

      next.push({
        start: normalizeSegmentSeconds(Number(startInput.value)),
        end: normalizeSegmentSeconds(Number(endInput.value)),
        text: textInput.value,
      });
    });

    return next;
  }

  async function loadRecordingSource(): Promise<void> {
    const snapshot = await loadLastRecording();
    const savedAt = snapshot?.meta.savedAt ?? 0;
    if (snapshot && savedAt <= loadedSavedAt && lastRecording) {
      return;
    }

    if (cuePlayer.isPlaying()) {
      cuePlayer.stop();
      playingSegmentIndex = null;
      refreshModalSegmentUi();
    }

    lastRecording = snapshot;
    loadedSavedAt = savedAt;

    if (lastRecording) {
      try {
        await cuePlayer.setSource(lastRecording.blob);
      } catch (error) {
        console.warn('[Reddit Voice Notes] Could not load recording for cue preview', error);
      }
    } else {
      loadedSavedAt = 0;
      await cuePlayer.setSource(null);
    }

    renderPreview();
    if (!modalEl.hidden) {
      refreshModalSegmentUi();
    }
  }

  function syncModalDraftFromDom(): void {
    modalDraft = readModalDraft();
  }

  function addSegment(): void {
    syncModalDraftFromDom();
    const clipDuration =
      clipDurationForOob() ?? clipDurationForPlayback() ?? lastRecording?.meta.durationSeconds ?? null;
    modalDraft.push(buildDefaultNewSegment(modalDraft, clipDuration));
    renderModalSegments();
    const textAreas = segmentsEl.querySelectorAll<HTMLTextAreaElement>('[data-segment-text]');
    const lastText = textAreas[textAreas.length - 1];
    lastText?.focus();
    segmentsEl.scrollTop = segmentsEl.scrollHeight;
  }

  function openModal(): void {
    if (!edited) return;
    hideModalUnsavedPrompt();
    modalDraft = edited.segments.map((segment) => ({ ...segment }));
    modalOpenBaseline = modalDraft.map((segment) => ({ ...segment }));
    renderModalSegments();
    modalEl.hidden = false;
    void loadRecordingSource();
  }

  function closeModal(): void {
    hideModalUnsavedPrompt();
    cuePlayer.stop();
    playingSegmentIndex = null;
    modalEl.hidden = true;
    modalDraft = [];
    modalOpenBaseline = [];
  }

  function applyModalDraft(): void {
    if (!edited) return;
    const segments = readModalDraft();
    edited = normalizeEditedTranscriptResult(edited, segments);
    renderPreview();
    syncActionButtons();
    notify();
    closeModal();
  }

  async function playSegmentAtIndex(index: number, row: HTMLElement): Promise<void> {
    if (cuePlayer.isPlaying() && playingSegmentIndex === index) {
      cuePlayer.stop();
      playingSegmentIndex = null;
      refreshModalSegmentUi();
      return;
    }

    if (!cuePlayer.hasSource()) return;

    const { start, end } = readRowTiming(row);
    const clipDuration = clipDurationForPlayback();

    cuePlayer.stop();
    playingSegmentIndex = index;
    refreshModalSegmentUi();

    try {
      await cuePlayer.playSegment(start, end, clipDuration);
    } catch (error) {
      console.warn('[Reddit Voice Notes] Cue preview failed', error);
    } finally {
      if (!cuePlayer.isPlaying()) {
        playingSegmentIndex = null;
        refreshModalSegmentUi();
      }
    }
  }

  segmentsEl.addEventListener('input', (event) => {
    const target = event.target as HTMLElement;
    if (!target.matches('[data-segment-start], [data-segment-end]')) return;
    const row = target.closest<HTMLElement>('[data-segment-index]');
    if (!row) return;
    const index = Number(row.dataset.segmentIndex);
    syncSegmentRowUi(row, Number.isFinite(index) ? index : -1);
  });

  segmentsEl.addEventListener('click', (event) => {
    const playBtn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-segment-play]');
    if (!playBtn || playBtn.disabled) return;
    const row = playBtn.closest<HTMLElement>('[data-segment-index]');
    if (!row) return;
    const index = Number(row.dataset.segmentIndex);
    if (!Number.isFinite(index)) return;
    void playSegmentAtIndex(index, row);
  });

  editOpenBtn.addEventListener('click', openModal);
  addSegmentBtn.addEventListener('click', addSegment);
  modalCloseBtn.addEventListener('click', requestCloseModal);
  modalCancelBtn.addEventListener('click', requestCloseModal);
  modalSaveBtn.addEventListener('click', applyModalDraft);
  modalUnsavedApplyBtn.addEventListener('click', applyModalDraft);
  modalUnsavedDiscardBtn.addEventListener('click', closeModal);
  modalUnsavedCancelBtn.addEventListener('click', hideModalUnsavedPrompt);

  modalEl.addEventListener('click', (event) => {
    if (event.target !== modalEl) return;
    if (!modalUnsavedEl.hidden) {
      hideModalUnsavedPrompt();
      return;
    }
    requestCloseModal();
  });

  const onModalKeydown = (event: KeyboardEvent): void => {
    if (modalEl.hidden || event.key !== 'Escape') return;
    event.preventDefault();
    if (!modalUnsavedEl.hidden) {
      hideModalUnsavedPrompt();
      return;
    }
    requestCloseModal();
  };
  document.addEventListener('keydown', onModalKeydown);

  saveBtn.addEventListener('click', () => {
    if (!edited || !computeDirty()) return;
    saveBtn.disabled = true;
    void Promise.resolve(handlers?.onSaveEdits?.(cloneTranscriptResult(edited)))
      .then(() => {
        markConfirmedSaved();
      })
      .catch((error: unknown) => {
        console.warn('[Reddit Voice Notes] Transcript confirm save failed', error);
      })
      .finally(() => {
        saveBtn.disabled = false;
      });
  });

  discardBtn.addEventListener('click', () => {
    void Promise.resolve(handlers?.onDiscardEdits?.()).then(() => {
      if (!voskOriginal) {
        edited = null;
        savedBaseline = null;
      } else {
        edited = cloneTranscriptResult(voskOriginal);
        savedBaseline = cloneTranscriptResult(voskOriginal);
      }
      renderPreview();
      syncActionButtons();
      notify();
    });
  });

  function markConfirmedSaved(): void {
    if (!edited) return;
    savedBaseline = cloneTranscriptResult(edited);
    syncActionButtons();
    notify();
  }

  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') {
      void loadRecordingSource();
    }
  };

  document.addEventListener('visibilitychange', onVisibility);

  const pollTimer = window.setInterval(() => {
    void loadRecordingSource();
  }, RECORDING_POLL_MS);

  const onRecordingReady = (changes: Record<string, unknown>, area: string): void => {
    if (area !== 'local' || !(LAST_RECORDING_READY_KEY in changes)) return;
    void loadRecordingSource();
  };
  browser.storage.onChanged.addListener(onRecordingReady);

  void loadRecordingSource();

  const playPoll = window.setInterval(() => {
    if (!cuePlayer.isPlaying() && playingSegmentIndex !== null) {
      playingSegmentIndex = null;
      if (!modalEl.hidden) refreshModalSegmentUi();
    }
  }, 200);

  return {
    dispose(): void {
      closeModal();
      document.removeEventListener('keydown', onModalKeydown);
      document.removeEventListener('visibilitychange', onVisibility);
      browser.storage.onChanged.removeListener(onRecordingReady);
      window.clearInterval(pollTimer);
      window.clearInterval(playPoll);
      cuePlayer.dispose();
    },
    getState(): SegmentEditorState {
      const dirty = computeDirty();
      return {
        voskOriginal,
        savedBaseline,
        edited,
        dirty,
        confirmed: !dirty && Boolean(edited),
      };
    },
    setTranscript(
      nextVosk: TranscriptResult | null,
      nextEdited?: TranscriptResult | null,
      options?: { savedBaseline?: TranscriptResult | null },
    ): void {
      voskOriginal = nextVosk ? cloneTranscriptResult(nextVosk) : null;
      edited = nextEdited
        ? cloneTranscriptResult(nextEdited)
        : voskOriginal
          ? cloneTranscriptResult(voskOriginal)
          : null;
      savedBaseline = options?.savedBaseline
        ? cloneTranscriptResult(options.savedBaseline)
        : edited
          ? cloneTranscriptResult(edited)
          : null;
      renderPreview();
      syncActionButtons();
      notify();
    },
    getEditedResult(): TranscriptResult | null {
      return edited ? cloneTranscriptResult(edited) : null;
    },
    markConfirmedSaved,
    setTranscriptDeliveryStatus,
  };
}