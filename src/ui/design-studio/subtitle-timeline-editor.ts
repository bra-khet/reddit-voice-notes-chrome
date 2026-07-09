/**
 * v5.8.0 — Timeline visual subtitle editor (Sprint 2: read-only foundation).
 *
 * The spatial view of the cue draft: a time ruler, cue bars positioned by
 * start / sized by duration, a playhead, and click-to-select. Sprint 2 is
 * render + selection + a playhead the cuePlayer drives via an elapsed-time
 * sweep (the cue player has no currentTime — it plays a fixed [start,end]
 * window). Drag/resize, live badges, and the full inspector land in later
 * sprints; the host still owns the `draft` and all mutations.
 *
 * Substrate: DOM + CSS transforms (design §3B) so the existing semiotic DOM,
 * a11y, and cuePlayer wiring port directly. Geometry is delegated to the pure
 * timeline-geometry.ts; frame math (later, for snapping) to timeline.ts.
 *
 * Sync: subtitle-segment-editor.ts (host: mounts, owns draft + selection),
 *       timeline-geometry.ts (layout/hit/snap), style.css (.studio__cue-timeline*)
 */

import type { TranscriptSegment } from '@/src/transcription/types';
import { cueTextIsBlank, formatCueTimestamp, stripScaffoldPlaceholder } from '@/src/transcription/transcript-editing';
import { segmentHasOutOfBoundsEnd } from '@/src/transcription/segment-timing';
import {
  generateRulerTicks,
  layoutBars,
  pxToSeconds,
  secondsToPx,
  type TimelineViewport,
} from '@/src/ui/design-studio/timeline-geometry';

/** Fallback compositing fps (matches the overlay backbone). Used for snapping in Sprint 3. */
export const TIMELINE_DEFAULT_FPS = 24;

export interface TimelineEditorDeps {
  getSegments(): TranscriptSegment[];
  getSelectedIndex(): number | null;
  getClipDurationSeconds(): number | null;
  onSelect(index: number | null): void;
  /** Ask the host to preview a cue via the shared cuePlayer (host then sweeps the playhead). */
  onRequestPlay(index: number): void;
  onRequestStop(): void;
  isPlayingIndex(index: number): boolean;
  hasAudio(): boolean;
}

export interface TimelineEditorHandle {
  /** Full re-render from current host state (segments, selection, clip). */
  render(): void;
  /** Position the playhead (null hides it). */
  setPlayheadSeconds(seconds: number | null): void;
  /** Begin a cuePlayer-driven elapsed-time sweep across [start,end]. */
  beginPlaybackSweep(startSeconds: number, endSeconds: number): void;
  /** End the sweep and hide the playhead. */
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
  let playheadSeconds: number | null = null;
  let sweepRaf = 0;

  function resolveDuration(segments: TranscriptSegment[], clip: number | null): number {
    let maxEnd = 0;
    for (const segment of segments) {
      if (Number.isFinite(segment.end) && segment.end > maxEnd) maxEnd = segment.end;
    }
    return Math.max(clip ?? 0, maxEnd, 0);
  }

  function barStateClasses(segment: TranscriptSegment, index: number, clip: number | null): string {
    const classes: string[] = ['studio__cue-bar'];
    if (index === deps.getSelectedIndex()) classes.push('studio__cue-bar--selected');
    if (cueTextIsBlank(segment.text)) classes.push('studio__cue-bar--scaffold');
    if (clip !== null && segmentHasOutOfBoundsEnd(segment, clip)) classes.push('studio__cue-bar--oob');
    if (deps.isPlayingIndex(index)) classes.push('studio__cue-bar--playing');
    return classes.join(' ');
  }

  function renderRuler(): void {
    const ticks = generateRulerTicks(viewport);
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
    const existing = trackEl.querySelector('[data-timeline-clip-end]');
    if (existing) existing.remove();
    if (clip === null || clip >= viewport.durationSeconds - 1e-6) return;
    const marker = document.createElement('div');
    marker.className = 'studio__cue-timeline-clip-end';
    marker.dataset.timelineClipEnd = '';
    marker.title = 'Recording length';
    marker.style.transform = `translateX(${secondsToPx(clip, viewport).toFixed(2)}px)`;
    trackEl.append(marker);
  }

