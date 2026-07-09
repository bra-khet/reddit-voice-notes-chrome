/**
 * v5.8.0 — Timeline visual subtitle editor (Sprint 3: drag / resize / inspector).
 *
 * The spatial view of the cue draft: a time ruler, cue bars positioned by
 * start / sized by duration, a playhead, click-to-select, body-drag to move,
 * edge-handle resize, and a live two-way inspector. Timing is frame-snapped
 * with magnetism (neighbor edge > playhead > tick) and clamped so cues touch
 * but never overlap (clamp-to-neighbor policy). The host still owns the draft:
 * the component reads it via deps and writes edits back through deps — it never
 * mutates the array itself, so the list view and the bake pipeline stay in sync.
 *
 * Substrate: DOM + CSS transforms (design §3B). Geometry/constraints are the
 * pure timeline-geometry.ts; frame math is timeline.ts (preview=bake, I11).
 *
 * Sync: subtitle-segment-editor.ts (host: mounts, owns draft + selection),
 *       timeline-geometry.ts (layout/hit/snap/constrain), style.css
 */

import type { TranscriptSegment } from '@/src/transcription/types';
import { cueTextIsBlank, formatCueTimestamp, stripScaffoldPlaceholder } from '@/src/transcription/transcript-editing';
import { segmentHasOutOfBoundsEnd } from '@/src/transcription/segment-timing';
import {
  constrainMove,
  constrainResizeEnd,
  constrainResizeStart,
  generateRulerTicks,
  layoutBar,
  layoutBars,
  pxDeltaToSeconds,
  pxToSeconds,
  resolveSnap,
  secondsToPx,
  type CueEditContext,
  type TimelineViewport,
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
      <div class="studio__cue-timeline-ruler" data-timeline-ruler aria-hidden="true"></div>
      <div
        class="studio__cue-timeline-track"
        data-timeline-track
        role="listbox"
        aria-label="Subtitle cue timeline"
        tabindex="0"
      >
        <div class="studio__cue-timeline-playhead" data-timeline-playhead hidden></div>
      </div>
      <div class="studio__cue-timeline-inspector" data-timeline-inspector hidden></div>
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
  const rulerEl = container.querySelector<HTMLElement>('[data-timeline-ruler]')!;
  const trackEl = container.querySelector<HTMLElement>('[data-timeline-track]')!;
  const playheadEl = container.querySelector<HTMLElement>('[data-timeline-playhead]')!;
  const inspectorEl = container.querySelector<HTMLElement>('[data-timeline-inspector]')!;
  const emptyEl = container.querySelector<HTMLElement>('[data-timeline-empty]')!;

  let viewport: TimelineViewport = { durationSeconds: 0, trackWidthPx: 0 };
  let clipCache: number | null = null;
  let tickSecondsCache: number[] = [];
  let playheadSeconds: number | null = null;
  let sweepRaf = 0;
  let drag: DragState | null = null;

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
    let nextStartSeconds = viewport.durationSeconds;
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
    return classes.join(' ');
  }

  function renderRuler(): void {
    const ticks = generateRulerTicks(viewport);
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
  }

  function renderClipEndMarker(clip: number | null): void {
    trackEl.querySelector('[data-timeline-clip-end]')?.remove();
    if (clip === null || clip >= viewport.durationSeconds - 1e-6) return;
    const marker = document.createElement('div');
    marker.className = 'studio__cue-timeline-clip-end';
    marker.dataset.timelineClipEnd = '';
    marker.title = 'Recording length';
    marker.style.transform = `translateX(${secondsToPx(clip, viewport).toFixed(2)}px)`;
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
    const bars = layoutBars(
      segments.map((segment) => ({ start: segment.start, end: segment.end })),
      viewport,
    );
    const html = bars
      .map((bar, index) => {
        const segment = segments[index];
        const selected = index === deps.getSelectedIndex();
        return `
          <div
            class="${barStateClasses(segment, index, clip)}"
            data-cue-index="${index}"
            role="option"
            aria-selected="${selected ? 'true' : 'false'}"
            style="transform:translateX(${bar.leftPx.toFixed(2)}px);width:${bar.widthPx.toFixed(2)}px"
            title="Cue ${index + 1}: ${formatCueTimestamp(segment.start)} → ${formatCueTimestamp(segment.end)}"
          >${barInnerHtml(segment, index)}</div>
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
      return;
    }
    const segment = segments[index];
    const playing = deps.isPlayingIndex(index);
    const canPlay = deps.hasAudio();
    const text = escapeHtml(stripScaffoldPlaceholder(segment.text));
    inspectorEl.hidden = false;
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

  function applyPlayhead(): void {
    if (playheadSeconds === null || viewport.durationSeconds <= 0) {
      playheadEl.hidden = true;
      return;
    }
    playheadEl.hidden = false;
    playheadEl.style.transform = `translateX(${secondsToPx(playheadSeconds, viewport).toFixed(2)}px)`;
  }

  function render(): void {
    const segments = deps.getSegments();
    clipCache = deps.getClipDurationSeconds();
    const durationSeconds = resolveDuration(segments, clipCache);
    const trackWidthPx = trackEl.clientWidth;

    if (segments.length === 0) {
      emptyEl.hidden = false;
      rulerEl.innerHTML = '';
      trackEl.querySelectorAll('[data-cue-index]').forEach((node) => node.remove());
      renderInspector(segments);
      return;
    }
    emptyEl.hidden = true;
    if (durationSeconds <= 0 || trackWidthPx <= 0) return; // ResizeObserver re-fires when shown

    viewport = { durationSeconds, trackWidthPx };
    renderRuler();
    renderBars(segments, clipCache);
    renderClipEndMarker(clipCache);
    renderInspector(segments);
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
    const bar = layoutBar({ start: segment.start, end: segment.end }, index, viewport);
    barEl.style.transform = `translateX(${bar.leftPx.toFixed(2)}px)`;
    barEl.style.width = `${bar.widthPx.toFixed(2)}px`;
    barEl.className = barStateClasses(segment, index, clipCache);
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
    const neighborTol = pxDeltaToSeconds(NEIGHBOR_MAGNET_PX, viewport);
    const softTol = pxDeltaToSeconds(SOFT_MAGNET_PX, viewport);
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
    };
    try {
      trackEl.setPointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  }

  function onTrackPointerMove(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startClientX;
    const dy = event.clientY - drag.startClientY;

    if (Math.abs(dy) > VERTICAL_TOLERANCE_PX) {
      drag.suspended = true; // drop the drag but keep capture — re-acquire on return
      return;
    }
    drag.suspended = false;
    if (!drag.moved && Math.abs(dx) < CLICK_SLOP_PX) return;
    drag.moved = true;

    const deltaSeconds = pxDeltaToSeconds(dx, viewport);
    let start = drag.origStart;
    let end = drag.origEnd;

    if (drag.zone === 'start') {
      const raw = snapValue(drag.origStart + deltaSeconds, [drag.ctx.prevEndSeconds], event.shiftKey);
      start = constrainResizeStart(raw, drag.origEnd, drag.ctx);
    } else if (drag.zone === 'end') {
      const raw = snapValue(drag.origEnd + deltaSeconds, [drag.ctx.nextStartSeconds], event.shiftKey);
      end = constrainResizeEnd(drag.origStart, raw, drag.ctx);
    } else {
      const raw = snapValue(
        drag.origStart + deltaSeconds,
        [drag.ctx.prevEndSeconds, drag.ctx.nextStartSeconds - drag.origDuration],
        event.shiftKey,
      );
      const moved = constrainMove(raw, drag.origDuration, drag.ctx);
      start = moved.start;
      end = moved.end;
    }

    deps.onCommitTiming(drag.index, start, end);
    updateBarDom(drag.index);
    updateInspectorFields(drag.index);
  }

  function onTrackPointerUp(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) return;
    try {
      trackEl.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    const moved = drag.moved;
    drag = null;
    if (moved) render(); // reconcile dirty state + inspector after the gesture
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
    if (viewport.trackWidthPx <= 0) return;
    const rect = rulerEl.getBoundingClientRect();
    setPlayheadSeconds(pxToSeconds(clientX - rect.left, viewport));
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

  const resizeObserver = new ResizeObserver(() => render());
  resizeObserver.observe(trackEl);

  return {
    render,
    setPlayheadSeconds,
    beginPlaybackSweep,
    endPlaybackSweep,
    dispose(): void {
      endPlaybackSweep();
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
    },
  };
}
