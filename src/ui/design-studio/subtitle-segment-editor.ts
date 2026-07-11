import { createSegmentCuePlayer } from '@/src/transcription/segment-cue-player';
import {
  buildDefaultNewSegment,
  buildScaffoldTranscriptResult,
  cueTextIsBlank,
  formatCueRange,
  isTranscriptDirty,
  cloneTranscriptResult,
  normalizeEditedTranscriptResult,
  SCAFFOLD_SOFT_HYPHEN,
  splitSegmentIntoChunks,
  stripScaffoldPlaceholder,
} from '@/src/transcription/transcript-editing';
import {
  isSegmentEndOutOfBounds,
  normalizeSegmentSeconds,
  resolveClipDurationForOobCheck,
  resolveClipDurationSeconds,
  segmentHasOutOfBoundsEnd,
} from '@/src/transcription/segment-timing';
import {
  DEFAULT_SUBTITLE_STYLE,
  type SubtitleStyleConfig,
  type TranscriptResult,
  type TranscriptSegment,
} from '@/src/transcription/types';
import {
  buildReSpliceProposal,
  collectMinimalFixProposals,
  findOverflowingCueIndices,
  type SmartAdjustProposal,
} from '@/src/transcription/smart-adjust';
import {
  buildCaptionMetricsContext,
  CAPTION_FIT_DEBOUNCE_MS,
  evaluateCueBakeFitHeuristic,
  formatFitStatusLabel,
  resolveCueFit,
  type CaptionMetricsContext,
  type CueFitEvaluation,
} from '@/src/transcription/subtitle-caption-fit';
import { countManuallyEditedCues } from '@/src/transcription/transcript-edit-diff';
import {
  createTextMeasurer,
  groupWordsByWidth,
  PREVIEW_FONT_WEIGHT,
  type MeasureWidth,
} from '@/src/utils/text-metrics';
import { mountSmartAdjustModal } from '@/src/ui/design-studio/smart-adjust-modal';
import {
  clearTrimIntent,
  loadTrimIntent,
  planTrim,
  storeTrimIntent,
} from '@/src/editing/trim';
import { applyTrimToCurrentTake } from '@/src/editing/trim-apply';
import type { TrimRange } from '@/src/timeline/timeline';
import {
  mountSubtitleTimelineEditor,
  renderSubtitleTimelineEditorShell,
  TIMELINE_DEFAULT_FPS,
  type CueSuggestionState,
  type TimelineEditorHandle,
} from '@/src/ui/design-studio/subtitle-timeline-editor';
import { PREVIEW_FAMILY_FOR_KEY } from '@/src/ui/design-studio/preview-font-loader';
import { STUDIO_V4_ASSETS, studioV4AssetUrl } from '@/src/ui/design-studio/studio-v4-assets';
import { LAST_RECORDING_READY_KEY } from '@/src/settings/user-preferences';
import {
  getTakeManager,
  resolveTakeClipDurationSeconds,
  type CurrentTake,
} from '@/src/session/take-manager';
import {
  loadSegmentEditorAudioSource,
  segmentEditorAudioSourceCacheKey,
  type SegmentEditorAudioSource,
} from '@/src/transcription/segment-editor-clip-source';

export interface SegmentEditorState {
  /** Immutable Vosk output — discard restores this. */
  voskOriginal: TranscriptResult | null;
  /** Last confirmed save — dirty compares edited against this. */
  savedBaseline: TranscriptResult | null;
  edited: TranscriptResult | null;
  dirty: boolean;
  confirmed: boolean;
}

// CHANGED: added 'failed' | 'no-speech' | 'scaffolded' (v5.3 subtitle QoL)
// WHY: graceful Vosk failure needs explicit terminal states so the editor/status
//      strip can short-circuit the pending timer and surface scaffolding.
// Sync: studio-status-strip.ts (status→icon/label map) and subtitle-controls.ts
//       (refresh/load logic) must handle these same three members.
export type TranscriptDeliveryStatus =
  | 'idle'
  | 'pending'
  | 'ready'
  | 'timeout'
  | 'failed'
  | 'no-speech'
  | 'scaffolded';

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
  getTranscriptDeliveryStatus(): TranscriptDeliveryStatus;
  /** Re-run canvas validate when subtitle style changes (e.g. font size slider). */
  onSubtitleStyleChanged(): void;
}

export interface SegmentEditorHandlers {
  onStateChange?: (state: SegmentEditorState) => void;
  onSaveEdits?: (edited: TranscriptResult) => void | Promise<void>;
  onDiscardEdits?: () => void | Promise<void>;
  /**
   * Live subtitle style accessor (Phase 6). Smart Split + the overflow badge
   * measure cue text against the same font the preview uses, so the fit estimate
   * is WYSIWYG. Optional — falls back to the default DejaVu-Sans 22px style.
   */
  getSubtitleStyle?: () => SubtitleStyleConfig;
  /** Called when Smart Adjust accepts a global font-size reduction proposal. */
  onApplyGlobalFontSize?: (fontSize: number) => void;
  getThemeBarColor?: () => string | undefined;
}