  function renderBars(segments: TranscriptSegment[], clip: number | null): void {
    // Remove old bars but keep the persistent playhead node.
    trackEl.querySelectorAll('[data-cue-index]').forEach((node) => node.remove());
    const bars = layoutBars(
      segments.map((segment) => ({ start: segment.start, end: segment.end })),
      viewport,
    );
    const html = bars
      .map((bar, index) => {
        const segment = segments[index];
        const stripped = stripScaffoldPlaceholder(segment.text).trim();
        const preview = escapeHtml(stripped || '(empty)');
        const selected = index === deps.getSelectedIndex();
        return `
          <div
            class="${barStateClasses(segment, index, clip)}"
            data-cue-index="${index}"
            role="option"
            aria-selected="${selected ? 'true' : 'false'}"
            style="transform:translateX(${bar.leftPx.toFixed(2)}px);width:${bar.widthPx.toFixed(2)}px"
            title="Cue ${index + 1}: ${formatCueTimestamp(segment.start)} → ${formatCueTimestamp(segment.end)}"
          >
            <span class="studio__cue-bar-handle studio__cue-bar-handle--start" data-cue-handle="start" aria-hidden="true"></span>
            <span class="studio__cue-bar-body">
              <span class="studio__cue-bar-label">${index + 1}</span>
              <span class="studio__cue-bar-text">${preview}</span>
            </span>
            <span class="studio__cue-bar-handle studio__cue-bar-handle--end" data-cue-handle="end" aria-hidden="true"></span>
          </div>
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
    inspectorEl.hidden = false;
    // Sprint 2: read-only summary + cuePlayer preview. Numeric/text editing lands in Sprint 3.
    inspectorEl.innerHTML = `
      <span class="studio__cue-timeline-inspector-label">Cue ${index + 1}</span>
      <span class="studio__cue-timeline-inspector-range">${escapeHtml(
        `${formatCueTimestamp(segment.start)} → ${formatCueTimestamp(segment.end)}`,
      )}</span>
      <button
        type="button"
        class="studio__transcript-cue-play"
        data-timeline-play
        aria-pressed="${playing ? 'true' : 'false'}"
        ${canPlay ? '' : 'disabled'}
        aria-label="${playing ? 'Stop cue preview' : 'Play cue preview'}"
      >${playing ? '■' : '▶'}</button>
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
    const clip = deps.getClipDurationSeconds();
    const durationSeconds = resolveDuration(segments, clip);
    const trackWidthPx = trackEl.clientWidth;

    if (segments.length === 0) {
      emptyEl.hidden = false;
      rulerEl.innerHTML = '';
      trackEl.querySelectorAll('[data-cue-index]').forEach((node) => node.remove());
      renderInspector(segments);
      return;
    }
    emptyEl.hidden = true;

    // Width can be 0 while the container is hidden/animating; the ResizeObserver re-fires.
    if (durationSeconds <= 0 || trackWidthPx <= 0) return;

    viewport = { durationSeconds, trackWidthPx };
    renderRuler();
    renderBars(segments, clip);
    renderClipEndMarker(clip);
    renderInspector(segments);
    applyPlayhead();
  }

  // ── Interactions (Sprint 2: select + ruler scrub + preview) ───────────────

  function onTrackClick(event: MouseEvent): void {
    const playBtn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-timeline-play]');
    if (playBtn) return; // handled by inspector listener
    const barEl = (event.target as HTMLElement).closest<HTMLElement>('[data-cue-index]');
    if (!barEl) return;
    const index = Number(barEl.dataset.cueIndex);
    if (!Number.isFinite(index)) return;
    deps.onSelect(index);
    render();
  }

  function onInspectorClick(event: MouseEvent): void {
    const playBtn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-timeline-play]');
    if (!playBtn || playBtn.disabled) return;
    const index = deps.getSelectedIndex();
    if (index === null) return;
    if (deps.isPlayingIndex(index)) deps.onRequestStop();
    else deps.onRequestPlay(index);
  }

  // Ruler scrub — moves the playhead marker (the cue player can't seek, so this is
  // a visual scrub / future-scrub anchor, not an audio seek).
  let scrubbing = false;
  function scrubToClientX(clientX: number): void {
    if (viewport.trackWidthPx <= 0) return;
    const rect = rulerEl.getBoundingClientRect();
    const seconds = pxToSeconds(clientX - rect.left, viewport);
    setPlayheadSeconds(seconds);
  }
  function onRulerPointerDown(event: PointerEvent): void {
    scrubbing = true;
    rulerEl.setPointerCapture(event.pointerId);
    scrubToClientX(event.clientX);
  }
  function onRulerPointerMove(event: PointerEvent): void {
    if (!scrubbing) return;
    scrubToClientX(event.clientX);
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
    const startedAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const tick = (): void => {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const elapsed = (now - startedAt) / 1000;
      const at = startSeconds + Math.min(elapsed, span);
      setPlayheadSeconds(at);
      if (elapsed < span) sweepRaf = requestAnimationFrame(tick);
      else sweepRaf = 0;
    };
    setPlayheadSeconds(startSeconds);
    sweepRaf = requestAnimationFrame(tick);
  }

  function endPlaybackSweep(): void {
    if (sweepRaf) cancelAnimationFrame(sweepRaf);
    sweepRaf = 0;
    setPlayheadSeconds(null);
  }

  trackEl.addEventListener('click', onTrackClick);
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
      trackEl.removeEventListener('click', onTrackClick);
      inspectorEl.removeEventListener('click', onInspectorClick);
      rulerEl.removeEventListener('pointerdown', onRulerPointerDown);
      rulerEl.removeEventListener('pointermove', onRulerPointerMove);
      rulerEl.removeEventListener('pointerup', onRulerPointerUp);
      rulerEl.removeEventListener('pointercancel', onRulerPointerUp);
    },
  };
}
