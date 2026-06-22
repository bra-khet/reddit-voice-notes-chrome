import {
  cloneTranscriptResult,
  formatCueRange,
  isTranscriptDirty,
  normalizeEditedTranscriptResult,
} from '@/src/transcription/transcript-editing';
import type { TranscriptResult, TranscriptSegment } from '@/src/transcription/types';

export interface SegmentEditorState {
  /** Immutable Vosk output — discard restores this. */
  voskOriginal: TranscriptResult | null;
  /** Last confirmed save — dirty compares edited against this. */
  savedBaseline: TranscriptResult | null;
  edited: TranscriptResult | null;
  dirty: boolean;
  confirmed: boolean;
}

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
}

export interface SegmentEditorHandlers {
  onStateChange?: (state: SegmentEditorState) => void;
  onSaveEdits?: (edited: TranscriptResult) => void | Promise<void>;
  onDiscardEdits?: () => void | Promise<void>;
}

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
        <span class="studio__transcript-badge studio__transcript-badge--saved" data-transcript-saved-badge hidden>Saved</span>
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
          <div class="studio__transcript-dialog-actions">
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
  const savedBadge = panel.querySelector<HTMLElement>('[data-transcript-saved-badge]')!;
  const editOpenBtn = panel.querySelector<HTMLButtonElement>('[data-transcript-edit-open]')!;
  const saveBtn = panel.querySelector<HTMLButtonElement>('[data-transcript-save]')!;
  const discardBtn = panel.querySelector<HTMLButtonElement>('[data-transcript-discard]')!;
  const modalEl = panel.querySelector<HTMLElement>('[data-transcript-modal]')!;
  const segmentsEl = panel.querySelector<HTMLElement>('[data-transcript-segments]')!;
  const modalSaveBtn = panel.querySelector<HTMLButtonElement>('[data-transcript-modal-save]')!;
  const modalCancelBtn = panel.querySelector<HTMLButtonElement>('[data-transcript-modal-cancel]')!;
  const modalCloseBtn = panel.querySelector<HTMLButtonElement>('[data-transcript-edit-close]')!;

  let voskOriginal: TranscriptResult | null = null;
  let savedBaseline: TranscriptResult | null = null;
  let edited: TranscriptResult | null = null;
  let modalDraft: TranscriptSegment[] = [];

  function computeDirty(): boolean {
    if (!edited || !savedBaseline) return false;
    return isTranscriptDirty(savedBaseline, edited);
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
    if (!edited || segments.length === 0) {
      previewEl.innerHTML =
        '<p class="studio__transcript-empty">No transcript yet — record on Reddit first.</p>';
      editOpenBtn.disabled = true;
      return;
    }

    editOpenBtn.disabled = false;
    const lines = segments
      .map((segment) => {
        const time = formatCueRange(segment.start, segment.end);
        const text = escapeHtml(segment.text.trim() || '(empty)');
        return `
          <div class="studio__transcript-cue">
            <span class="studio__transcript-cue-time">${time}</span>
            <span class="studio__transcript-cue-text">${text}</span>
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
    savedBadge.hidden = dirty || !hasTranscript;
    saveBtn.hidden = !dirty;
    discardBtn.hidden = !dirty;
  }

  function renderModalSegments(): void {
    segmentsEl.innerHTML = '';
    for (let index = 0; index < modalDraft.length; index += 1) {
      const segment = modalDraft[index];
      const row = document.createElement('div');
      row.className = 'studio__transcript-segment';
      row.dataset.segmentIndex = String(index);
      row.innerHTML = `
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
          <span>Cue ${index + 1}</span>
          <textarea rows="2" data-segment-text></textarea>
        </label>
      `;
      const textArea = row.querySelector<HTMLTextAreaElement>('[data-segment-text]');
      if (textArea) textArea.value = segment.text;
      segmentsEl.append(row);
    }
  }

  function readModalDraft(): TranscriptSegment[] {
    const rows = segmentsEl.querySelectorAll<HTMLElement>('[data-segment-index]');
    const next: TranscriptSegment[] = [];

    rows.forEach((row) => {
      const startInput = row.querySelector<HTMLInputElement>('[data-segment-start]');
      const endInput = row.querySelector<HTMLInputElement>('[data-segment-end]');
      const textInput = row.querySelector<HTMLTextAreaElement>('[data-segment-text]');
      if (!startInput || !endInput || !textInput) return;

      const start = Number(startInput.value);
      const end = Number(endInput.value);
      next.push({
        start: Number.isFinite(start) ? start : 0,
        end: Number.isFinite(end) ? end : 0,
        text: textInput.value,
      });
    });

    return next;
  }

  function openModal(): void {
    if (!edited) return;
    modalDraft = edited.segments.map((segment) => ({ ...segment }));
    renderModalSegments();
    modalEl.hidden = false;
  }

  function closeModal(): void {
    modalEl.hidden = true;
    modalDraft = [];
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

  editOpenBtn.addEventListener('click', openModal);
  modalCloseBtn.addEventListener('click', closeModal);
  modalCancelBtn.addEventListener('click', closeModal);
  modalSaveBtn.addEventListener('click', applyModalDraft);

  modalEl.addEventListener('click', (event) => {
    if (event.target === modalEl) closeModal();
  });

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

  return {
    dispose(): void {
      closeModal();
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
  };
}