const RECORDING_POLL_MS = 2000;
const OOB_LABEL = '⚠ OOB';
const OVERFLOW_LABEL = '⚠ LONG';
const DEFAULT_CAPTION_FONT_SIZE = 22;
const DEFAULT_CAPTION_FONT_KEY = 'dejavu-sans';

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
        <span class="studio__transcript-badge studio__transcript-badge--scaffold" data-transcript-scaffold-badge hidden>Scaffold</span>
      </div>
      <p class="studio__transcript-hint popup__field-desc">
        Review what Vosk produced. Open the editor to fix wording or timing before baking.
      </p>
      <div class="studio__transcript-scaffold-banner" data-transcript-scaffold-banner hidden role="status">
        <strong>Scaffolding mode active</strong> — evenly timed slots are ready for your
        text. Type directly into each cue, then Confirm &amp; save. Empty slots are skipped
        when baking, so fill only the ones you need.
      </div>
      <div class="studio__transcript-preview" data-transcript-preview>
        <p class="studio__transcript-empty">No transcript yet — record on Reddit first.</p>
      </div>
      <div class="popup__profile-actions studio__inline-actions studio__transcript-actions">
        <button type="button" class="popup__profile-btn popup__profile-btn--save" data-transcript-edit-open>
          Edit transcript
        </button>
        <button
          type="button"
          class="popup__profile-btn"
          data-transcript-scaffold-generate
          title="Replace cues with evenly timed empty slots spanning the clip"
        >
          Generate scaffold
        </button>
        <button
          type="button"
          class="popup__profile-btn popup__profile-btn--amber"
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
          <p class="studio__transcript-dialog-copy popup__field-desc" style="margin-top:4px;opacity:0.65;">
            Keep each cue to 1–2 short phrases to avoid text overflow. Fit status uses real-canvas
            measurement when a cue is near the width limit — ⚠ LONG marks cues that will trail off
            screen; use ✂ Split or the highlighted <strong>Smart Adjust → Auto-fix</strong> button.
          </p>
          <div class="studio__transcript-modal-tools">
            <div class="studio__cue-view-toggle" role="group" aria-label="Editor view">
              <button
                type="button"
                class="studio__cue-view-btn studio__cue-view-btn--active"
                data-transcript-view="timeline"
                aria-pressed="true"
              >Timeline</button>
              <button
                type="button"
                class="studio__cue-view-btn"
                data-transcript-view="list"
                aria-pressed="false"
              >List</button>
            </div>
            <div class="studio__transcript-modal-tools-row">
              <button type="button" class="popup__profile-btn" data-transcript-validate-all>
                Validate all cues
              </button>
              <div class="studio__smart-adjust-tool">
                <button
                  type="button"
                  class="popup__profile-btn studio__smart-adjust-open"
                  data-transcript-smart-adjust
                  title="Open Smart Adjust for word-shift, font, or re-splice proposals"
                >
                  Smart Adjust…
                </button>
                <p
                  class="studio__smart-adjust-attention-hint popup__field-desc"
                  data-transcript-smart-adjust-hint
                  hidden
                >Auto-fix recommended</p>
              </div>
            </div>
            <span class="studio__transcript-validate-summary popup__field-desc" data-transcript-validate-summary hidden></span>
          </div>
          ${renderSubtitleTimelineEditorShell()}
          <div class="studio__transcript-list-view" data-transcript-list-view hidden>
            <div class="studio__transcript-segments" data-transcript-segments></div>
          </div>
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
            <div class="popup__profile-actions studio__inline-actions studio-v4__guard-actions">
              <button
                type="button"
                class="popup__button popup__button--secondary studio-v4__guard-cancel"
                data-transcript-modal-unsaved-cancel
              >
                Keep editing
              </button>
              <button
                type="button"
                class="popup__profile-btn popup__profile-btn--delete studio-v4__guard-discard"
                data-transcript-modal-unsaved-discard
              >
                Discard
              </button>
              <button
                type="button"
                class="popup__profile-btn popup__profile-btn--save studio-v4__guard-apply"
                data-transcript-modal-unsaved-apply
              >
                Apply to preview
              </button>
            </div>
          </div>
          <div class="studio__transcript-dialog-actions studio-v4__guard-actions" data-transcript-modal-actions>
            <button type="button" class="popup__button popup__button--secondary studio-v4__guard-cancel" data-transcript-modal-cancel>
              Cancel
            </button>
            <button type="button" class="popup__profile-btn popup__profile-btn--save studio-v4__guard-apply" data-transcript-modal-save>
              Apply to preview
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
  const scaffoldBadge = panel.querySelector<HTMLElement>('[data-transcript-scaffold-badge]')!;
  const scaffoldBanner = panel.querySelector<HTMLElement>('[data-transcript-scaffold-banner]')!;
  const editOpenBtn = panel.querySelector<HTMLButtonElement>('[data-transcript-edit-open]')!;
  const generateScaffoldBtn = panel.querySelector<HTMLButtonElement>(
    '[data-transcript-scaffold-generate]',
  )!;
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
  const validateAllBtn = panel.querySelector<HTMLButtonElement>('[data-transcript-validate-all]')!;
  const smartAdjustBtn = panel.querySelector<HTMLButtonElement>('[data-transcript-smart-adjust]')!;
  const smartAdjustHintEl = panel.querySelector<HTMLElement>('[data-transcript-smart-adjust-hint]')!;
  const validateSummaryEl = panel.querySelector<HTMLElement>('[data-transcript-validate-summary]')!;
  const timelineContainer = panel.querySelector<HTMLElement>('[data-transcript-timeline]')!;
  const listViewEl = panel.querySelector<HTMLElement>('[data-transcript-list-view]')!;
  const viewToggleBtns = Array.from(
    panel.querySelectorAll<HTMLButtonElement>('[data-transcript-view]'),
  );

  const smartAdjustModal = mountSmartAdjustModal(panel);

  let voskOriginal: TranscriptResult | null = null;
  let savedBaseline: TranscriptResult | null = null;
  let edited: TranscriptResult | null = null;
  let modalDraft: TranscriptSegment[] = [];
  /** Snapshot when the modal opens — close/dismiss compares live DOM against this. */
  let modalOpenBaseline: TranscriptSegment[] = [];
  let currentTake: CurrentTake | null = null;
  let audioSource: SegmentEditorAudioSource | null = null;
  let loadedSourceKey = '';
  let deliveryStatus: TranscriptDeliveryStatus = 'idle';
  let playingSegmentIndex: number | null = null;
  // CHANGED: v5.8.0 — timeline view is the primary surface; the list is a toggle.
  // WHY: spatial editing (drag/resize/scrub) with full semiotic parity, wired to
  //      the same modalDraft + dirty→partial-rebake pipeline as the list.
  let selectedSegmentIndex: number | null = null;
  // CHANGED: v5.8.0 Sprint 7 — multi-select extras (Ctrl-toggle / Shift-range).
  // selectedSegmentIndex stays the PRIMARY (drives the inspector); extras join
  // it for batch nudge/delete/zoom-to-selection. Cleared by structural edits.
  const selectedSegmentExtras = new Set<number>();
  let viewMode: 'timeline' | 'list' = 'timeline';
  // CHANGED: v5.8.0 Sprint 9 — session cache of the take's stored trim intent
  // (design §10). Loaded async on modal open; Save/Clear keep it in sync.
  let savedTrimIntent: TrimRange | null = null;

  const cuePlayer = createSegmentCuePlayer();
  // CHANGED: v5.3 — per-cue delete affordance (nav-chip + chevron-X asset).
  const cueDeleteIconUrl = studioV4AssetUrl(STUDIO_V4_ASSETS.icons.cueDeleteX16);

  // CHANGED: v5.8.0 — mount the timeline editor. It reads modalDraft + selection
  // via deps (never owns them); mutations still flow through the list helpers.
  const timelineHandle: TimelineEditorHandle = mountSubtitleTimelineEditor(panel, {
    getSegments: () => modalDraft,
    getSelectedIndex: () => selectedSegmentIndex,
    getSelectedIndices: () => {
      if (selectedSegmentIndex === null) return [];
      const all = new Set(selectedSegmentExtras);
      all.add(selectedSegmentIndex);
      return [...all].sort((a, b) => a - b);
    },
    // Same clip reference the OOB check uses, so OOB bars align with the clip-end marker.
    getClipDurationSeconds: () => clipDurationForOob(),
    // CHANGED: v5.8.0 Sprint 7 — multi-select: plain replaces, toggle = Ctrl-click,
    // range = Shift-click from the primary. Primary always drives the inspector.
    onSelect: (index, opts) => {
      if (index === null) {
        selectedSegmentIndex = null;
        selectedSegmentExtras.clear();
        return;
      }
      if (opts?.toggle) {
        if (index === selectedSegmentIndex) {
          const first = selectedSegmentExtras.values().next();
          selectedSegmentIndex = first.done ? null : first.value;
          if (!first.done) selectedSegmentExtras.delete(first.value);
        } else if (selectedSegmentExtras.has(index)) {
          selectedSegmentExtras.delete(index);
        } else if (selectedSegmentIndex === null) {
          selectedSegmentIndex = index;
        } else {
          selectedSegmentExtras.add(index);
        }
        return;
      }
      if (opts?.range && selectedSegmentIndex !== null) {
        selectedSegmentExtras.clear();
        const lo = Math.min(selectedSegmentIndex, index);
        const hi = Math.max(selectedSegmentIndex, index);
        for (let i = lo; i <= hi; i += 1) {
          if (i !== selectedSegmentIndex) selectedSegmentExtras.add(i);
        }
        return;
      }
      selectedSegmentIndex = index;
      selectedSegmentExtras.clear();
    },
    onRequestPlay: (index) => {
      void playTimelineCue(index);
    },
    onRequestStop: () => {
      cuePlayer.stop();
      playingSegmentIndex = null;
      timelineHandle.endPlaybackSweep();
      timelineHandle.render();
    },
    isPlayingIndex: (index) => playingSegmentIndex === index,
    hasAudio: () => cuePlayer.hasSource(),
    // CHANGED: v5.8.0 §16.5 — the waveform lane reads the SAME decoded buffer
    // the ▶ preview plays (no second decode; null in element-mode fallback).
    getDecodedAudioBuffer: () => cuePlayer.getDecodedBuffer(),
    getFps: () => TIMELINE_DEFAULT_FPS,
    onCommitTiming: (index, start, end) => {
      const segment = modalDraft[index];
      if (!segment) return;
      modalDraft[index] = { ...segment, start, end };
      invalidateCueSuggestions(); // timing moves OOB in/out of suggestion range
    },
    onCommitText: (index, text) => {
      const segment = modalDraft[index];
      if (!segment) return;
      // Mirror readModalDraft: a blank field persists as the scaffold soft-hyphen
      // so empty timed slots survive normalize (parity with the list editor).
      modalDraft[index] = { ...segment, text: cueTextIsBlank(text) ? SCAFFOLD_SOFT_HYPHEN : text };
      // CHANGED: v5.8.0 Sprint 7 — timeline text edits drive the same fit pipeline
      // as list rows (heuristic now, canvas after the debounce), parity rows 5–6.
      const stripped = stripScaffoldPlaceholder(modalDraft[index].text).trim();
      if (stripped) scheduleCueFitMeasureForDraft(index, stripped);
      else cueFitCache.delete(index);
      invalidateCueSuggestions();
    },
    isDirtyIndex: (index) => {
      const current = modalDraft[index];
      const baseline = modalOpenBaseline[index];
      if (!current || !baseline) return Boolean(current) !== Boolean(baseline);
      return (
        normalizeSegmentSeconds(current.start) !== normalizeSegmentSeconds(baseline.start) ||
        normalizeSegmentSeconds(current.end) !== normalizeSegmentSeconds(baseline.end) ||
        current.text !== baseline.text
      );
    },
    // CHANGED: v5.8.0 Sprint 7 — parity deps. Fit verdicts come from the SAME
    // cueFitCache/heuristic the list rows use; split shares the >1-chunk rule.
    getCueFitState: (index) => {
      const segment = modalDraft[index];
      if (!segment) return null;
      const text = stripScaffoldPlaceholder(segment.text).trim();
      if (!text) return null;
      const cached = cueFitCache.get(index);
      if (cached) {
        return {
          overflow: cached.overflows,
          label: `${formatFitStatusLabel(cached)} (${cached.source === 'canvas' ? 'canvas' : 'estimate'})`,
          tier: cached.fitStatus,
        };
      }
      const metrics = memoizedCaptionMetrics();
      return {
        overflow: evaluateCueBakeFitHeuristic(text, metrics, metrics.style).overflows,
        label: null,
        tier: null,
      };
    },
    canSplitIndex: (index) => {
      const segment = modalDraft[index];
      if (!segment) return false;
      const text = stripScaffoldPlaceholder(segment.text).trim();
      if (!text) return false;
      const metrics = memoizedCaptionMetrics();
      return groupWordsByWidth(text, metrics.splitBudget, metrics.measure).length > 1;
    },
    onRequestSplit: (index) => splitSegmentAtIndex(index),
    onRequestDelete: (indices) => deleteSegmentsAtIndices(indices),
    onRequestAddAt: (seconds) => addSegmentAt(seconds),
    onEditGestureStart: () => pushUndoSnapshot(),
    // CHANGED: v5.8.0 Sprint 8 — smart suggestions on bars (design §8): the
    // host derives them from the SAME pure detectors Smart Adjust uses.
    getCueSuggestion: (index) => currentCueSuggestions().get(index) ?? null,
    onApplyMinimalFix: (index) => {
      // Re-derive fresh — never apply a proposal built against a moved draft.
      const metrics = memoizedCaptionMetrics();
      const overflowing = findOverflowingIndicesFromDraft(metrics);
      const proposal = collectMinimalFixProposals(modalDraft, overflowing, metrics, metrics.fontSize)
        .find((candidate) => candidate.cueIndex === index && !candidate.isGlobal);
      if (!proposal) {
        // Stale affordance (text changed since the last paint) — resync bars.
        syncSuggestionBars();
        return false;
      }
      applySmartAdjustProposal(proposal); // snapshots, applies, re-validates
      return true;
    },
    onOpenSmartAdjust: (index) => openSmartAdjustMenu(index),
    // CHANGED: v5.8.0 Sprint 9 — trim intent (design §10): the component owns
    // marker view-state; persistence flows through the existing planTrim gate.
    getSavedTrimIntent: () => savedTrimIntent,
    onSaveTrimIntent: async (inSeconds, outSeconds) => {
      const duration = clipDurationForOob();
      if (duration === null) return { ok: false, error: 'No clip duration available.' };
      const plan = planTrim({ inSeconds, outSeconds }, duration, TIMELINE_DEFAULT_FPS);
      if (!plan.ok) return { ok: false, error: plan.error };
      try {
        await storeTrimIntent(plan.range);
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      savedTrimIntent = plan.range;
      return { ok: true, range: plan.range };
    },
    onClearTrimIntent: async () => {
      try {
        await clearTrimIntent();
      } catch {
        return; // storage write failed — keep the cache so Clear stays offered
      }
      savedTrimIntent = null;
    },
    // CHANGED: v5.9.0 — atomic trim apply (roadmap §4). The component owns the
    // confirm gesture; this owns the orchestrator call + the FULL post-apply
    // refresh: every in-memory transcript copy re-seeds from the persisted
    // outcome, the undo stack resets (§3H — old snapshots reference the
    // pre-trim timeline), and the clip source reloads off the fresh base stamp.
    onApplyTrim: async (inSeconds, outSeconds, onProgress) => {
      // Preview = apply: the ghost bars projected the LIVE draft, so the draft
      // is the edited source the shift consumes (unsaved edits ride along).
      captureActiveDraft();
      const draftEdited = draftAsEditedResult();
      try {
        const outcome = await applyTrimToCurrentTake({
          requested: { inSeconds, outSeconds },
          fps: TIMELINE_DEFAULT_FPS,
          editedResult: draftEdited,
          onProgress,
        });
        voskOriginal = outcome.shiftedOriginal
          ? cloneTranscriptResult(outcome.shiftedOriginal)
          : null;
        edited = outcome.shiftedEdited
          ? cloneTranscriptResult(outcome.shiftedEdited)
          : null;
        savedBaseline = edited ? cloneTranscriptResult(edited) : null;
        modalDraft = edited ? edited.segments.map((segment) => ({ ...segment })) : [];
        modalOpenBaseline = modalDraft.map((segment) => ({ ...segment }));
        selectedSegmentIndex = null;
        selectedSegmentExtras.clear();
        clearUndoHistory();
        savedTrimIntent = null; // the orchestrator cleared edits.trim
        clearCueFitCache();
        invalidateCueSuggestions();
        timelineHandle.resetView(); // fit zoom to the shorter clip
        renderModalSegments();
        renderPreview();
        syncActionButtons();
        notify();
        // Controls-side cache sync (lastSnapshot, delivery status, source
        // label). The store already holds these bytes — the re-save is
        // idempotent; a failure must not report the applied trim as failed.
        // Fire-and-forget: awaiting here would let a frame paint stale trim
        // veils before the component exits trim mode on our resolution.
        if (edited) {
          void Promise.resolve(handlers?.onSaveEdits?.(cloneTranscriptResult(edited))).catch(
            (error: unknown) => {
              console.warn('[Reddit Voice Notes] Post-trim controls sync failed', error);
            },
          );
        }
        void loadRecordingSource(); // fresh base stamp → trimmed audio + waveform
        return {
          ok: true,
          newDurationSeconds: outcome.newDurationSeconds,
          removedCueCount: outcome.removedCueCount,
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });

  interface CaptionMetrics extends CaptionMetricsContext {
    measure: MeasureWidth;
    style: SubtitleStyleConfig;
  }

  const cueFitCache = new Map<number, CueFitEvaluation>();
  const cueFitDebounceTimers = new Map<number, number>();
  let validateAllRunning = false;

  // CHANGED: v5.8.0 Sprint 8 — on-bar smart suggestions (design §8). Computed
  // lazily from the same detectors Smart Adjust uses; any draft/fit change
  // marks the map stale and the next read (bar render, dep call) recomputes.
  let cueSuggestions = new Map<number, CueSuggestionState>();
  let cueSuggestionsStale = true;

  // CHANGED: Phase 6 + Phase 1 — width measurer + two-tier real-canvas fit (v5.3.6 refactor).
  function buildCaptionMetrics(): CaptionMetrics {
    const style = handlers?.getSubtitleStyle?.() ?? DEFAULT_SUBTITLE_STYLE;
    const fontSize =
      typeof style.fontSize === 'number' && Number.isFinite(style.fontSize)
        ? style.fontSize
        : DEFAULT_CAPTION_FONT_SIZE;
    const fontFamily =
      PREVIEW_FAMILY_FOR_KEY[style.fontFamily ?? DEFAULT_CAPTION_FONT_KEY] ?? 'RVN-DejaVu-Sans';
    const measure = createTextMeasurer({ fontSize, fontFamily, fontWeight: PREVIEW_FONT_WEIGHT });
    const context = buildCaptionMetricsContext(style, measure);
    return { ...context, measure, style };
  }

  function resolveSubtitleStyle(): SubtitleStyleConfig {
    return handlers?.getSubtitleStyle?.() ?? DEFAULT_SUBTITLE_STYLE;
  }

  // CHANGED: v5.8.0 Sprint 7 — short-TTL metrics memo. The timeline's per-bar
  // fit/split deps would otherwise build a fresh canvas measurer per bar per
  // render; 300 ms staleness is invisible (style changes re-render anyway).
  let metricsMemoValue: CaptionMetrics | null = null;
  let metricsMemoAt = 0;
  function memoizedCaptionMetrics(): CaptionMetrics {
    const now = Date.now();
    if (!metricsMemoValue || now - metricsMemoAt > 300) {
      metricsMemoValue = buildCaptionMetrics();
      metricsMemoAt = now;
    }
    return metricsMemoValue;
  }

  function clearCueFitCache(): void {
    cueFitCache.clear();
    cueFitDebounceTimers.forEach((timer) => window.clearTimeout(timer));
    cueFitDebounceTimers.clear();
    invalidateCueSuggestions(); // suggestions derive from the fit cache (§8)
  }

  function getCueOverflow(evaluation: CueFitEvaluation | undefined, text: string, metrics: CaptionMetrics): boolean {
    if (evaluation) return evaluation.overflows;
    return evaluateCueBakeFitHeuristic(text, metrics, metrics.style).overflows;
  }

  function countOverflowingCuesInModal(metrics: CaptionMetrics): number {
    let count = 0;
    const rows = segmentsEl.querySelectorAll<HTMLElement>('[data-segment-index]');
    rows.forEach((row) => {
      const index = Number(row.dataset.segmentIndex);
      if (!Number.isFinite(index)) return;
      const text = stripScaffoldPlaceholder(
        row.querySelector<HTMLTextAreaElement>('[data-segment-text]')?.value ?? '',
      );
      if (!text.trim()) return;
      if (getCueOverflow(cueFitCache.get(index), text, metrics)) count += 1;
    });
    return count;
  }

  // CHANGED: Phase 1 QA — amber affordance on Smart Adjust when ⚠ LONG cues present.
  function syncSmartAdjustAffordance(metrics: CaptionMetrics = buildCaptionMetrics()): void {
    if (modalEl.hidden) {
      smartAdjustBtn.classList.remove('studio__smart-adjust-open--attention');
      smartAdjustHintEl.hidden = true;
      return;
    }
    const overflowCount = countOverflowingCuesInModal(metrics);
    const needsAttention = overflowCount > 0;
    smartAdjustBtn.classList.toggle('studio__smart-adjust-open--attention', needsAttention);
    smartAdjustHintEl.hidden = !needsAttention;
    if (needsAttention) {
      smartAdjustBtn.title = `${overflowCount} cue(s) need fix — open Smart Adjust and use Auto-fix`;
    } else {
      smartAdjustBtn.title = 'Open Smart Adjust for word-shift, font, or re-splice proposals';
    }
  }

  function syncRowFitStatus(row: HTMLElement, evaluation: CueFitEvaluation | undefined): void {
    const statusEl = row.querySelector<HTMLElement>('[data-segment-fit-status]');
    if (!statusEl) return;
    if (!evaluation) {
      statusEl.textContent = '';
      statusEl.hidden = true;
      return;
    }
    statusEl.hidden = false;
    const source = evaluation.source === 'canvas' ? 'canvas' : 'estimate';
    statusEl.textContent = `${formatFitStatusLabel(evaluation)} (${source})`;
    statusEl.dataset.fitTier = evaluation.fitStatus;
  }

  function scheduleCueFitMeasure(row: HTMLElement, index: number, text: string, metrics: CaptionMetrics): void {
    const existing = cueFitDebounceTimers.get(index);
    if (existing !== undefined) window.clearTimeout(existing);

    const heuristic = evaluateCueBakeFitHeuristic(text, metrics, metrics.style);
    cueFitCache.set(index, heuristic);
    invalidateCueSuggestions();
    syncRowFitStatus(row, heuristic);
    syncRowOverflowUi(row, metrics, heuristic);
    syncSmartAdjustAffordance(metrics);

    const timer = window.setTimeout(() => {
      cueFitDebounceTimers.delete(index);
      void resolveCueFit(text, metrics.style, metrics, {
        forceCanvas: true,
        themeBarColor: handlers?.getThemeBarColor?.(),
      }).then((evaluation) => {
        if (modalEl.hidden) return;
        const liveRow = segmentsEl.querySelector<HTMLElement>(`[data-segment-index="${index}"]`);
        if (!liveRow) return;
        const liveText = stripScaffoldPlaceholder(
          liveRow.querySelector<HTMLTextAreaElement>('[data-segment-text]')?.value ?? '',
        );
        if (liveText.trim() !== text.trim()) return;
        cueFitCache.set(index, evaluation);
        invalidateCueSuggestions();
        syncRowFitStatus(liveRow, evaluation);
        syncRowOverflowUi(liveRow, metrics, evaluation);
        syncSmartAdjustAffordance(metrics);
      });
    }, CAPTION_FIT_DEBOUNCE_MS);

    cueFitDebounceTimers.set(index, timer);
  }

  // CHANGED: v5.8.0 Sprint 7 — index-based fit measure for TIMELINE text edits.
  // The row-bound scheduleCueFitMeasure validates its async result against the
  // live LIST row, which is stale while the timeline owns the draft. This
  // variant validates against modalDraft and pokes the timeline's TARGETED
  // refresh (never a full render — that would steal focus from the inspector
  // textarea mid-typing).
  // Sync: scheduleCueFitMeasure (list twin), subtitle-timeline-editor.ts refreshCueState
  function scheduleCueFitMeasureForDraft(index: number, text: string): void {
    const existing = cueFitDebounceTimers.get(index);
    if (existing !== undefined) window.clearTimeout(existing);

    const metrics = memoizedCaptionMetrics();
    cueFitCache.set(index, evaluateCueBakeFitHeuristic(text, metrics, metrics.style));
    invalidateCueSuggestions();

    const timer = window.setTimeout(() => {
      cueFitDebounceTimers.delete(index);
      void resolveCueFit(text, metrics.style, metrics, {
        forceCanvas: true,
        themeBarColor: handlers?.getThemeBarColor?.(),
      }).then((evaluation) => {
        if (modalEl.hidden) return;
        const liveText = stripScaffoldPlaceholder(modalDraft[index]?.text ?? '');
        if (liveText.trim() !== text.trim()) return; // text moved on — stale result
        cueFitCache.set(index, evaluation);
        // §8: a canvas verdict can add/remove a suggestion AND renumber the
        // global priority ranking — diff-refresh every bar whose state moved.
        invalidateCueSuggestions();
        syncSuggestionBars();
        timelineHandle.refreshCueState(index);
        syncSmartAdjustAffordance(metrics);
      });
    }, CAPTION_FIT_DEBOUNCE_MS);
    cueFitDebounceTimers.set(index, timer);
  }

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
    captureActiveDraft();
    return !segmentsDraftEqual(modalDraft, modalOpenBaseline);
  }

  // CHANGED: v5.8.0 Sprint 7 (§16.7) — modal-session undo/redo. Bounded
  // draft-snapshot stack; snapshots are pushed at DISCRETE GESTURE STARTS
  // (drag first-move, field focus, nudge burst, structural ops), not per
  // keystroke, so one undo reverts one user-perceived action. Cleared on
  // modal open/close; Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) while the modal is up.
  const UNDO_STACK_LIMIT = 50;
  let undoStack: TranscriptSegment[][] = [];
  let redoStack: TranscriptSegment[][] = [];

  function cloneDraftSegments(): TranscriptSegment[] {
    return modalDraft.map((segment) => ({ ...segment }));
  }

  function pushUndoSnapshot(): void {
    captureActiveDraft();
    const top = undoStack[undoStack.length - 1];
    if (top && segmentsDraftEqual(top, modalDraft)) return; // no-op since last snapshot
    undoStack.push(cloneDraftSegments());
    if (undoStack.length > UNDO_STACK_LIMIT) undoStack.shift();
    redoStack = [];
  }

  function restoreDraftFrom(source: TranscriptSegment[][], into: TranscriptSegment[][]): void {
    if (source.length === 0) return;
    captureActiveDraft();
    into.push(cloneDraftSegments());
    modalDraft = source.pop()!;
    selectedSegmentExtras.clear();
    if (selectedSegmentIndex !== null && selectedSegmentIndex >= modalDraft.length) {
      selectedSegmentIndex = null;
    }
    renderModalSegments();
  }

  function undoDraft(): void {
    restoreDraftFrom(undoStack, redoStack);
  }

  function redoDraft(): void {
    restoreDraftFrom(redoStack, undoStack);
  }

  function clearUndoHistory(): void {
    undoStack = [];
    redoStack = [];
  }

  function onUndoKeydown(event: KeyboardEvent): void {
    if (modalEl.hidden) return;
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      undoDraft();
    } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
      event.preventDefault();
      redoDraft();
    }
  }
  document.addEventListener('keydown', onUndoKeydown);

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

  function resolvedClipMetaDuration(): number | null {
    return (
      resolveTakeClipDurationSeconds(currentTake) ??
      (audioSource && audioSource.metaDurationSeconds > 0 ? audioSource.metaDurationSeconds : null)
    );
  }

  function clipDurationForOob(): number | null {
    return resolveClipDurationForOobCheck(
      resolvedClipMetaDuration(),
      cuePlayer.getDecodedDuration(),
    );
  }

  function clipDurationForPlayback(): number | null {
    return resolveClipDurationSeconds(
      resolvedClipMetaDuration(),
      cuePlayer.getDecodedDuration(),
    );
  }

  // CHANGED: manual "Generate scaffold" (v5.3 Phase 5) — broader QoL even when
  // transcription succeeded. Replaces the working cues with evenly timed empty
  // slots spanning the clip; the user confirms/saves like any other edit.
  function resolveScaffoldClipDuration(): number | null {
    return clipDurationForPlayback() ?? clipDurationForOob() ?? resolvedClipMetaDuration();
  }

  function generateScaffoldFromClip(): void {
    const duration = resolveScaffoldClipDuration();
    if (duration === null || duration <= 0) return;

    // Confirm before discarding real work (design §8: "with confirm").
    const hasRealCues = (edited?.segments ?? []).some((segment) => segment.text.trim().length > 0);
    if (
      (hasRealCues || computeDirty()) &&
      !window.confirm(
        'Replace the current cues with a fresh timecode scaffold? Unsaved edits will be lost.',
      )
    ) {
      return;
    }

    edited = buildScaffoldTranscriptResult(duration);
    deliveryStatus = 'scaffolded';
    renderPreview();
    syncActionButtons();
    notify();
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
    const metrics = buildCaptionMetrics();
    const lines = segments
      .map((segment, index) => {
        const time = formatCueRange(segment.start, segment.end);
        // CHANGED: scaffold soft-hyphen slots read as "(empty)" (v5.3 QA fix).
        const stripped = stripScaffoldPlaceholder(segment.text);
        const text = escapeHtml(stripped.trim() || '(empty)');
        const oob =
          clipDuration !== null && segmentHasOutOfBoundsEnd(segment, clipDuration)
            ? `<span class="studio__transcript-oob-badge" title="Cue end exceeds recording length">${OOB_LABEL}</span>`
            : '';
        // CHANGED: Phase 6 — flag cues too long for one line (burn-in trails off).
        const cached = cueFitCache.get(index);
        const overflow = getCueOverflow(cached, stripped, metrics)
          ? `<span class="studio__transcript-overflow-badge" title="Too long for one line — will trail off screen in the baked video. Open the editor and use Split.">${OVERFLOW_LABEL}</span>`
          : '';
        return `
          <div class="studio__transcript-cue">
            <span class="studio__transcript-cue-time">${time}</span>
            <span class="studio__transcript-cue-text">${text}${oob}${overflow}</span>
          </div>
        `;
      })
      .join('');

    previewEl.innerHTML = lines;
  }

  // CHANGED: scaffold mode = a graceful-failure / manual scaffold delivery state
  // (v5.3 Phase 4). Drives the banner, badge, empty-slot preservation, and focus.
  function inScaffoldMode(): boolean {
    return (
      deliveryStatus === 'no-speech' ||
      deliveryStatus === 'failed' ||
      deliveryStatus === 'scaffolded'
    );
  }

  function syncActionButtons(): void {
    const dirty = computeDirty();
    const hasTranscript = Boolean(edited?.segments?.length);
    const scaffold = inScaffoldMode();
    dirtyBadge.hidden = !dirty;
    pendingBadge.hidden = dirty || deliveryStatus !== 'pending';
    timeoutBadge.hidden = dirty || deliveryStatus !== 'timeout';
    savedBadge.hidden = dirty || deliveryStatus !== 'ready' || !hasTranscript;
    // Scaffold badge replaces the timed-out/ready badges while in scaffold mode;
    // the dirty "Unsaved" badge still wins once the user starts editing.
    scaffoldBadge.hidden = dirty || !scaffold;
    scaffoldBanner.hidden = !scaffold;
    saveBtn.hidden = !dirty;
    discardBtn.hidden = !dirty;
    // Manual scaffold needs a known clip length to span.
    generateScaffoldBtn.disabled = resolveScaffoldClipDuration() === null;
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

  // CHANGED: Phase 6 — reflect overflow + Split availability from the row's live
  // textarea text. A cue that won't fit one caption line shows ⚠ LONG; Split is
  // enabled only when the text actually breaks into >1 chunk (a single over-long
  // word can't be split without hyphenation, so Split stays disabled there).
  function syncRowOverflowUi(
    row: HTMLElement,
    metrics: CaptionMetrics,
    evaluation?: CueFitEvaluation,
  ): void {
    const textInput = row.querySelector<HTMLTextAreaElement>('[data-segment-text]');
    const text = stripScaffoldPlaceholder(textInput?.value ?? '');
    const overflow = getCueOverflow(evaluation ?? cueFitCache.get(Number(row.dataset.segmentIndex)), text, metrics);
    const canSplit = groupWordsByWidth(text, metrics.splitBudget, metrics.measure).length > 1;

    const badge = row.querySelector<HTMLElement>('[data-segment-overflow]');
    if (badge) badge.hidden = !overflow;
    const splitBtn = row.querySelector<HTMLButtonElement>('[data-segment-split]');
    if (splitBtn) splitBtn.disabled = !canSplit;
  }

  function syncSegmentRowUi(
    row: HTMLElement,
    index: number,
    metrics: CaptionMetrics = buildCaptionMetrics(),
  ): void {
    syncRowOobBadge(row);
    syncPlayButtonState(row, index);
    syncRowOverflowUi(row, metrics);
  }

  function draftAsEditedResult(): TranscriptResult | null {
    if (!edited) return null;
    return normalizeEditedTranscriptResult(edited, modalDraft, {
      keepEmptyTimedSegments: inScaffoldMode(),
    });
  }

  function findOverflowingIndicesFromDraft(metrics: CaptionMetrics): number[] {
    const indices: number[] = [];
    modalDraft.forEach((segment, index) => {
      const text = stripScaffoldPlaceholder(segment.text).trim();
      if (!text) return;
      const cached = cueFitCache.get(index);
      if (getCueOverflow(cached, text, metrics)) indices.push(index);
    });
    return indices;
  }

  // ── v5.8.0 Sprint 8 — smart suggestions for the timeline (design §8) ────────
  // Detection reuses the existing pure logic (no new generation): overflow via
  // the cache-aware draft scan, OOB via segmentHasOutOfBoundsEnd, one-click
  // fixes via collectMinimalFixProposals. Ranking: overflow a one-word shift
  // fixes ranks above fixes needing Smart Adjust; OOB ranks with LONG (§8).

  function invalidateCueSuggestions(): void {
    cueSuggestionsStale = true;
  }

  function computeCueSuggestions(): Map<number, CueSuggestionState> {
    const map = new Map<number, CueSuggestionState>();
    if (modalEl.hidden || modalDraft.length === 0) return map;
    const metrics = memoizedCaptionMetrics();
    const clip = clipDurationForOob();
    const overflowing = findOverflowingIndicesFromDraft(metrics);
    const overflowSet = new Set(overflowing);
    const fixFor = new Map<number, SmartAdjustProposal>();
    for (const proposal of collectMinimalFixProposals(modalDraft, overflowing, metrics, metrics.fontSize)) {
      if (typeof proposal.cueIndex === 'number' && !proposal.isGlobal && !fixFor.has(proposal.cueIndex)) {
        fixFor.set(proposal.cueIndex, proposal);
      }
    }
    interface Candidate {
      index: number;
      kind: 'overflow' | 'oob';
      fix: SmartAdjustProposal | undefined;
    }
    const candidates: Candidate[] = [];
    modalDraft.forEach((segment, index) => {
      // A cue can be both LONG and OOB — overflow leads (it has the fix path);
      // the ⚠ OOB pill still shows independently via the bar's --oob state.
      if (overflowSet.has(index)) {
        candidates.push({ index, kind: 'overflow', fix: fixFor.get(index) });
      } else if (clip !== null && segmentHasOutOfBoundsEnd(segment, clip)) {
        candidates.push({ index, kind: 'oob', fix: undefined });
      }
    });
    const ranked = [...candidates.filter((c) => c.fix), ...candidates.filter((c) => !c.fix)];
    ranked.forEach((candidate, rank) => {
      map.set(candidate.index, {
        kind: candidate.kind,
        priority: rank + 1,
        hasMinimalFix: Boolean(candidate.fix),
        title: candidate.fix
          ? candidate.fix.title
          : candidate.kind === 'oob'
            ? `Cue ${candidate.index + 1} ends past the clip — shorten or move it`
            : `Cue ${candidate.index + 1} overflows — try ✂ Split or Smart Adjust`,
      });
    });
    return map;
  }

  function currentCueSuggestions(): Map<number, CueSuggestionState> {
    // openModal renders BEFORE unhiding the dialog — never cache the empty
    // hidden-modal result or the first visible paint would miss its dots.
    if (modalEl.hidden) return new Map();
    if (cueSuggestionsStale) {
      cueSuggestions = computeCueSuggestions();
      cueSuggestionsStale = false;
    }
    return cueSuggestions;
  }

  /** Recompute suggestions and refresh only the bars whose state changed —
      priorities are a GLOBAL ranking, so fixing cue A can renumber cue B. */
  function syncSuggestionBars(): void {
    const prev = cueSuggestions;
    cueSuggestions = computeCueSuggestions();
    cueSuggestionsStale = false;
    const touched = new Set<number>([...prev.keys(), ...cueSuggestions.keys()]);
    for (const index of touched) {
      const before = prev.get(index);
      const after = cueSuggestions.get(index);
      if (
        before?.kind === after?.kind &&
        before?.priority === after?.priority &&
        before?.hasMinimalFix === after?.hasMinimalFix &&
        before?.title === after?.title
      ) {
        continue;
      }
      timelineHandle.refreshCueState(index);
    }
  }

  function renderModalSegments(): void {
    clearCueFitCache();
    segmentsEl.innerHTML = '';
    const clipDuration = clipDurationForOob();
    const metrics = buildCaptionMetrics();

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
            <button
              type="button"
              class="studio__transcript-cue-split"
              data-segment-split
              aria-label="Smart split this cue into shorter timed cues"
              title="Split this cue into shorter timed cues that each fit on screen"
            >✂ Split</button>
            <span
              class="studio__transcript-overflow-badge"
              data-segment-overflow
              title="Backdrop will clip on bake — use Split or Smart Adjust Auto-fix."
              hidden
            >${OVERFLOW_LABEL}</span>
            <span
              class="studio__transcript-oob-badge"
              data-segment-oob
              title="Cue end exceeds recording length"
              ${showOob ? '' : 'hidden'}
            >${OOB_LABEL}</span>
            <button
              type="button"
              class="studio__transcript-cue-delete"
              data-segment-delete
              aria-label="Delete this cue"
              title="Delete this cue"
            ><img src="${cueDeleteIconUrl}" alt="" width="16" height="16" /></button>
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
        <p class="studio__transcript-fit-status popup__field-desc" data-segment-fit-status hidden></p>
      `;
      const textArea = row.querySelector<HTMLTextAreaElement>('[data-segment-text]');
      // CHANGED: strip the soft-hyphen placeholder so the user types into a clean
      // textarea (not after an invisible char) — re-inserted on read if left blank.
      if (textArea) textArea.value = stripScaffoldPlaceholder(segment.text);
      syncSegmentRowUi(row, index, metrics);
      const text = stripScaffoldPlaceholder(segment.text);
      if (text.trim()) scheduleCueFitMeasure(row, index, text, metrics);
      segmentsEl.append(row);
    }
    syncSmartAdjustAffordance(metrics);
    // v5.8.0 — keep the timeline view in sync with any list re-render (it reads
    // modalDraft via deps; no-op/early-return when hidden or zero-width).
    timelineHandle.render();
  }

  function syncModalSegmentUiFromCache(): void {
    const metrics = buildCaptionMetrics();
    const rows = segmentsEl.querySelectorAll<HTMLElement>('[data-segment-index]');
    rows.forEach((row) => {
      const index = Number(row.dataset.segmentIndex);
      if (!Number.isFinite(index)) return;
      const evaluation = cueFitCache.get(index);
      syncRowOobBadge(row);
      syncPlayButtonState(row, index);
      syncRowFitStatus(row, evaluation);
      syncRowOverflowUi(row, metrics, evaluation);
    });
    // CHANGED: v5.8.0 Sprint 8 — Validate all paints onto the timeline too
    // (design §7 row 12): fresh canvas verdicts drive LONG tint + suggestion
    // dots on every bar, not just the list rows.
    invalidateCueSuggestions();
    syncSuggestionBars();
    for (let index = 0; index < modalDraft.length; index += 1) {
      timelineHandle.refreshCueState(index);
    }
    syncSmartAdjustAffordance(metrics);
  }

  function refreshModalSegmentUi(): void {
    const metrics = buildCaptionMetrics();
    const rows = segmentsEl.querySelectorAll<HTMLElement>('[data-segment-index]');
    rows.forEach((row) => {
      const index = Number(row.dataset.segmentIndex);
      if (!Number.isFinite(index)) return;
      syncSegmentRowUi(row, index, metrics);
      const text = stripScaffoldPlaceholder(
        row.querySelector<HTMLTextAreaElement>('[data-segment-text]')?.value ?? '',
      );
      if (text.trim()) scheduleCueFitMeasure(row, index, text, metrics);
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

      // CHANGED: re-insert the soft-hyphen placeholder for slots left blank, so
      // empty scaffold cues persist through normalize instead of being scrubbed
      // (v5.3 QA fix). Filled cues keep the user's text verbatim.
      const rawText = textInput.value;
      const text = cueTextIsBlank(rawText) ? SCAFFOLD_SOFT_HYPHEN : rawText;

      next.push({
        start: normalizeSegmentSeconds(Number(startInput.value)),
        end: normalizeSegmentSeconds(Number(endInput.value)),
        text,
      });
    });

    return next;
  }

  async function loadRecordingSource(): Promise<void> {
    const take = await getTakeManager().getCurrentTake();
    const source = await loadSegmentEditorAudioSource(take);
    const cacheKey = segmentEditorAudioSourceCacheKey(take, source);
    if (cacheKey === loadedSourceKey) {
      return;
    }

    if (cuePlayer.isPlaying()) {
      cuePlayer.stop();
      playingSegmentIndex = null;
      refreshModalSegmentUi();
    }

    currentTake = take;
    audioSource = source;
    loadedSourceKey = cacheKey;

    if (audioSource) {
      try {
        await cuePlayer.setSource(audioSource.blob);
      } catch (error) {
        console.warn('[Reddit Voice Notes] Could not load recording for cue preview', error);
        await cuePlayer.setSource(null);
      }
    } else {
      await cuePlayer.setSource(null);
    }

    renderPreview();
    if (!modalEl.hidden) {
      refreshModalSegmentUi();
      // CHANGED: v5.8.0 §16.5 — the decode just landed; repaint the timeline so
      // the waveform lane (and ▶ enablement) appear without a draft change.
      timelineHandle.render();
    }
  }

  function syncModalDraftFromDom(): void {
    modalDraft = readModalDraft();
  }

  // CHANGED: v5.8.0 — the ACTIVE view owns the draft. Capture from the list DOM
  // only when List is showing; in Timeline view modalDraft is already current
  // (drag/inspector edits write straight to it), so reading the stale list DOM
  // would clobber them. See design §3C / the two-view source-of-truth rule.
  function captureActiveDraft(): void {
    if (viewMode === 'list') syncModalDraftFromDom();
  }

  // CHANGED: v5.8.0 — swap between the timeline (primary) and list (secondary)
  // views. Both read the same modalDraft, so the switch is lossless: entering the
  // timeline first captures any in-flight list edits from the DOM.
  function applyViewMode(): void {
    const timelineActive = viewMode === 'timeline';
    // CHANGED: v5.8.0 Sprint 4 — stage mode (design §16.1): Timeline view expands
    // the dialog into a landscape stage (CSS width transition); List stays compact.
    modalEl.classList.toggle('studio__transcript-modal--stage', timelineActive);
    timelineContainer.hidden = !timelineActive;
    listViewEl.hidden = timelineActive;
    for (const btn of viewToggleBtns) {
      const active = btn.dataset.transcriptView === viewMode;
      btn.classList.toggle('studio__cue-view-btn--active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    if (timelineActive) {
      syncModalDraftFromDom();
      timelineHandle.render();
    } else {
      renderModalSegments();
    }
  }

  // CHANGED: v5.8.0 — timeline per-cue preview. Mirrors playSegmentAtIndex but
  // sources timing from modalDraft (no list row) and sweeps the timeline playhead
  // for the play window. The shared playPoll resets state when playback ends.
  async function playTimelineCue(index: number): Promise<void> {
    const segment = modalDraft[index];
    if (!segment || !cuePlayer.hasSource()) return;
    const clipDuration = clipDurationForPlayback();
    cuePlayer.stop();
    playingSegmentIndex = index;
    timelineHandle.render();
    const sweepEnd = clipDuration !== null ? Math.min(segment.end, clipDuration) : segment.end;
    timelineHandle.beginPlaybackSweep(segment.start, sweepEnd);
    try {
      await cuePlayer.playSegment(segment.start, segment.end, clipDuration);
    } catch (error) {
      console.warn('[Reddit Voice Notes] Timeline cue preview failed', error);
    } finally {
      if (!cuePlayer.isPlaying()) {
        playingSegmentIndex = null;
        timelineHandle.endPlaybackSweep();
        timelineHandle.render();
      }
    }
  }

  function addSegment(): void {
    pushUndoSnapshot(); // captures the active draft, then snapshots
    const clipDuration =
      clipDurationForOob() ?? clipDurationForPlayback() ?? resolvedClipMetaDuration();
    modalDraft.push(buildDefaultNewSegment(modalDraft, clipDuration));
    renderModalSegments();
    const textAreas = segmentsEl.querySelectorAll<HTMLTextAreaElement>('[data-segment-text]');
    const lastText = textAreas[textAreas.length - 1];
    lastText?.focus();
    segmentsEl.scrollTop = segmentsEl.scrollHeight;
  }

  // CHANGED: v5.8.0 Sprint 7 — add-at-playhead (parity row 10: "new bar at
  // playhead/end"). Inserts an empty timed slot AT the given time, kept in
  // start order; a 2 s duration clamped to the next neighbor (min 0.5 s).
  function addSegmentAt(seconds: number | null): void {
    pushUndoSnapshot();
    const clipDuration =
      clipDurationForOob() ?? clipDurationForPlayback() ?? resolvedClipMetaDuration();
    if (seconds === null || !Number.isFinite(seconds)) {
      modalDraft.push(buildDefaultNewSegment(modalDraft, clipDuration));
      selectedSegmentIndex = modalDraft.length - 1;
      selectedSegmentExtras.clear();
      renderModalSegments();
      return;
    }
    const start = normalizeSegmentSeconds(Math.max(0, seconds));
    let insertAt = modalDraft.length;
    for (let i = 0; i < modalDraft.length; i += 1) {
      if (modalDraft[i].start >= start) {
        insertAt = i;
        break;
      }
    }
    const nextStart = insertAt < modalDraft.length ? modalDraft[insertAt].start : null;
    const cap = nextStart ?? clipDuration ?? start + 2;
    // Prefer 2 s clamped to the neighbor; keep at least 0.5 s even if that
    // overlaps slightly (clamp policy governs gestures, not insertion).
    const end = normalizeSegmentSeconds(Math.max(start + 0.5, Math.min(start + 2, cap)));
    modalDraft = [
      ...modalDraft.slice(0, insertAt),
      { start, end, text: SCAFFOLD_SOFT_HYPHEN },
      ...modalDraft.slice(insertAt),
    ];
    selectedSegmentIndex = insertAt;
    selectedSegmentExtras.clear();
    renderModalSegments();
  }

  // CHANGED: Phase 6 — Smart Split. Break one long cue into shorter timed cues,
  // each fitting a single caption line, dividing time proportionally to text length
  // (transcript-editing.splitSegmentIntoChunks). Operates on the live DOM draft so
  // unsaved edits to the cue are respected before splitting.
  function splitSegmentAtIndex(index: number): void {
    captureActiveDraft();
    const segment = modalDraft[index];
    if (!segment) return;
    const text = stripScaffoldPlaceholder(segment.text).trim();
    if (!text) return;

    const { measure, splitBudget } = buildCaptionMetrics();
    const chunks = groupWordsByWidth(text, splitBudget, measure);
    if (chunks.length <= 1) return; // already fits, or a single un-splittable word

    pushUndoSnapshot(); // v5.8.0 Sprint 7 — one undo reverts the whole split
    const replacement = splitSegmentIntoChunks({ ...segment, text }, chunks);
    modalDraft = [
      ...modalDraft.slice(0, index),
      ...replacement,
      ...modalDraft.slice(index + 1),
    ];
    renderModalSegments();
  }

  // CHANGED: v5.3 — delete a cue from the working draft. Reverting is the modal's
  // Cancel/Discard (the deletion isn't committed until Apply to preview), so no
  // confirm prompt is needed. Operates on the live DOM draft to keep sibling edits.
  function deleteSegmentAtIndex(index: number): void {
    deleteSegmentsAtIndices([index]);
  }

  // CHANGED: v5.8.0 Sprint 7 — batch delete (multi-select Delete / inspector 🗑).
  function deleteSegmentsAtIndices(indices: number[]): void {
    captureActiveDraft();
    const valid = [...new Set(indices)]
      .filter((i) => Number.isFinite(i) && i >= 0 && i < modalDraft.length)
      .sort((a, b) => b - a); // descending so earlier indices stay stable
    if (valid.length === 0) return;
    pushUndoSnapshot();
    for (const index of valid) {
      modalDraft = [...modalDraft.slice(0, index), ...modalDraft.slice(index + 1)];
    }
    // Selection indices shift on delete — clear rather than point at the wrong cue.
    selectedSegmentIndex = null;
    selectedSegmentExtras.clear();
    renderModalSegments();
  }

  function openModal(): void {
    if (!edited) return;
    hideModalUnsavedPrompt();
    modalDraft = edited.segments.map((segment) => ({ ...segment }));
    modalOpenBaseline = modalDraft.map((segment) => ({ ...segment }));
    selectedSegmentIndex = null;
    selectedSegmentExtras.clear();
    clearUndoHistory(); // undo/redo is modal-session scoped (§16.7)
    // CHANGED: v5.8.0 Sprint 4 — a fresh session starts at fit zoom (no stale
    // window from the previous take carrying over).
    timelineHandle.resetView();
    renderModalSegments();
    modalEl.hidden = false;
    // Reveal the active view now the dialog has layout (track width is measurable).
    applyViewMode();
    // CHANGED: drop the caret into the first slot when scaffolding (v5.3 Phase 4)
    // so the user can start typing captions immediately.
    if (inScaffoldMode()) {
      segmentsEl.querySelector<HTMLTextAreaElement>('[data-segment-text]')?.focus();
    }
    void loadRecordingSource();
    // CHANGED: v5.8.0 Sprint 9 — pull any stored trim intent so the ✂ Trim
    // markers seed from it (they read the cache when the user toggles the mode).
    void loadTrimIntent().then((intent) => {
      savedTrimIntent = intent;
    });
  }

  function closeModal(): void {
    hideModalUnsavedPrompt();
    smartAdjustModal.close();
    cuePlayer.stop();
    playingSegmentIndex = null;
    selectedSegmentIndex = null;
    selectedSegmentExtras.clear();
    clearUndoHistory();
    timelineHandle.endPlaybackSweep();
    modalEl.hidden = true;
    modalDraft = [];
    modalOpenBaseline = [];
    clearCueFitCache();
    validateSummaryEl.hidden = true;
    validateSummaryEl.textContent = '';
    syncSmartAdjustAffordance();
  }

  function onSubtitleStyleChanged(): void {
    if (modalEl.hidden) return;
    clearCueFitCache();
    void validateAllCues(true);
  }

  async function validateAllCues(forceCanvas = true): Promise<void> {
    if (validateAllRunning || modalEl.hidden) return;
    validateAllRunning = true;
    validateAllBtn.disabled = true;
    smartAdjustBtn.disabled = true;
    validateSummaryEl.hidden = false;
    validateSummaryEl.textContent = 'Validating cues…';

    captureActiveDraft();
    const metrics = buildCaptionMetrics();
    let overflowCount = 0;
    let marginalCount = 0;
    let measured = 0;

    for (let index = 0; index < modalDraft.length; index += 1) {
      const text = stripScaffoldPlaceholder(modalDraft[index].text);
      if (!text.trim()) continue;
      measured += 1;
      const evaluation = await resolveCueFit(text, metrics.style, metrics, {
        forceCanvas,
        themeBarColor: handlers?.getThemeBarColor?.(),
      });
      cueFitCache.set(index, evaluation);
      if (evaluation.overflows) overflowCount += 1;
      else if (evaluation.fitStatus === 'marginal') marginalCount += 1;
    }

    syncModalSegmentUiFromCache();
    validateSummaryEl.textContent = `Validated ${measured} cue(s): ${overflowCount} need fix, ${marginalCount} near edge.`;
    validateAllRunning = false;
    validateAllBtn.disabled = false;
    smartAdjustBtn.disabled = false;
  }

  function applySmartAdjustProposal(proposal: SmartAdjustProposal): void {
    pushUndoSnapshot(); // captures the active draft, then snapshots (Sprint 7)
    modalDraft = proposal.segments.map((segment) => ({ ...segment }));
    selectedSegmentExtras.clear();
    if (proposal.isGlobal && typeof proposal.globalFontSize === 'number') {
      handlers?.onApplyGlobalFontSize?.(proposal.globalFontSize);
    }
    clearCueFitCache();
    renderModalSegments();
    void validateAllCues(true);
  }

  // CHANGED: v5.8.0 Sprint 8 — optional focus cue (design §8): opened from a
  // suggested bar, that cue's minimal fixes lead the list. The re-splice
  // entries stay on top — the recommended path stays recommended.
  function openSmartAdjustMenu(focusIndex: number | null = null): void {
    captureActiveDraft();
    const metrics = buildCaptionMetrics();
    const draftEdited = draftAsEditedResult();
    const overflowing =
      cueFitCache.size > 0
        ? findOverflowingIndicesFromDraft(metrics)
        : findOverflowingCueIndices(modalDraft, metrics);
    const manualCount =
      voskOriginal && draftEdited
        ? countManuallyEditedCues(draftEdited, voskOriginal)
        : 0;

    const minimal = collectMinimalFixProposals(
      modalDraft,
      overflowing,
      metrics,
      metrics.fontSize,
    );
    const reSplicePreserve =
      voskOriginal && draftEdited
        ? buildReSpliceProposal(voskOriginal, draftEdited, metrics, 'preserve')
        : null;
    const reSpliceFull =
      voskOriginal && draftEdited
        ? buildReSpliceProposal(voskOriginal, draftEdited, metrics, 'full')
        : null;

    const orderedMinimal =
      focusIndex === null
        ? minimal
        : [
            ...minimal.filter((proposal) => proposal.cueIndex === focusIndex),
            ...minimal.filter((proposal) => proposal.cueIndex !== focusIndex),
          ];

    const proposals = [
      ...(reSpliceFull ? [reSpliceFull] : []),
      ...(reSplicePreserve ? [reSplicePreserve] : []),
      ...orderedMinimal,
    ];

    smartAdjustModal.open({
      manualEditCount: manualCount,
      proposals,
      onApply: applySmartAdjustProposal,
    });
  }

  function applyModalDraft(): void {
    if (!edited) return;
    captureActiveDraft();
    const segments = modalDraft;
    // CHANGED: keep empty timed slots while in scaffold mode (v5.3 Phase 4) so the
    // template survives partial fills — empties still bake to nothing.
    edited = normalizeEditedTranscriptResult(edited, segments, {
      keepEmptyTimedSegments: inScaffoldMode(),
    });
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

  // CHANGED: v5.8.0 Sprint 7 — list-view edits snapshot for undo at field focus
  // (one snapshot per focus burst; pushUndoSnapshot dedupes unchanged drafts).
  segmentsEl.addEventListener('focusin', (event) => {
    const target = event.target as HTMLElement;
    if (target.matches('[data-segment-start], [data-segment-end], [data-segment-text]')) {
      pushUndoSnapshot();
    }
  });

  segmentsEl.addEventListener('input', (event) => {
    const target = event.target as HTMLElement;
    // CHANGED: Phase 6 + Phase 1 — text edits drive overflow badge, fit status, Split state.
    if (!target.matches('[data-segment-start], [data-segment-end], [data-segment-text]')) return;
    const row = target.closest<HTMLElement>('[data-segment-index]');
    if (!row) return;
    const index = Number(row.dataset.segmentIndex);
    if (!Number.isFinite(index)) return;
    const metrics = buildCaptionMetrics();
    if (target.matches('[data-segment-text]')) {
      const text = stripScaffoldPlaceholder(
        row.querySelector<HTMLTextAreaElement>('[data-segment-text]')?.value ?? '',
      );
      scheduleCueFitMeasure(row, index, text, metrics);
      return;
    }
    syncSegmentRowUi(row, index, metrics);
  });

  segmentsEl.addEventListener('click', (event) => {
    // CHANGED: v5.3 — per-cue delete.
    const deleteBtn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-segment-delete]');
    if (deleteBtn) {
      const deleteRow = deleteBtn.closest<HTMLElement>('[data-segment-index]');
      const deleteIndex = deleteRow ? Number(deleteRow.dataset.segmentIndex) : NaN;
      if (Number.isFinite(deleteIndex)) deleteSegmentAtIndex(deleteIndex);
      return;
    }

    // CHANGED: Phase 6 — Smart Split button takes precedence over the play button.
    const splitBtn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-segment-split]');
    if (splitBtn) {
      if (splitBtn.disabled) return;
      const splitRow = splitBtn.closest<HTMLElement>('[data-segment-index]');
      const splitIndex = splitRow ? Number(splitRow.dataset.segmentIndex) : NaN;
      if (Number.isFinite(splitIndex)) splitSegmentAtIndex(splitIndex);
      return;
    }

    const playBtn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-segment-play]');
    if (!playBtn || playBtn.disabled) return;
    const row = playBtn.closest<HTMLElement>('[data-segment-index]');
    if (!row) return;
    const index = Number(row.dataset.segmentIndex);
    if (!Number.isFinite(index)) return;
    void playSegmentAtIndex(index, row);
  });

  editOpenBtn.addEventListener('click', openModal);
  generateScaffoldBtn.addEventListener('click', generateScaffoldFromClip);
  addSegmentBtn.addEventListener('click', addSegment);
  validateAllBtn.addEventListener('click', () => {
    void validateAllCues(true);
  });
  // Wrapped so the MouseEvent never flows into the optional focusIndex param.
  smartAdjustBtn.addEventListener('click', () => openSmartAdjustMenu());
  for (const btn of viewToggleBtns) {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.transcriptView;
      if ((mode !== 'timeline' && mode !== 'list') || mode === viewMode) return;
      viewMode = mode;
      applyViewMode();
    });
  }
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

  const onStorageRefresh = (changes: Record<string, unknown>, area: string): void => {
    if (area !== 'local') return;
    if (LAST_RECORDING_READY_KEY in changes) {
      void loadRecordingSource();
    }
  };
  browser.storage.onChanged.addListener(onStorageRefresh);

  const unsubscribeTake = getTakeManager().subscribe(() => {
    void loadRecordingSource();
  });

  void loadRecordingSource();

  const playPoll = window.setInterval(() => {
    if (!cuePlayer.isPlaying() && playingSegmentIndex !== null) {
      playingSegmentIndex = null;
      timelineHandle.endPlaybackSweep();
      if (!modalEl.hidden) {
        refreshModalSegmentUi();
        timelineHandle.render();
      }
    }
  }, 200);

  return {
    dispose(): void {
      closeModal();
      smartAdjustModal.dispose();
      timelineHandle.dispose();
      document.removeEventListener('keydown', onModalKeydown);
      document.removeEventListener('keydown', onUndoKeydown);
      document.removeEventListener('visibilitychange', onVisibility);
      browser.storage.onChanged.removeListener(onStorageRefresh);
      unsubscribeTake();
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
    getTranscriptDeliveryStatus(): TranscriptDeliveryStatus {
      return deliveryStatus;
    },
    onSubtitleStyleChanged,
  };
}