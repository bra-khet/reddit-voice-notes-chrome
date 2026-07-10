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

export interface TimelineEditorDeps {
  getSegments(): TranscriptSegment[];
  getSelectedIndex(): number | null;
  getClipDurationSeconds(): number | null;
  getFps(): number;
  onSelect(index: number | null): void;
  onRequestPlay(index: number): void;
  onRequestStop(): void;
  isPlayingIndex(index: number): boolean;
  hasAudio(): boolean;
  /** Write a timing edit back to the host draft (host owns the array). */
  onCommitTiming(index: number, startSeconds: number, endSeconds: number): void;
  /** Write a text edit back to the host draft (host applies the blank→scaffold rule). */
  onCommitText(index: number, text: string): void;
  /** Has this cue changed since the editor opened? (drives the dirty bar state) */
  isDirtyIndex(index: number): boolean;
}

export interface TimelineEditorHandle {
  render(): void;
  setPlayheadSeconds(seconds: number | null): void;
  beginPlaybackSweep(startSeconds: number, endSeconds: number): void;
  endPlaybackSweep(): void;
  /** Reset zoom/pan to fit + clear the playhead (host calls on modal open). */
  resetView(): void;
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
    if (index === deps.getSelectedIndex()) classes.push('studio__cue-bar--selected');
    if (deps.isDirtyIndex(index)) classes.push('studio__cue-bar--dirty');
    if (cueTextIsBlank(segment.text)) classes.push('studio__cue-bar--scaffold');
    if (clip !== null && segmentHasOutOfBoundsEnd(segment, clip)) classes.push('studio__cue-bar--oob');
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
    return `
      <span class="studio__cue-bar-handle studio__cue-bar-handle--start" data-cue-handle="start" aria-hidden="true"></span>
      <span class="studio__cue-bar-body">
        <span class="studio__cue-bar-label">${index + 1}</span>
        <span class="studio__cue-bar-text">${preview}</span>
      </span>
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
        <button
          type="button"
          class="studio__transcript-cue-play"
          data-timeline-play
          aria-pressed="${playing ? 'true' : 'false'}"
          ${canPlay ? '' : 'disabled'}
          aria-label="${playing ? 'Stop cue preview' : 'Play cue preview'}"
        >${playing ? '■' : '▶'}</button>
      </div>
      <textarea
        class="studio__cue-timeline-inspector-text"
        rows="2"
        data-timeline-text
        aria-label="Cue text"
      >${text}</textarea>
    `;
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
      if (capEl) capEl.hidden = true;
      return;
    }
    const px = windowSecondsToPx(playheadSeconds, wv);
    if (px < -1 || px > wv.trackWidthPx + 1) {
      playheadEl.hidden = true; // playhead is outside the zoomed window
      if (capEl) capEl.hidden = true;
      return;
    }
    playheadEl.hidden = false;
    playheadEl.style.transform = `translateX(${px.toFixed(2)}px)`;
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
    // Selected cue reads amber in the overview — "where am I" at a glance
    // (mirrors the selected bar treatment; user-requested after Sprint-4 QA).
    const selectedIndex = deps.getSelectedIndex();
    minimapHeatEl.innerHTML = segments
      .map((segment, index) => {
        const startSec = Math.max(0, Math.min(segment.start, segment.end));
        const left = (startSec / fullDurationSeconds) * 100;
        const width = (Math.abs(segment.end - segment.start) / fullDurationSeconds) * 100;
        const cls =
          index === selectedIndex ? ' class="studio__cue-timeline-minimap-cue--selected"' : '';
        return `<span${cls} style="left:${left.toFixed(2)}%;width:${Math.max(0.4, width).toFixed(2)}%"></span>`;
      })
      .join('');
    const lens = minimapLens(wv.window, fullDurationSeconds, minimapEl.clientWidth);
    lensEl.style.transform = `translateX(${lens.leftPx.toFixed(2)}px)`;
    lensEl.style.width = `${Math.max(8, lens.widthPx).toFixed(2)}px`;
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
      renderInspector(segments);
      updateTransport();
      return;
    }
    emptyEl.hidden = true;
    if (fullDurationSeconds <= 0 || trackWidthPx <= 0) return; // ResizeObserver re-fires when shown

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

    if (deps.getSelectedIndex() !== index) {
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
    drag.moved = true;

    applyDragAt(event.clientX, event.shiftKey);
    maybeAutoPan();
  }

  function onTrackPointerUp(event: PointerEvent): void {
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
    const playBtn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-timeline-play]');
    if (!playBtn || playBtn.disabled) return;
    const index = deps.getSelectedIndex();
    if (index === null) return;
    if (deps.isPlayingIndex(index)) deps.onRequestStop();
    else deps.onRequestPlay(index);
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
    const index = deps.getSelectedIndex();
    const segment = index !== null ? deps.getSegments()[index] : undefined;
    if (!segment) return;
    setWindow(windowForSpan(segment.start, segment.end, fullDurationSeconds, minWin()));
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
      setPlayheadSeconds(null);
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
    },
  };
}
