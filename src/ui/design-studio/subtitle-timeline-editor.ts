/**
 * v5.8.0 — Timeline visual subtitle editor (Sprint 4: stage layout + zoom).
 *
 * The spatial view of the cue draft: a time ruler, cue bars positioned by
 * start / sized by duration, a playhead, click-to-select, body-drag to move,
 * edge-handle resize, and a live two-way inspector (docked in the stage-mode
 * right rail). Timing is frame-snapped with magnetism (neighbor edge >
 * playhead > tick) and clamped so cues touch but never overlap. The host still
 * owns the draft: the component reads it via deps and writes edits back through
 * deps — it never mutates the array itself.
 *
 * Sprint 4 (design §16.1–16.2): ALL sec↔px mapping goes through a view window
 * (TimelineWindow) — log zoom 1×→minWindow cap, anchored Ctrl+wheel zoom,
 * wheel pan, Fit / zoom-to-selection / ± / slider cluster in a transport bar,
 * and a minimap lens (drag = pan, edge-drag = zoom). Because magnetism radii
 * are px-derived and converted through the window, snap precision scales with
 * zoom automatically.
 *
 * Sprint 6 (design §16.5): waveform lane — a DPR-aware canvas between ruler
 * and track painted from the cue player's decoded AudioBuffer via the pure
 * waveform-peaks leaf (pyramid at low zoom, exact range peaks at deep zoom).
 * Repaints ONLY when the view window, canvas size, or source changes; a bare
 * centerline is the element-mode (no decoded buffer) fallback.
 *
 * Sprint 7 (design §7 parity matrix + §16.7): ⚠ LONG / ⚠ OOB pills on bars +
 * live fit-status in the inspector (host's cueFitCache — no new measurement
 * logic), ✂ Split / 🗑 delete / add-at-playhead through host helpers, keyboard
 * (←/→ rove, ↑/↓ frame-nudge w/ hold-accelerate, Space play, Enter text,
 * Del delete; aria-live announcements), multi-select (Ctrl-click toggle,
 * Shift-click range; batch nudge/delete), and gesture-level undo snapshots
 * via deps.onEditGestureStart (host owns the modal-session undo/redo stack).
 *
 * Substrate: DOM + CSS transforms (design §3B). Geometry/constraints are the
 * pure timeline-geometry.ts; frame math is timeline.ts (preview=bake, I11).
 *
 * Sync: subtitle-segment-editor.ts (host: mounts, owns draft + selection),
 *       timeline-geometry.ts (layout/hit/snap/constrain/window), style.css
 */

import type { TranscriptSegment } from '@/src/transcription/types';
import { cueTextIsBlank, formatCueTimestamp, stripScaffoldPlaceholder } from '@/src/transcription/transcript-editing';
import { segmentHasOutOfBoundsEnd } from '@/src/transcription/segment-timing';
import {
  MIN_BAR_WIDTH_PX,
  clampWindow,
  constrainMove,
  constrainResizeEnd,
  constrainResizeStart,
  fitWindow,
  generateRulerTicksInWindow,
  layoutBarInWindow,
  layoutBarsInWindow,
  minWindowSeconds,
  minimapLens,
  minimapPxToSeconds,
  panWindow,
  resolveSnap,
  resolveSnapSticky,
  sliderToZoomFactor,
  windowDurationSeconds,
  windowForSpan,
  windowFromZoomFactor,
  windowPxDeltaToSeconds,
  windowPxToSeconds,
  windowSecondsToPx,
  windowZoomFactor,
  zoomFactorToSlider,
  zoomWindowAt,
  type CueEditContext,
  type StickySnapResolution,
  type StickySnapState,
  type TimelineWindow,
  type WindowViewport,
} from '@/src/ui/design-studio/timeline-geometry';
import {
  WAVEFORM_PYRAMID_PEAKS_PER_SECOND,
  computeRangePeaks,
  computeWaveformPyramid,
  resamplePeaks,
  type WaveformPeaks,
} from '@/src/ui/design-studio/waveform-peaks';

/** Fallback compositing fps (matches the overlay backbone). */
export const TIMELINE_DEFAULT_FPS = 24;

/** Neighbor-edge magnetism radius (px) — strongest, for clustering (design §6.2). */
const NEIGHBOR_MAGNET_PX = 12;
/** Playhead / tick magnetism radius (px) — softer than neighbor pull. */
const SOFT_MAGNET_PX = 8;
/** Movement under this (px) is a click (select), not a drag. */
const CLICK_SLOP_PX = 3;
/** Vertical stray beyond this (px) suspends the drag; it re-acquires on return (§6.1.1). */
const VERTICAL_TOLERANCE_PX = 90;
/** Bars narrower than this get outboard "ear" trim handles (§16.3). */
const EAR_THRESHOLD_PX = 44;
/** Extra pull (px) past the enter tolerance required to break an acquired snap (§16.4). */
const SNAP_RELEASE_EXTRA_PX = 6;
/** Dragging a bar within this distance of the track edge auto-pans the window. */
const AUTO_PAN_ZONE_PX = 28;
/** Fastest auto-pan speed (px of track per frame, scaled by zone depth). */
const AUTO_PAN_MAX_PX_PER_FRAME = 14;

type DragZone = 'start' | 'end' | 'body';

interface DragState {
  index: number;
  zone: DragZone;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  origStart: number;
  origEnd: number;
  origDuration: number;
  ctx: CueEditContext;
  moved: boolean;
  suspended: boolean;
  /** Magnet currently held by the hysteresis resolver (§16.4). */
  activeSnap: StickySnapState | null;
  /** Seconds the window auto-panned under the pointer — added to the px delta. */
  panAccumSeconds: number;
  lastClientX: number;
  lastShift: boolean;
}

export interface CueFitState {
  overflow: boolean;
  /** Human fit-status line ("Fits (canvas)" …) — null until an evaluation exists. */
  label: string | null;
  tier: string | null;
}

// CHANGED: v5.8.0 Sprint 8 — on-bar smart suggestions (design §8). The host
// computes these from the SAME pure detectors the Smart Adjust modal uses
// (findOverflowingIndicesFromDraft / segmentHasOutOfBoundsEnd /
// collectMinimalFixProposals); the timeline only paints and forwards clicks.
export interface CueSuggestionState {
  kind: 'overflow' | 'oob';
  /** 1-based rank across the draft — one-word-shift-fixable overflow ranks first. */
  priority: number;
  /** A one-click word-shift proposal exists for this cue. */
  hasMinimalFix: boolean;
  /** Human line for the dot tooltip + inspector callout (proposal title or hint). */
  title: string;
}

export interface TimelineEditorDeps {
  getSegments(): TranscriptSegment[];
  getSelectedIndex(): number | null;
  /** Full selection (primary + multi-select extras), ascending. */
  getSelectedIndices(): number[];
  getClipDurationSeconds(): number | null;
  getFps(): number;
  /** Plain select replaces; toggle = Ctrl-click; range = Shift-click from primary. */
  onSelect(index: number | null, opts?: { toggle?: boolean; range?: boolean }): void;
  onRequestPlay(index: number): void;
  onRequestStop(): void;
  isPlayingIndex(index: number): boolean;
  hasAudio(): boolean;
  /** Decoded clip audio for the waveform lane (null = element-mode fallback, §16.5). */
  getDecodedAudioBuffer(): AudioBuffer | null;
  /** Write a timing edit back to the host draft (host owns the array). */
  onCommitTiming(index: number, startSeconds: number, endSeconds: number): void;
  /** Write a text edit back to the host draft (host applies the blank→scaffold rule). */
  onCommitText(index: number, text: string): void;
  /** Has this cue changed since the editor opened? (drives the dirty bar state) */
  isDirtyIndex(index: number): boolean;
  /** Live fit verdict from the host's cueFitCache/heuristic (parity row 5–6). */
  getCueFitState(index: number): CueFitState | null;
  /** Split enablement rule — identical to the list (>1 width chunk). */
  canSplitIndex(index: number): boolean;
  onRequestSplit(index: number): void;
  /** Delete one or many cues (host resets selection + re-renders). */
  onRequestDelete(indices: number[]): void;
  /** Add a cue at a time (null = append at the end, list-button behavior). */
  onRequestAddAt(seconds: number | null): void;
  /** A discrete edit gesture is starting — host pushes an undo snapshot (§16.7). */
  onEditGestureStart(): void;
  /** Smart suggestion for a cue (design §8) — null when nothing needs attention. */
  getCueSuggestion(index: number): CueSuggestionState | null;
  /** One-click word-shift fix — host re-derives the proposal fresh, then applies.
      Returns false when the affordance was stale (draft moved) and nothing changed. */
  onApplyMinimalFix(index: number): boolean;
  /** Open the existing Smart Adjust modal, pre-contextualized to this cue. */
  onOpenSmartAdjust(index: number): void;
}

export interface TimelineEditorHandle {
  render(): void;
  setPlayheadSeconds(seconds: number | null): void;
  beginPlaybackSweep(startSeconds: number, endSeconds: number): void;
  endPlaybackSweep(): void;
  /** Reset zoom/pan to fit + clear the playhead (host calls on modal open). */
  resetView(): void;
  /** Refresh one cue's bar + inspector fit line in place (async fit results). */
  refreshCueState(index: number): void;
  dispose(): void;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function renderSubtitleTimelineEditorShell(): string {
  return `
    <div class="studio__cue-timeline" data-transcript-timeline hidden>
      <div class="studio__cue-timeline-main">
        <div class="studio__cue-timeline-lanes" data-timeline-lanes>
          <div class="studio__cue-timeline-ruler" data-timeline-ruler aria-hidden="true"></div>
          <div class="studio__cue-timeline-waveform-lane" data-timeline-waveform-lane aria-hidden="true">
            <canvas class="studio__cue-timeline-waveform" data-timeline-waveform></canvas>
            <div class="studio__cue-timeline-waveform-playhead" data-timeline-waveform-playhead hidden></div>
          </div>
          <div
            class="studio__cue-timeline-track"
            data-timeline-track
            role="listbox"
            aria-label="Subtitle cue timeline"
            tabindex="0"
          >
            <div class="studio__cue-timeline-playhead" data-timeline-playhead hidden></div>
            <div class="studio__cue-timeline-snap-guide" data-timeline-snap-guide hidden></div>
          </div>
          <div class="studio__cue-timeline-minimap" data-timeline-minimap aria-hidden="true" hidden>
            <div class="studio__cue-timeline-minimap-heat" data-timeline-minimap-heat></div>
            <div class="studio__cue-timeline-minimap-lens" data-timeline-lens></div>
          </div>
        </div>
        <div class="studio__cue-timeline-transport">
          <button
            type="button"
            class="studio__transcript-cue-play studio__cue-timeline-transport-play"
            data-timeline-transport-play
            aria-label="Play selected cue"
            disabled
          >▶</button>
          <span class="studio__cue-timeline-timecode" data-timeline-timecode>0:00.000</span>
          <span class="studio__cue-timeline-timecode-total" data-timeline-timecode-total></span>
          <button
            type="button"
            class="studio__cue-timeline-zoom-btn studio__cue-timeline-zoom-btn--wide"
            data-timeline-add
            title="Add a cue at the playhead (at the end when no playhead is set)"
            aria-label="Add a cue at the playhead"
          >+ Cue</button>
          <span class="studio__cue-timeline-transport-spacer"></span>
          <button
            type="button"
            class="studio__cue-timeline-zoom-btn studio__cue-timeline-zoom-btn--wide"
            data-timeline-zoom-fit
            title="Fit the whole clip"
            aria-label="Fit the whole clip"
            disabled
          >Fit</button>
          <button
            type="button"
            class="studio__cue-timeline-zoom-btn studio__cue-timeline-zoom-btn--wide"
            data-timeline-zoom-selection
            title="Zoom to the selected cue"
            aria-label="Zoom to the selected cue"
            disabled
          >Sel</button>
          <button
            type="button"
            class="studio__cue-timeline-zoom-btn"
            data-timeline-zoom-out
            title="Zoom out"
            aria-label="Zoom out"
            disabled
          >−</button>
          <input
            type="range"
            class="studio__cue-timeline-zoom-slider"
            data-timeline-zoom-slider
            min="0"
            max="1000"
            step="1"
            value="0"
            aria-label="Zoom level"
            disabled
          />
          <button
            type="button"
            class="studio__cue-timeline-zoom-btn"
            data-timeline-zoom-in
            title="Zoom in"
            aria-label="Zoom in"
            disabled
          >+</button>
          <span class="studio__cue-timeline-zoom-readout" data-timeline-zoom-readout>1.0×</span>
        </div>
      </div>
      <div class="studio__cue-timeline-rail">
        <p class="studio__cue-timeline-rail-hint popup__field-desc" data-timeline-rail-hint>
          Select a cue to edit its timing and text.
        </p>
        <div class="studio__cue-timeline-inspector" data-timeline-inspector hidden></div>
      </div>
      <p class="studio__cue-timeline-empty popup__field-desc" data-timeline-empty hidden>
        No cues yet — add one, or switch to List view.
      </p>
      <p class="studio__sr-only" data-timeline-live aria-live="polite"></p>
    </div>
  `;
}

export function mountSubtitleTimelineEditor(
  root: HTMLElement,
  deps: TimelineEditorDeps,
): TimelineEditorHandle {
  const container = root.querySelector<HTMLElement>('[data-transcript-timeline]')!;
  const lanesEl = container.querySelector<HTMLElement>('[data-timeline-lanes]')!;
  const rulerEl = container.querySelector<HTMLElement>('[data-timeline-ruler]')!;
  const trackEl = container.querySelector<HTMLElement>('[data-timeline-track]')!;
  const playheadEl = container.querySelector<HTMLElement>('[data-timeline-playhead]')!;
  const snapGuideEl = container.querySelector<HTMLElement>('[data-timeline-snap-guide]')!;
  const waveformLaneEl = container.querySelector<HTMLElement>('[data-timeline-waveform-lane]')!;
  const waveformCanvasEl = container.querySelector<HTMLCanvasElement>('[data-timeline-waveform]')!;
  const waveformPlayheadEl = container.querySelector<HTMLElement>('[data-timeline-waveform-playhead]')!;
  const minimapEl = container.querySelector<HTMLElement>('[data-timeline-minimap]')!;
  const minimapHeatEl = container.querySelector<HTMLElement>('[data-timeline-minimap-heat]')!;
  const lensEl = container.querySelector<HTMLElement>('[data-timeline-lens]')!;
  const inspectorEl = container.querySelector<HTMLElement>('[data-timeline-inspector]')!;
  const railHintEl = container.querySelector<HTMLElement>('[data-timeline-rail-hint]')!;
  const emptyEl = container.querySelector<HTMLElement>('[data-timeline-empty]')!;
  const transportPlayBtn = container.querySelector<HTMLButtonElement>('[data-timeline-transport-play]')!;
  const timecodeEl = container.querySelector<HTMLElement>('[data-timeline-timecode]')!;
  const timecodeTotalEl = container.querySelector<HTMLElement>('[data-timeline-timecode-total]')!;
  const zoomFitBtn = container.querySelector<HTMLButtonElement>('[data-timeline-zoom-fit]')!;
  const zoomSelBtn = container.querySelector<HTMLButtonElement>('[data-timeline-zoom-selection]')!;
  const zoomOutBtn = container.querySelector<HTMLButtonElement>('[data-timeline-zoom-out]')!;
  const zoomInBtn = container.querySelector<HTMLButtonElement>('[data-timeline-zoom-in]')!;
  const zoomSliderEl = container.querySelector<HTMLInputElement>('[data-timeline-zoom-slider]')!;
  const zoomReadoutEl = container.querySelector<HTMLElement>('[data-timeline-zoom-readout]')!;
  const addBtn = container.querySelector<HTMLButtonElement>('[data-timeline-add]')!;
  const liveEl = container.querySelector<HTMLElement>('[data-timeline-live]')!;

  /** Window-relative viewport — ALL sec↔px mapping goes through this (§16.2). */
  let wv: WindowViewport = {
    window: { viewStartSeconds: 0, viewEndSeconds: 0 },
    trackWidthPx: 0,
  };
  /** Full timeline duration (clip ∨ max cue end) — the 1×/fit extent. */
  let fullDurationSeconds = 0;
  /** User zoom/pan state; null = fit (window follows the clip duration). */
  let userWindow: TimelineWindow | null = null;
  let clipCache: number | null = null;
  let tickSecondsCache: number[] = [];
  let playheadSeconds: number | null = null;
  let sweepRaf = 0;
  let drag: DragState | null = null;
  let lensDrag: {
    mode: 'pan' | 'start' | 'end';
    pointerId: number;
    startClientX: number;
    orig: TimelineWindow;
  } | null = null;
  /** Modifier-click (Ctrl/Shift) resolves as select on pointerUP, not drag. */
  let pendingSelect: { index: number; pointerId: number; mode: 'toggle' | 'range' } | null = null;
  /** Consecutive ↑/↓ repeats — accelerates the nudge step when held (§6.4). */
  let nudgeRepeatCount = 0;
  let liveToggle = false;
  /** Waveform source cache — pyramid computed once per decoded buffer (§16.5). */
  let peaksBuffer: AudioBuffer | null = null;
  let peaksChannel: Float32Array | null = null;
  let peaksPyramid: WaveformPeaks | null = null;
  /** View-only display gain: quiet voice takes are normalized to fill the lane. */
  let peaksGain = 1;
  let peaksGeneration = 0;
  let lastWaveformPaintKey = '';

  function resolveDuration(segments: TranscriptSegment[], clip: number | null): number {
    let maxEnd = 0;
    for (const segment of segments) {
      if (Number.isFinite(segment.end) && segment.end > maxEnd) maxEnd = segment.end;
    }
    return Math.max(clip ?? 0, maxEnd, 0);
  }

  /** Immediate left/right neighbors by start position (clamp bounds). */
  function neighborContext(segments: TranscriptSegment[], index: number): CueEditContext {
    const start = segments[index].start;
    let prevEndSeconds = 0;
    let bestPrevStart = -Infinity;
    // Bounds are FULL-timeline, never window-relative — zoom must not change clamps.
    let nextStartSeconds = fullDurationSeconds;
    let bestNextStart = Infinity;
    segments.forEach((other, j) => {
      if (j === index) return;
      if (other.start < start && other.start > bestPrevStart) {
        bestPrevStart = other.start;
        prevEndSeconds = other.end;
      }
      if (other.start > start && other.start < bestNextStart) {
        bestNextStart = other.start;
        nextStartSeconds = other.start;
      }
    });
    return { prevEndSeconds, nextStartSeconds };
  }

  function barStateClasses(segment: TranscriptSegment, index: number, clip: number | null): string {
    const classes: string[] = ['studio__cue-bar'];
    if (deps.getSelectedIndices().includes(index)) classes.push('studio__cue-bar--selected');
    if (deps.isDirtyIndex(index)) classes.push('studio__cue-bar--dirty');
    if (cueTextIsBlank(segment.text)) classes.push('studio__cue-bar--scaffold');
    if (clip !== null && segmentHasOutOfBoundsEnd(segment, clip)) classes.push('studio__cue-bar--oob');
    // Parity row 5: warning tint + ⚠ LONG pill (host cueFitCache / heuristic).
    if (deps.getCueFitState(index)?.overflow) classes.push('studio__cue-bar--long');
    // §8: amber attention halo + priority dot when a smart fix is suggested.
    if (deps.getCueSuggestion(index)) classes.push('studio__cue-bar--suggested');
    if (deps.isPlayingIndex(index)) classes.push('studio__cue-bar--playing');
    if (drag && drag.index === index) classes.push('studio__cue-bar--grabbed');
    return classes.join(' ');
  }

  function renderRuler(): void {
    const ticks = generateRulerTicksInWindow(wv);
    tickSecondsCache = ticks.filter((tick) => tick.major).map((tick) => tick.seconds);
    rulerEl.innerHTML = ticks
      .map((tick) => {
        const cls = tick.major
          ? 'studio__cue-timeline-tick studio__cue-timeline-tick--major'
          : 'studio__cue-timeline-tick';
        const label = tick.label
          ? `<span class="studio__cue-timeline-tick-label">${escapeHtml(tick.label)}</span>`
          : '';
        return `<span class="${cls}" style="left:${tick.px.toFixed(2)}px">${label}</span>`;
      })
      .join('');
    // The cap lives in the ruler (renderRuler wipes innerHTML, so re-append here);
    // applyPlayhead() repositions it on every playhead change.
    rulerEl.insertAdjacentHTML(
      'beforeend',
      '<span class="studio__cue-timeline-playhead-cap" data-timeline-playhead-cap hidden></span>',
    );
  }

  function renderClipEndMarker(clip: number | null): void {
    trackEl.querySelector('[data-timeline-clip-end]')?.remove();
    if (clip === null || clip >= fullDurationSeconds - 1e-6) return;
    const px = windowSecondsToPx(clip, wv);
    if (px < 0 || px > wv.trackWidthPx) return; // off-window at this zoom
    const marker = document.createElement('div');
    marker.className = 'studio__cue-timeline-clip-end';
    marker.dataset.timelineClipEnd = '';
    marker.title = 'Recording length';
    marker.style.transform = `translateX(${px.toFixed(2)}px)`;
    trackEl.append(marker);
  }

  function barInnerHtml(segment: TranscriptSegment, index: number): string {
    const preview = escapeHtml(stripScaffoldPlaceholder(segment.text).trim() || '(empty)');
    // Pills are always in the DOM; the bar's state classes decide visibility
    // (CSS), so targeted class updates keep them honest without re-rendering.
    // The §8 suggestion dot follows the same pattern; its number/tooltip are
    // dynamic, so updateBarDom keeps them in sync between full renders.
    const suggestion = deps.getCueSuggestion(index);
    return `
      <span class="studio__cue-bar-handle studio__cue-bar-handle--start" data-cue-handle="start" aria-hidden="true"></span>
      <span class="studio__cue-bar-body">
        <span class="studio__cue-bar-label">${index + 1}</span>
        <span class="studio__cue-bar-text">${preview}</span>
      </span>
      <span class="studio__cue-bar-pill studio__cue-bar-pill--long" title="Too long for one line — will trail off screen in the baked video">⚠ LONG</span>
      <span class="studio__cue-bar-pill studio__cue-bar-pill--oob" title="Cue end exceeds recording length">⚠ OOB</span>
      <span class="studio__cue-bar-suggest-dot" data-cue-suggest-dot title="${escapeHtml(suggestion?.title ?? '')}" aria-hidden="true">${suggestion ? suggestion.priority : ''}</span>
      <span class="studio__cue-bar-handle studio__cue-bar-handle--end" data-cue-handle="end" aria-hidden="true"></span>
    `;
  }

  function renderBars(segments: TranscriptSegment[], clip: number | null): void {
    trackEl.querySelectorAll('[data-cue-index]').forEach((node) => node.remove());
    // Window-relative layout with off-window culling — bar.index is the ORIGINAL
    // segment index (culling means positions ≠ array positions from here on).
    const bars = layoutBarsInWindow(
      segments.map((segment) => ({ start: segment.start, end: segment.end })),
      wv,
    );
    const html = bars
      .map((bar) => {
        const segment = segments[bar.index];
        const selected = bar.index === deps.getSelectedIndex();
        // R1: a floored-width bar has no honest room for label/text — hide them.
        const tiny = bar.rawWidthPx < MIN_BAR_WIDTH_PX ? ' studio__cue-bar--tiny' : '';
        // §16.3: narrow bars grow outboard "ears" so trim stays grabbable.
        const eared = bar.widthPx < EAR_THRESHOLD_PX ? ' studio__cue-bar--eared' : '';
        return `
          <div
            class="${barStateClasses(segment, bar.index, clip)}${tiny}${eared}"
            data-cue-index="${bar.index}"
            role="option"
            aria-selected="${selected ? 'true' : 'false'}"
            style="transform:translateX(${bar.leftPx.toFixed(2)}px);width:${bar.widthPx.toFixed(2)}px"
            title="Cue ${bar.index + 1}: ${formatCueTimestamp(segment.start)} → ${formatCueTimestamp(segment.end)}"
          >${barInnerHtml(segment, bar.index)}</div>
        `;
      })
      .join('');
    playheadEl.insertAdjacentHTML('beforebegin', html);
  }

  function renderInspector(segments: TranscriptSegment[]): void {
    const index = deps.getSelectedIndex();
    if (index === null || index < 0 || index >= segments.length) {
      inspectorEl.hidden = true;
      inspectorEl.innerHTML = '';
      railHintEl.hidden = false;
      return;
    }
    const segment = segments[index];
    const playing = deps.isPlayingIndex(index);
    const canPlay = deps.hasAudio();
    const text = escapeHtml(stripScaffoldPlaceholder(segment.text));
    const selectedCount = deps.getSelectedIndices().length;
    inspectorEl.hidden = false;
    railHintEl.hidden = true;
    inspectorEl.innerHTML = `
      <div class="studio__cue-timeline-inspector-row">
        <span class="studio__cue-timeline-inspector-label">Cue ${index + 1}</span>
        <label class="studio__cue-timeline-inspector-field">
          <span>Start</span>
          <input type="number" min="0" step="0.1" value="${round2(segment.start)}" data-timeline-start aria-label="Cue start seconds" />
        </label>
        <label class="studio__cue-timeline-inspector-field">
          <span>End</span>
          <input type="number" min="0" step="0.1" value="${round2(segment.end)}" data-timeline-end aria-label="Cue end seconds" />
        </label>
      </div>
      <textarea
        class="studio__cue-timeline-inspector-text"
        rows="2"
        data-timeline-text
        aria-label="Cue text"
      >${text}</textarea>
      <p class="studio__cue-timeline-inspector-fit" data-timeline-fit hidden></p>
      <div class="studio__cue-timeline-inspector-suggest" data-timeline-suggest hidden>
        <p class="studio__cue-timeline-inspector-suggest-copy" data-timeline-suggest-copy></p>
        <div class="studio__cue-timeline-inspector-suggest-actions">
          <button
            type="button"
            class="studio__cue-timeline-suggest-fix"
            data-timeline-suggest-fix
            title="Apply the smallest change that makes this cue fit"
          >⚡ Apply minimal fix</button>
          <button
            type="button"
            class="studio__cue-timeline-suggest-open"
            data-timeline-suggest-adjust
            title="Open Smart Adjust with this cue's proposals first"
          >Smart Adjust…</button>
        </div>
      </div>
      <div class="studio__cue-timeline-inspector-actions">
        <button
          type="button"
          class="studio__transcript-cue-play"
          data-timeline-play
          aria-pressed="${playing ? 'true' : 'false'}"
          ${canPlay ? '' : 'disabled'}
          aria-label="${playing ? 'Stop cue preview' : 'Play cue preview'}"
        >${playing ? '■' : '▶'}</button>
        <button
          type="button"
          class="studio__transcript-cue-split"
          data-timeline-split
          title="Split this cue into shorter timed cues that each fit on screen"
          aria-label="Smart split this cue"
        >✂ Split</button>
        <button
          type="button"
          class="studio__cue-timeline-inspector-delete"
          data-timeline-delete
          title="${selectedCount > 1 ? `Delete the ${selectedCount} selected cues` : 'Delete this cue'}"
          aria-label="${selectedCount > 1 ? `Delete the ${selectedCount} selected cues` : 'Delete this cue'}"
        >🗑</button>
      </div>
      ${
        selectedCount > 1
          ? `<p class="studio__cue-timeline-inspector-multi popup__field-desc">${selectedCount} cues selected — ↑/↓ nudges all, Delete removes all.</p>`
          : ''
      }
    `;
    updateInspectorFit(index);
  }

  /** In-place fit-line + Split-enablement refresh — never rebuilds the inspector
      (rebuilding would steal focus from the textarea mid-typing). */
  function updateInspectorFit(index: number): void {
    if (deps.getSelectedIndex() !== index) return;
    const fitEl = inspectorEl.querySelector<HTMLElement>('[data-timeline-fit]');
    if (fitEl) {
      const fit = deps.getCueFitState(index);
      if (fit?.label) {
        fitEl.hidden = false;
        fitEl.textContent = fit.label;
        if (fit.tier) fitEl.dataset.fitTier = fit.tier;
        else delete fitEl.dataset.fitTier;
      } else {
        fitEl.hidden = true;
        fitEl.textContent = '';
      }
    }
    const splitBtn = inspectorEl.querySelector<HTMLButtonElement>('[data-timeline-split]');
    if (splitBtn) splitBtn.disabled = !deps.canSplitIndex(index);
    // §8: suggestion callout — same in-place contract as the fit line, so async
    // fit results landing via refreshCueState keep the panel honest too.
    const suggestEl = inspectorEl.querySelector<HTMLElement>('[data-timeline-suggest]');
    if (suggestEl) {
      const suggestion = deps.getCueSuggestion(index);
      suggestEl.hidden = !suggestion;
      if (suggestion) {
        const copyEl = suggestEl.querySelector<HTMLElement>('[data-timeline-suggest-copy]');
        if (copyEl) copyEl.textContent = suggestion.title;
        const fixBtn = suggestEl.querySelector<HTMLButtonElement>('[data-timeline-suggest-fix]');
        if (fixBtn) fixBtn.hidden = !suggestion.hasMinimalFix;
      }
    }
  }

  function formatTimecode(seconds: number): string {
    const safe = Math.max(0, seconds);
    const whole = Math.floor(safe);
    const minutes = Math.floor(whole / 60);
    const secs = whole % 60;
    const millis = Math.floor((safe - whole) * 1000);
    return `${minutes}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
  }

  function updateTimecode(): void {
    timecodeEl.textContent = formatTimecode(playheadSeconds ?? 0);
    timecodeTotalEl.textContent = `/ ${formatTimecode(fullDurationSeconds)}`;
  }

  function updateTransport(): void {
    const index = deps.getSelectedIndex();
    const playing = index !== null && deps.isPlayingIndex(index);
    transportPlayBtn.disabled = index === null || !deps.hasAudio();
    transportPlayBtn.textContent = playing ? '■' : '▶';
    transportPlayBtn.setAttribute('aria-pressed', playing ? 'true' : 'false');
    transportPlayBtn.setAttribute('aria-label', playing ? 'Stop cue preview' : 'Play selected cue');
  }

  function applyPlayhead(): void {
    updateTimecode();
    const capEl = rulerEl.querySelector<HTMLElement>('[data-timeline-playhead-cap]');
    if (playheadSeconds === null || fullDurationSeconds <= 0) {
      playheadEl.hidden = true;
      waveformPlayheadEl.hidden = true;
      if (capEl) capEl.hidden = true;
      return;
    }
    const px = windowSecondsToPx(playheadSeconds, wv);
    if (px < -1 || px > wv.trackWidthPx + 1) {
      playheadEl.hidden = true; // playhead is outside the zoomed window
      waveformPlayheadEl.hidden = true;
      if (capEl) capEl.hidden = true;
      return;
    }
    playheadEl.hidden = false;
    playheadEl.style.transform = `translateX(${px.toFixed(2)}px)`;
    // Echo through the waveform lane so cap → waveform → track reads as one line.
    waveformPlayheadEl.hidden = false;
    waveformPlayheadEl.style.transform = `translateX(${px.toFixed(2)}px)`;
    if (capEl) {
      capEl.hidden = false;
      capEl.style.transform = `translateX(${(px - 5.5).toFixed(2)}px)`;
    }
  }

  // ── Zoom state (window resolution + control cluster) ───────────────────────

  function minWin(): number {
    return minWindowSeconds(deps.getFps());
  }

  function maxZoom(): number {
    const floor = minWin();
    return fullDurationSeconds > floor ? fullDurationSeconds / floor : 1;
  }

  function currentZoom(): number {
    return windowZoomFactor(wv.window, fullDurationSeconds);
  }

  /** Adopt a window (clamped); ≈fit collapses back to null so fit tracks the clip. */
  function setWindow(next: TimelineWindow | null): void {
    if (next) {
      const clamped = clampWindow(next, fullDurationSeconds, minWin());
      userWindow = windowZoomFactor(clamped, fullDurationSeconds) <= 1.001 ? null : clamped;
    } else {
      userWindow = null;
    }
    render();
  }

  function updateZoomUi(): void {
    const zMax = maxZoom();
    const z = currentZoom();
    const zoomable = zMax > 1.001;
    zoomFitBtn.disabled = !zoomable;
    zoomSelBtn.disabled = !zoomable || deps.getSelectedIndex() === null;
    zoomOutBtn.disabled = !zoomable || z <= 1.001;
    zoomInBtn.disabled = !zoomable || z >= zMax - 1e-6;
    zoomSliderEl.disabled = !zoomable;
    zoomSliderEl.value = String(Math.round(zoomFactorToSlider(z, zMax) * 1000));
    zoomReadoutEl.textContent = `${z >= 10 ? z.toFixed(0) : z.toFixed(1)}×`;
  }

  function renderMinimap(segments: TranscriptSegment[]): void {
    const show = fullDurationSeconds > 0 && currentZoom() > 1.02;
    minimapEl.hidden = !show;
    if (!show) return;
    // Selected cues read amber in the overview — "where am I" at a glance
    // (mirrors the selected bar treatment; user-requested after Sprint-4 QA).
    const selectedIndices = deps.getSelectedIndices();
    minimapHeatEl.innerHTML = segments
      .map((segment, index) => {
        const startSec = Math.max(0, Math.min(segment.start, segment.end));
        const left = (startSec / fullDurationSeconds) * 100;
        const width = (Math.abs(segment.end - segment.start) / fullDurationSeconds) * 100;
        const cls = selectedIndices.includes(index)
          ? ' class="studio__cue-timeline-minimap-cue--selected"'
          : '';
        return `<span${cls} style="left:${left.toFixed(2)}%;width:${Math.max(0.4, width).toFixed(2)}%"></span>`;
      })
      .join('');
    const lens = minimapLens(wv.window, fullDurationSeconds, minimapEl.clientWidth);
    lensEl.style.transform = `translateX(${lens.leftPx.toFixed(2)}px)`;
    lensEl.style.width = `${Math.max(8, lens.widthPx).toFixed(2)}px`;
  }

  // ── Waveform lane (§16.5) — repaint ONLY on window/resize/source change ────

  function paintWaveform(): void {
    const cssWidth = waveformCanvasEl.clientWidth;
    const cssHeight = waveformCanvasEl.clientHeight;
    if (cssWidth <= 0 || cssHeight <= 0) return;

    const buffer = deps.getDecodedAudioBuffer();
    if (buffer !== peaksBuffer) {
      // New source: extract channel 0 + one full-clip pyramid pass (cached).
      peaksBuffer = buffer;
      peaksChannel = buffer ? buffer.getChannelData(0) : null;
      peaksPyramid =
        buffer && peaksChannel ? computeWaveformPyramid(peaksChannel, buffer.sampleRate) : null;
      // Display gain (user contrast feedback): voice takes rarely peak past
      // ~0.4, so normalize the VIEW to the clip's own maximum (capped at 4×).
      // Emphasis only — playback and every stored artifact are untouched.
      peaksGain = 1;
      if (peaksPyramid) {
        let peak = 0;
        for (let i = 0; i < peaksPyramid.max.length; i += 1) {
          const hi = Math.abs(peaksPyramid.max[i]);
          const lo = Math.abs(peaksPyramid.min[i]);
          if (hi > peak) peak = hi;
          if (lo > peak) peak = lo;
        }
        if (peak > 0.01) peaksGain = Math.min(4, 0.92 / peak);
      }
      peaksGeneration += 1;
    }

    const dpr = window.devicePixelRatio || 1;
    const paintKey = [
      peaksGeneration,
      wv.window.viewStartSeconds.toFixed(4),
      wv.window.viewEndSeconds.toFixed(4),
      cssWidth,
      cssHeight,
      dpr,
    ].join(':');
    if (paintKey === lastWaveformPaintKey) return; // view + source unchanged — skip
    lastWaveformPaintKey = paintKey;

    waveformCanvasEl.width = Math.round(cssWidth * dpr); // also resets ctx state
    waveformCanvasEl.height = Math.round(cssHeight * dpr);
    const ctx = waveformCanvasEl.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    // Contrast pass (user feedback): the WAVEFORM is the bright figure
    // (--studio-accent-bars, high alpha, view gain applied) and the baseline is
    // a dim silence reference drawn UNDERNEATH (--studio-indigo-muted) — it
    // shows through quiet stretches and alone is the element-mode fallback.
    // Same indigo/cividis axis, roles swapped for figure–ground contrast.
    const styles = getComputedStyle(waveformCanvasEl);
    const fillColor = styles.getPropertyValue('--studio-accent-bars').trim() || '#8f93e6';
    const baselineColor = styles.getPropertyValue('--studio-indigo-muted').trim() || '#8a86b0';
    const mid = cssHeight / 2;

    ctx.globalAlpha = 0.55;
    ctx.fillStyle = baselineColor;
    ctx.fillRect(0, mid - 0.5, cssWidth, 1);

    if (peaksBuffer && peaksChannel && peaksPyramid) {
      const winStart = wv.window.viewStartSeconds;
      const winEnd = wv.window.viewEndSeconds;
      const pps = WAVEFORM_PYRAMID_PEAKS_PER_SECOND;
      // Low zoom: resample the cached pyramid. Deep zoom (window holds fewer
      // pyramid bins than pixels): exact peaks from raw samples — the window is
      // small there, so the pass stays cheap.
      const peaks =
        (winEnd - winStart) * pps >= cssWidth
          ? resamplePeaks(peaksPyramid, winStart * pps, winEnd * pps, cssWidth)
          : computeRangePeaks(
              peaksChannel,
              winStart * peaksBuffer.sampleRate,
              winEnd * peaksBuffer.sampleRate,
              cssWidth,
            );
      const amp = mid - 2;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = fillColor;
      for (let x = 0; x < cssWidth; x += 1) {
        const hi = Math.min(1, Math.max(-1, peaks.max[x] * peaksGain));
        const lo = Math.min(1, Math.max(-1, peaks.min[x] * peaksGain));
        const top = mid - hi * amp;
        ctx.fillRect(x, top, 1, Math.max(1, (hi - lo) * amp));
      }
    }
    ctx.globalAlpha = 1;
  }

  function render(): void {
    const segments = deps.getSegments();
    clipCache = deps.getClipDurationSeconds();
    fullDurationSeconds = resolveDuration(segments, clipCache);
    const trackWidthPx = trackEl.clientWidth;

    if (segments.length === 0) {
      emptyEl.hidden = false;
      rulerEl.innerHTML = '';
      trackEl.querySelectorAll('[data-cue-index]').forEach((node) => node.remove());
      minimapEl.hidden = true;
      waveformLaneEl.hidden = true;
      renderInspector(segments);
      updateTransport();
      return;
    }
    emptyEl.hidden = true;
    if (fullDurationSeconds <= 0 || trackWidthPx <= 0) return; // ResizeObserver re-fires when shown
    waveformLaneEl.hidden = false;

    // Resolve the view window: user zoom/pan clamped to the (possibly changed)
    // duration, or fit. Keeping the normalized value avoids re-clamp drift.
    const effective = userWindow
      ? clampWindow(userWindow, fullDurationSeconds, minWin())
      : fitWindow(fullDurationSeconds);
    if (userWindow) userWindow = effective;
    wv = { window: effective, trackWidthPx };

    renderRuler();
    renderBars(segments, clipCache);
    renderClipEndMarker(clipCache);
    renderInspector(segments);
    renderMinimap(segments);
    paintWaveform();
    updateZoomUi();
    updateTransport();
    applyPlayhead();
  }

  // ── Targeted updates (during interaction — no full re-render) ──────────────

  function barElAt(index: number): HTMLElement | null {
    return trackEl.querySelector<HTMLElement>(`[data-cue-index="${index}"]`);
  }

  function updateBarDom(index: number): void {
    const barEl = barElAt(index);
    const segment = deps.getSegments()[index];
    if (!barEl || !segment) return;
    const bar = layoutBarInWindow({ start: segment.start, end: segment.end }, index, wv);
    barEl.style.transform = `translateX(${bar.leftPx.toFixed(2)}px)`;
    barEl.style.width = `${bar.widthPx.toFixed(2)}px`;
    barEl.className = barStateClasses(segment, index, clipCache);
    barEl.classList.toggle('studio__cue-bar--tiny', bar.rawWidthPx < MIN_BAR_WIDTH_PX);
    barEl.classList.toggle('studio__cue-bar--eared', bar.widthPx < EAR_THRESHOLD_PX);
    barEl.setAttribute('aria-selected', index === deps.getSelectedIndex() ? 'true' : 'false');
    barEl.title = `Cue ${index + 1}: ${formatCueTimestamp(segment.start)} → ${formatCueTimestamp(segment.end)}`;
    const textEl = barEl.querySelector<HTMLElement>('.studio__cue-bar-text');
    if (textEl) textEl.textContent = stripScaffoldPlaceholder(segment.text).trim() || '(empty)';
    // §8: the priority number/tooltip are the dot's dynamic bits — the state
    // class (set above via barStateClasses) controls its visibility.
    const dotEl = barEl.querySelector<HTMLElement>('[data-cue-suggest-dot]');
    if (dotEl) {
      const suggestion = deps.getCueSuggestion(index);
      dotEl.textContent = suggestion ? String(suggestion.priority) : '';
      dotEl.title = suggestion?.title ?? '';
    }
  }

  function updateInspectorFields(index: number): void {
    if (deps.getSelectedIndex() !== index) return;
    const segment = deps.getSegments()[index];
    if (!segment) return;
    const startInput = inspectorEl.querySelector<HTMLInputElement>('[data-timeline-start]');
    const endInput = inspectorEl.querySelector<HTMLInputElement>('[data-timeline-end]');
    if (startInput && document.activeElement !== startInput) startInput.value = String(round2(segment.start));
    if (endInput && document.activeElement !== endInput) endInput.value = String(round2(segment.end));
  }

  // ── Snap helper (neighbor 12px, playhead/tick 8px, Shift disables magnetism) ─

  function snapValue(raw: number, neighborSeconds: number[], shift: boolean): number {
    // Window-relative px→s: at 4× zoom the same 12 px covers 4× less time, so
    // magnetism precision scales with zoom automatically (§16.4).
    const neighborTol = windowPxDeltaToSeconds(NEIGHBOR_MAGNET_PX, wv);
    const softTol = windowPxDeltaToSeconds(SOFT_MAGNET_PX, wv);
    const softTicks = tickSecondsCache.filter((t) => Math.abs(t - raw) <= softTol);
    const playhead =
      playheadSeconds !== null && Math.abs(playheadSeconds - raw) <= softTol ? playheadSeconds : null;
    return resolveSnap(raw, {
      fps: deps.getFps(),
      neighborSeconds,
      playheadSeconds: playhead,
      tickSeconds: softTicks,
      toleranceSeconds: neighborTol,
      disableMagnetism: shift,
    }).seconds;
  }

  // ── Snap guide (visual feedback while a magnet is held, §16.4) ──────────────

  function hideSnapGuide(): void {
    snapGuideEl.hidden = true;
  }

  function updateSnapGuide(res: StickySnapResolution): void {
    if (!res.active) {
      hideSnapGuide();
      return;
    }
    const px = windowSecondsToPx(res.active.seconds, wv);
    if (px < 0 || px > wv.trackWidthPx) {
      hideSnapGuide();
      return;
    }
    snapGuideEl.hidden = false;
    snapGuideEl.style.transform = `translateX(${px.toFixed(2)}px)`;
    snapGuideEl.classList.toggle(
      'studio__cue-timeline-snap-guide--playhead',
      res.active.kind === 'playhead',
    );
    if (res.acquired) {
      // Restart the one-shot acquisition flash (reflow re-arms the animation).
      snapGuideEl.classList.remove('studio__cue-timeline-snap-guide--flash');
      void snapGuideEl.offsetWidth;
      snapGuideEl.classList.add('studio__cue-timeline-snap-guide--flash');
    }
  }

  /** Drag-path snap: hysteresis hold + guide side effects (inspector keeps snapValue). */
  function snapDrag(raw: number, neighborSeconds: number[], shift: boolean): number {
    if (!drag) return raw;
    const neighborTol = windowPxDeltaToSeconds(NEIGHBOR_MAGNET_PX, wv);
    const softTol = windowPxDeltaToSeconds(SOFT_MAGNET_PX, wv);
    const softTicks = tickSecondsCache.filter((t) => Math.abs(t - raw) <= softTol);
    const playhead =
      playheadSeconds !== null && Math.abs(playheadSeconds - raw) <= softTol ? playheadSeconds : null;
    const enterPx = drag.activeSnap?.kind === 'neighbor' ? NEIGHBOR_MAGNET_PX : SOFT_MAGNET_PX;
    const res = resolveSnapSticky(
      raw,
      {
        fps: deps.getFps(),
        neighborSeconds,
        playheadSeconds: playhead,
        tickSeconds: softTicks,
        toleranceSeconds: neighborTol,
        disableMagnetism: shift,
      },
      drag.activeSnap,
      windowPxDeltaToSeconds(enterPx + SNAP_RELEASE_EXTRA_PX, wv),
    );
    drag.activeSnap = res.active;
    updateSnapGuide(res);
    return res.seconds;
  }

  // ── Auto-pan (drag a bar against the window edge to scroll the view) ────────

  let autoPanRaf = 0;

  function stopAutoPan(): void {
    if (autoPanRaf) cancelAnimationFrame(autoPanRaf);
    autoPanRaf = 0;
  }

  function autoPanStep(): void {
    autoPanRaf = 0;
    if (!drag || drag.suspended || !drag.moved) return;
    if (currentZoom() <= 1.001) return;
    const rect = trackEl.getBoundingClientRect();
    if (rect.width <= 0) return;
    const x = drag.lastClientX - rect.left;
    let dir = 0;
    let depth = 0;
    if (x < AUTO_PAN_ZONE_PX) {
      dir = -1;
      depth = Math.min(1, (AUTO_PAN_ZONE_PX - x) / AUTO_PAN_ZONE_PX);
    } else if (x > rect.width - AUTO_PAN_ZONE_PX) {
      dir = 1;
      depth = Math.min(1, (x - (rect.width - AUTO_PAN_ZONE_PX)) / AUTO_PAN_ZONE_PX);
    }
    if (dir === 0) return;
    const before = wv.window.viewStartSeconds;
    const panSeconds = windowPxDeltaToSeconds(dir * depth * AUTO_PAN_MAX_PX_PER_FRAME, wv);
    userWindow = panWindow(wv.window, panSeconds, fullDurationSeconds, minWin());
    render();
    const actual = wv.window.viewStartSeconds - before;
    if (Math.abs(actual) < 1e-9) return; // clamped at the clip edge — stop panning
    // The window slid under a (roughly) stationary pointer: carry the cue along.
    drag.panAccumSeconds += actual;
    applyDragAt(drag.lastClientX, drag.lastShift);
    autoPanRaf = requestAnimationFrame(autoPanStep);
  }

  function maybeAutoPan(): void {
    if (autoPanRaf) return;
    autoPanRaf = requestAnimationFrame(autoPanStep);
  }

  // ── Drag / resize ─────────────────────────────────────────────────────────

  function onTrackPointerDown(event: PointerEvent): void {
    const target = event.target as HTMLElement;
    const barEl = target.closest<HTMLElement>('[data-cue-index]');
    if (!barEl) return;
    const index = Number(barEl.dataset.cueIndex);
    if (!Number.isFinite(index)) return;

    // Multi-select modifiers act on pointerUP-as-click (never start a drag for
    // Ctrl; Shift still drags — fine control — and range-selects only on click).
    if (event.ctrlKey || event.metaKey) {
      pendingSelect = { index, pointerId: event.pointerId, mode: 'toggle' };
      return;
    }
    if (event.shiftKey && deps.getSelectedIndex() !== null) {
      pendingSelect = { index, pointerId: event.pointerId, mode: 'range' };
      // fall through — a Shift-drag on the bar must still work (fine control)
    } else if (deps.getSelectedIndex() !== index) {
      deps.onSelect(index);
      render();
    }
    const segments = deps.getSegments();
    const segment = segments[index];
    if (!segment) return;
    const rawZone = target.closest<HTMLElement>('[data-cue-handle]')?.dataset.cueHandle;
    const zone: DragZone = rawZone === 'start' || rawZone === 'end' ? rawZone : 'body';
    drag = {
      index,
      zone,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      origStart: segment.start,
      origEnd: segment.end,
      origDuration: segment.end - segment.start,
      ctx: neighborContext(segments, index),
      moved: false,
      suspended: false,
      activeSnap: null,
      panAccumSeconds: 0,
      lastClientX: event.clientX,
      lastShift: event.shiftKey,
    };
    // Grab lift — instant feedback (render() above may have replaced the node).
    barElAt(index)?.classList.add('studio__cue-bar--grabbed');
    try {
      trackEl.setPointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  }

  /** Compute + commit the drag value for a pointer x (shared by move + auto-pan). */
  function applyDragAt(clientX: number, shift: boolean): void {
    if (!drag) return;
    const dx = clientX - drag.startClientX;
    const deltaSeconds = windowPxDeltaToSeconds(dx, wv) + drag.panAccumSeconds;
    let start = drag.origStart;
    let end = drag.origEnd;

    if (drag.zone === 'start') {
      const raw = snapDrag(drag.origStart + deltaSeconds, [drag.ctx.prevEndSeconds], shift);
      start = constrainResizeStart(raw, drag.origEnd, drag.ctx);
    } else if (drag.zone === 'end') {
      const raw = snapDrag(drag.origEnd + deltaSeconds, [drag.ctx.nextStartSeconds], shift);
      end = constrainResizeEnd(drag.origStart, raw, drag.ctx);
    } else {
      const raw = snapDrag(
        drag.origStart + deltaSeconds,
        [drag.ctx.prevEndSeconds, drag.ctx.nextStartSeconds - drag.origDuration],
        shift,
      );
      const moved = constrainMove(raw, drag.origDuration, drag.ctx);
      start = moved.start;
      end = moved.end;
    }

    deps.onCommitTiming(drag.index, start, end);
    updateBarDom(drag.index);
    updateInspectorFields(drag.index);
  }

  function onTrackPointerMove(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startClientX;
    const dy = event.clientY - drag.startClientY;

    if (Math.abs(dy) > VERTICAL_TOLERANCE_PX) {
      drag.suspended = true; // drop the drag but keep capture — re-acquire on return
      stopAutoPan();
      hideSnapGuide();
      return;
    }
    drag.suspended = false;
    drag.lastClientX = event.clientX;
    drag.lastShift = event.shiftKey;
    if (!drag.moved && Math.abs(dx) < CLICK_SLOP_PX) return;
    if (!drag.moved) {
      drag.moved = true;
      pendingSelect = null; // it became a drag, not a modifier-click
      deps.onEditGestureStart(); // undo snapshot at gesture start (§16.7)
    }

    applyDragAt(event.clientX, event.shiftKey);
    maybeAutoPan();
  }

  function onTrackPointerUp(event: PointerEvent): void {
    // Modifier-click selection resolves on release (only if it never became a drag).
    if (pendingSelect && event.pointerId === pendingSelect.pointerId) {
      const { index, mode } = pendingSelect;
      pendingSelect = null;
      if (!drag || !drag.moved) {
        deps.onSelect(index, mode === 'toggle' ? { toggle: true } : { range: true });
        announce(`${deps.getSelectedIndices().length} cues selected`);
        if (drag) {
          try {
            trackEl.releasePointerCapture(event.pointerId);
          } catch {
            // ignore
          }
          drag = null;
        }
        render();
        return;
      }
    }
    if (!drag || event.pointerId !== drag.pointerId) return;
    stopAutoPan();
    hideSnapGuide();
    barElAt(drag.index)?.classList.remove('studio__cue-bar--grabbed');
    try {
      trackEl.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    const moved = drag.moved;
    drag = null;
    if (moved) render(); // reconcile dirty state + inspector after the gesture
  }

  /** Esc mid-gesture cancels: revert to gesture-start values (§16.4). */
  function cancelDrag(): void {
    if (!drag) return;
    stopAutoPan();
    hideSnapGuide();
    deps.onCommitTiming(drag.index, drag.origStart, drag.origEnd);
    barElAt(drag.index)?.classList.remove('studio__cue-bar--grabbed');
    try {
      trackEl.releasePointerCapture(drag.pointerId);
    } catch {
      // ignore
    }
    drag = null;
    render();
  }

  // Capture phase so a drag-cancel Esc never reaches the host's modal-close handler.
  function onDocKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !drag) return;
    event.preventDefault();
    event.stopPropagation();
    cancelDrag();
  }

  // ── Inspector editing ─────────────────────────────────────────────────────

  function onInspectorInput(event: Event): void {
    const target = event.target as HTMLElement;
    const index = deps.getSelectedIndex();
    if (index === null) return;

    if (target.matches('[data-timeline-text]')) {
      deps.onCommitText(index, (target as HTMLTextAreaElement).value);
      updateBarDom(index);
      updateInspectorFit(index); // heuristic fit lands synchronously in the host cache
      return;
    }
    if (!target.matches('[data-timeline-start], [data-timeline-end]')) return;

    const segment = deps.getSegments()[index];
    if (!segment) return;
    const ctx = neighborContext(deps.getSegments(), index);
    const startInput = inspectorEl.querySelector<HTMLInputElement>('[data-timeline-start]');
    const endInput = inspectorEl.querySelector<HTMLInputElement>('[data-timeline-end]');
    const rawStart = Number(startInput?.value ?? segment.start);
    const rawEnd = Number(endInput?.value ?? segment.end);

    let start = segment.start;
    let end = segment.end;
    if (target.matches('[data-timeline-start]') && Number.isFinite(rawStart)) {
      start = constrainResizeStart(snapValue(rawStart, [], true), Number.isFinite(rawEnd) ? rawEnd : segment.end, ctx);
    } else if (Number.isFinite(rawEnd)) {
      end = constrainResizeEnd(Number.isFinite(rawStart) ? rawStart : segment.start, snapValue(rawEnd, [], true), ctx);
    }
    deps.onCommitTiming(index, start, end);
    updateBarDom(index); // leave the focused input as typed; blur re-renders the clamped value
  }

  function onInspectorChange(): void {
    render(); // normalize clamped values back into the inputs on commit/blur
  }

  function onInspectorClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const index = deps.getSelectedIndex();
    if (index === null) return;

    const playBtn = target.closest<HTMLButtonElement>('[data-timeline-play]');
    if (playBtn && !playBtn.disabled) {
      if (deps.isPlayingIndex(index)) deps.onRequestStop();
      else deps.onRequestPlay(index);
      return;
    }
    const splitBtn = target.closest<HTMLButtonElement>('[data-timeline-split]');
    if (splitBtn && !splitBtn.disabled) {
      deps.onRequestSplit(index); // host snapshots + splits + re-renders
      announce(`Cue ${index + 1} split`);
      return;
    }
    // §8: one-click smart entry points — the host owns proposal derivation and
    // apply (fresh each click, never a cached proposal against a moved draft).
    const suggestFixBtn = target.closest<HTMLButtonElement>('[data-timeline-suggest-fix]');
    if (suggestFixBtn) {
      const applied = deps.onApplyMinimalFix(index);
      announce(
        applied
          ? `Minimal fix applied around cue ${index + 1}`
          : `That fix is no longer available for cue ${index + 1}`,
      );
      return;
    }
    const suggestOpenBtn = target.closest<HTMLButtonElement>('[data-timeline-suggest-adjust]');
    if (suggestOpenBtn) {
      deps.onOpenSmartAdjust(index);
      return;
    }
    const deleteBtn = target.closest<HTMLButtonElement>('[data-timeline-delete]');
    if (deleteBtn) {
      const indices = deps.getSelectedIndices();
      deps.onRequestDelete(indices.length > 0 ? indices : [index]);
      announce(indices.length > 1 ? `${indices.length} cues deleted` : `Cue ${index + 1} deleted`);
    }
  }

  /** Focusing a precise field starts a discrete edit — snapshot for undo (§16.7). */
  function onInspectorFocusIn(event: FocusEvent): void {
    const target = event.target as HTMLElement;
    if (target.matches('[data-timeline-start], [data-timeline-end], [data-timeline-text]')) {
      deps.onEditGestureStart();
    }
  }

  // ── Ruler scrub + playhead sweep ──────────────────────────────────────────

  let scrubbing = false;
  function scrubToClientX(clientX: number): void {
    if (wv.trackWidthPx <= 0) return;
    const rect = rulerEl.getBoundingClientRect();
    setPlayheadSeconds(windowPxToSeconds(clientX - rect.left, wv));
  }
  function onRulerPointerDown(event: PointerEvent): void {
    scrubbing = true;
    rulerEl.setPointerCapture(event.pointerId);
    scrubToClientX(event.clientX);
  }
  function onRulerPointerMove(event: PointerEvent): void {
    if (scrubbing) scrubToClientX(event.clientX);
  }
  function onRulerPointerUp(event: PointerEvent): void {
    scrubbing = false;
    try {
      rulerEl.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  }

  function setPlayheadSeconds(seconds: number | null): void {
    playheadSeconds = seconds;
    applyPlayhead();
  }

  function beginPlaybackSweep(startSeconds: number, endSeconds: number): void {
    endPlaybackSweep();
    const span = Math.max(0, endSeconds - startSeconds);
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const tick = (): void => {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const elapsed = (now - startedAt) / 1000;
      setPlayheadSeconds(startSeconds + Math.min(elapsed, span));
      sweepRaf = elapsed < span ? requestAnimationFrame(tick) : 0;
    };
    setPlayheadSeconds(startSeconds);
    sweepRaf = requestAnimationFrame(tick);
  }

  function endPlaybackSweep(): void {
    if (sweepRaf) cancelAnimationFrame(sweepRaf);
    sweepRaf = 0;
    setPlayheadSeconds(null);
  }

  // ── Zoom cluster + Ctrl-wheel anchored zoom + wheel pan (§16.2) ─────────────

  function windowCenterSeconds(): number {
    return wv.window.viewStartSeconds + windowDurationSeconds(wv.window) / 2;
  }

  function zoomAt(factor: number, anchorSeconds: number): void {
    setWindow(zoomWindowAt(wv.window, factor, anchorSeconds, fullDurationSeconds, minWin()));
  }

  function onZoomFit(): void {
    setWindow(null);
  }

  function onZoomSelection(): void {
    // Frame the WHOLE selection (multi-select spans every selected cue).
    const indices = deps.getSelectedIndices();
    if (indices.length === 0) return;
    const segments = deps.getSegments();
    let lo = Infinity;
    let hi = -Infinity;
    for (const index of indices) {
      const segment = segments[index];
      if (!segment) continue;
      lo = Math.min(lo, Math.min(segment.start, segment.end));
      hi = Math.max(hi, Math.max(segment.start, segment.end));
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return;
    setWindow(windowForSpan(lo, hi, fullDurationSeconds, minWin()));
  }

  function onZoomOut(): void {
    zoomAt(1 / 1.5, windowCenterSeconds());
  }

  function onZoomIn(): void {
    zoomAt(1.5, windowCenterSeconds());
  }

  function onZoomSlider(): void {
    const t = Number(zoomSliderEl.value) / 1000;
    const z = sliderToZoomFactor(t, maxZoom());
    if (z <= 1.001) {
      setWindow(null);
      return;
    }
    setWindow(windowFromZoomFactor(z, windowCenterSeconds(), fullDurationSeconds, minWin()));
  }

  /** Ctrl(/Cmd)+wheel = anchored zoom at the cursor; plain wheel = pan when zoomed. */
  function onLanesWheel(event: WheelEvent): void {
    if (drag) return; // zoom mid-drag would invalidate the gesture's px math
    if (fullDurationSeconds <= 0 || wv.trackWidthPx <= 0) return;
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault(); // also swallows browser page-zoom / pinch
      const rect = trackEl.getBoundingClientRect();
      const anchor = windowPxToSeconds(event.clientX - rect.left, wv);
      zoomAt(Math.exp(-event.deltaY * 0.0022), anchor);
      return;
    }
    if (currentZoom() <= 1.001) return; // at fit, let the modal scroll normally
    const raw = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (raw === 0) return;
    event.preventDefault();
    setWindow(panWindow(wv.window, windowPxDeltaToSeconds(raw, wv), fullDurationSeconds, minWin()));
  }

  // ── Minimap lens (drag = pan; edge-drag = zoom; strip click = jump) ─────────

  const LENS_EDGE_PX = 6;

  function onMinimapPointerDown(event: PointerEvent): void {
    if (fullDurationSeconds <= 0) return;
    const stripRect = minimapEl.getBoundingClientRect();
    if (stripRect.width <= 0) return;
    const lensRect = lensEl.getBoundingClientRect();
    let mode: 'pan' | 'start' | 'end' = 'pan';
    if (event.clientX >= lensRect.left && event.clientX <= lensRect.right) {
      if (event.clientX - lensRect.left <= LENS_EDGE_PX) mode = 'start';
      else if (lensRect.right - event.clientX <= LENS_EDGE_PX) mode = 'end';
    } else {
      // Jump: center the window on the clicked time, then pan from there.
      const t = minimapPxToSeconds(
        event.clientX - stripRect.left,
        fullDurationSeconds,
        stripRect.width,
      );
      const dur = windowDurationSeconds(wv.window);
      setWindow({ viewStartSeconds: t - dur / 2, viewEndSeconds: t + dur / 2 });
    }
    lensDrag = {
      mode,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      orig: { ...wv.window },
    };
    try {
      minimapEl.setPointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  }

  function onMinimapPointerMove(event: PointerEvent): void {
    if (!lensDrag || event.pointerId !== lensDrag.pointerId) return;
    const stripRect = minimapEl.getBoundingClientRect();
    if (stripRect.width <= 0) return;
    const deltaSeconds =
      ((event.clientX - lensDrag.startClientX) / stripRect.width) * fullDurationSeconds;
    const { orig, mode } = lensDrag;
    if (mode === 'pan') {
      setWindow(panWindow(orig, deltaSeconds, fullDurationSeconds, minWin()));
    } else if (mode === 'start') {
      const start = Math.min(orig.viewStartSeconds + deltaSeconds, orig.viewEndSeconds - minWin());
      setWindow({ viewStartSeconds: Math.max(0, start), viewEndSeconds: orig.viewEndSeconds });
    } else {
      const end = Math.max(orig.viewEndSeconds + deltaSeconds, orig.viewStartSeconds + minWin());
      setWindow({
        viewStartSeconds: orig.viewStartSeconds,
        viewEndSeconds: Math.min(fullDurationSeconds, end),
      });
    }
  }

  function onMinimapPointerUp(event: PointerEvent): void {
    if (!lensDrag || event.pointerId !== lensDrag.pointerId) return;
    lensDrag = null;
    try {
      minimapEl.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  }

  // ── Transport (▶/■ the selected cue — same contract as the inspector button) ─

  function onTransportPlayClick(): void {
    if (transportPlayBtn.disabled) return;
    const index = deps.getSelectedIndex();
    if (index === null) return;
    if (deps.isPlayingIndex(index)) deps.onRequestStop();
    else deps.onRequestPlay(index);
  }

  function onAddClick(): void {
    deps.onRequestAddAt(playheadSeconds); // host snapshots, inserts, selects, re-renders
    announce(playheadSeconds === null ? 'Cue added at the end' : 'Cue added at the playhead');
  }

  // ── Keyboard (§6.4): ←/→ rove · ↑/↓ frame-nudge (hold accelerates) ─────────

  /** Screen-reader announcement (aria-live polite); NBSP toggle re-arms repeats. */
  function announce(text: string): void {
    liveToggle = !liveToggle;
    liveEl.textContent = liveToggle ? `${text} ` : text;
  }

  /** Keep the roved-to cue in view when zoomed (gentle pan, zoom untouched). */
  function ensureIndexVisible(index: number): void {
    if (currentZoom() <= 1.001) return;
    const segment = deps.getSegments()[index];
    if (!segment) return;
    const w = wv.window;
    if (segment.start >= w.viewStartSeconds && segment.end <= w.viewEndSeconds) return;
    const dur = windowDurationSeconds(w);
    const start = segment.start - dur * 0.15;
    setWindow({ viewStartSeconds: start, viewEndSeconds: start + dur });
  }

  /** Nudge the whole selection by ±1 frame (×4 when held). Order matters: moving
      later cues first when going right (and vice versa) so neighbors vacate. */
  function nudgeSelection(direction: 1 | -1): void {
    const indices = deps.getSelectedIndices();
    if (indices.length === 0) return;
    const frame = 1 / Math.max(1, deps.getFps());
    const delta = direction * frame * (nudgeRepeatCount > 8 ? 4 : 1);
    const order = direction > 0 ? [...indices].reverse() : indices;
    for (const index of order) {
      const segment = deps.getSegments()[index];
      if (!segment) continue;
      const raw = resolveSnap(segment.start + delta, {
        fps: deps.getFps(),
        toleranceSeconds: 0,
        disableMagnetism: true,
      }).seconds;
      const movedTo = constrainMove(raw, segment.end - segment.start, neighborContext(deps.getSegments(), index));
      deps.onCommitTiming(index, movedTo.start, movedTo.end);
      updateBarDom(index);
    }
    const primary = deps.getSelectedIndex();
    if (primary !== null) {
      updateInspectorFields(primary);
      const segment = deps.getSegments()[primary];
      if (segment) announce(`Cue ${primary + 1} at ${formatTimecode(segment.start)}`);
    }
  }

  function onTrackKeyDown(event: KeyboardEvent): void {
    const segments = deps.getSegments();
    if (segments.length === 0) return;
    const primary = deps.getSelectedIndex();

    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const dir = event.key === 'ArrowRight' ? 1 : -1;
      const next =
        primary === null
          ? dir === 1
            ? 0
            : segments.length - 1
          : Math.min(segments.length - 1, Math.max(0, primary + dir));
      if (next === primary) return;
      deps.onSelect(next);
      render();
      ensureIndexVisible(next);
      announce(`Cue ${next + 1} selected`);
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      if (primary === null) return;
      if (!event.repeat) {
        nudgeRepeatCount = 0;
        deps.onEditGestureStart(); // one undo snapshot per key-burst
      } else {
        nudgeRepeatCount += 1;
      }
      nudgeSelection(event.key === 'ArrowUp' ? 1 : -1);
      return;
    }
    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      if (primary === null || !deps.hasAudio()) return;
      if (deps.isPlayingIndex(primary)) deps.onRequestStop();
      else deps.onRequestPlay(primary);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      inspectorEl.querySelector<HTMLTextAreaElement>('[data-timeline-text]')?.focus();
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      const indices = deps.getSelectedIndices();
      if (indices.length === 0) return;
      deps.onRequestDelete(indices);
      announce(indices.length > 1 ? `${indices.length} cues deleted` : 'Cue deleted');
    }
  }

  trackEl.addEventListener('pointerdown', onTrackPointerDown);
  trackEl.addEventListener('pointermove', onTrackPointerMove);
  trackEl.addEventListener('pointerup', onTrackPointerUp);
  trackEl.addEventListener('pointercancel', onTrackPointerUp);
  inspectorEl.addEventListener('input', onInspectorInput);
  inspectorEl.addEventListener('change', onInspectorChange);
  inspectorEl.addEventListener('click', onInspectorClick);
  rulerEl.addEventListener('pointerdown', onRulerPointerDown);
  rulerEl.addEventListener('pointermove', onRulerPointerMove);
  rulerEl.addEventListener('pointerup', onRulerPointerUp);
  rulerEl.addEventListener('pointercancel', onRulerPointerUp);
  lanesEl.addEventListener('wheel', onLanesWheel, { passive: false });
  minimapEl.addEventListener('pointerdown', onMinimapPointerDown);
  minimapEl.addEventListener('pointermove', onMinimapPointerMove);
  minimapEl.addEventListener('pointerup', onMinimapPointerUp);
  minimapEl.addEventListener('pointercancel', onMinimapPointerUp);
  transportPlayBtn.addEventListener('click', onTransportPlayClick);
  zoomFitBtn.addEventListener('click', onZoomFit);
  zoomSelBtn.addEventListener('click', onZoomSelection);
  zoomOutBtn.addEventListener('click', onZoomOut);
  zoomInBtn.addEventListener('click', onZoomIn);
  zoomSliderEl.addEventListener('input', onZoomSlider);
  addBtn.addEventListener('click', onAddClick);
  trackEl.addEventListener('keydown', onTrackKeyDown);
  inspectorEl.addEventListener('focusin', onInspectorFocusIn);
  document.addEventListener('keydown', onDocKeyDown, true);

  const resizeObserver = new ResizeObserver(() => render());
  resizeObserver.observe(trackEl);

  return {
    render,
    setPlayheadSeconds,
    beginPlaybackSweep,
    endPlaybackSweep,
    resetView(): void {
      userWindow = null;
      lensDrag = null;
      pendingSelect = null;
      setPlayheadSeconds(null);
    },
    refreshCueState(index: number): void {
      // Async fit results land here — in-place updates only, never a rebuild
      // (a full render would steal focus from the inspector textarea).
      updateBarDom(index);
      updateInspectorFit(index);
    },
    dispose(): void {
      endPlaybackSweep();
      stopAutoPan();
      document.removeEventListener('keydown', onDocKeyDown, true);
      resizeObserver.disconnect();
      trackEl.removeEventListener('pointerdown', onTrackPointerDown);
      trackEl.removeEventListener('pointermove', onTrackPointerMove);
      trackEl.removeEventListener('pointerup', onTrackPointerUp);
      trackEl.removeEventListener('pointercancel', onTrackPointerUp);
      inspectorEl.removeEventListener('input', onInspectorInput);
      inspectorEl.removeEventListener('change', onInspectorChange);
      inspectorEl.removeEventListener('click', onInspectorClick);
      rulerEl.removeEventListener('pointerdown', onRulerPointerDown);
      rulerEl.removeEventListener('pointermove', onRulerPointerMove);
      rulerEl.removeEventListener('pointerup', onRulerPointerUp);
      rulerEl.removeEventListener('pointercancel', onRulerPointerUp);
      lanesEl.removeEventListener('wheel', onLanesWheel);
      minimapEl.removeEventListener('pointerdown', onMinimapPointerDown);
      minimapEl.removeEventListener('pointermove', onMinimapPointerMove);
      minimapEl.removeEventListener('pointerup', onMinimapPointerUp);
      minimapEl.removeEventListener('pointercancel', onMinimapPointerUp);
      transportPlayBtn.removeEventListener('click', onTransportPlayClick);
      zoomFitBtn.removeEventListener('click', onZoomFit);
      zoomSelBtn.removeEventListener('click', onZoomSelection);
      zoomOutBtn.removeEventListener('click', onZoomOut);
      zoomInBtn.removeEventListener('click', onZoomIn);
      zoomSliderEl.removeEventListener('input', onZoomSlider);
      addBtn.removeEventListener('click', onAddClick);
      trackEl.removeEventListener('keydown', onTrackKeyDown);
      inspectorEl.removeEventListener('focusin', onInspectorFocusIn);
    },
  };
}
