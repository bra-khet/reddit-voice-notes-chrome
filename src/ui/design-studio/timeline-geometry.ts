/**
 * v5.8.0 — Timeline editor view geometry (pure).
 *
 * The pixel-space companion to src/timeline/timeline.ts: maps clip seconds ↔
 * track pixels, lays out cue bars, generates ruler ticks, resolves pointer
 * hit-zones (16 px edge handles with deterministic fight-priority), and resolves
 * drag snapping against the authoritative magnetism priority.
 *
 * ALL frame/second quantization delegates to timeline.ts `snapTimeToFrame` so a
 * dragged cue lands on the exact frame the overlay painter will render it at
 * (preview=bake, invariant I11) — this module never invents its own frame math.
 * Pixel geometry is a throwaway view concern; frame time is the real quantum.
 *
 * Pure logic — no DOM, no browser globals. Node-tested
 * (scripts/test-timeline-geometry.mjs). Leaf: one import (timeline.ts).
 *
 * Sync: subtitle-timeline-editor.ts (sole consumer),
 *       docs/v5.8.0-trim-ui-visual-subtitle-editor.md §5 (anatomy) + §6 (interactions)
 */

import { snapTimeToFrame } from '@/src/timeline/timeline';

/** Minimum on-screen width so a very short cue stays visible and grabbable. */
export const MIN_BAR_WIDTH_PX = 12;

/** Resize-handle hit width at each bar edge (design §6.1.1, authoritative). */
export const EDGE_HANDLE_PX = 16;

/** The track's pixel viewport. t=0 maps to x=0; durationSeconds maps to trackWidthPx. */
export interface TimelineViewport {
  durationSeconds: number;
  trackWidthPx: number;
}

/** Minimal cue shape geometry needs — deliberately decoupled from TranscriptSegment. */
export interface CueSpanLike {
  start: number;
  end: number;
}

function isPositive(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}

/** Seconds → track x-pixels (0 when the viewport is degenerate), clamped to bounds. */
export function secondsToPx(seconds: number, vp: TimelineViewport): number {
  if (!isPositive(vp.durationSeconds) || !isPositive(vp.trackWidthPx)) return 0;
  const clamped = Math.max(0, Math.min(vp.durationSeconds, seconds));
  return (clamped / vp.durationSeconds) * vp.trackWidthPx;
}

/** Track x-pixels → seconds (0 when degenerate), clamped to [0, duration]. */
export function pxToSeconds(px: number, vp: TimelineViewport): number {
  if (!isPositive(vp.durationSeconds) || !isPositive(vp.trackWidthPx)) return 0;
  const clamped = Math.max(0, Math.min(vp.trackWidthPx, px));
  return (clamped / vp.trackWidthPx) * vp.durationSeconds;
}

/** A pixel delta → a seconds delta (no bound clamping — for tolerances/nudges). */
export function pxDeltaToSeconds(px: number, vp: TimelineViewport): number {
  if (!isPositive(vp.durationSeconds) || !isPositive(vp.trackWidthPx)) return 0;
  return (px / vp.trackWidthPx) * vp.durationSeconds;
}

/** Clamp a time to the viewport's [0, duration]. */
export function clampSeconds(seconds: number, vp: TimelineViewport): number {
  const max = isPositive(vp.durationSeconds) ? vp.durationSeconds : 0;
  if (!Number.isFinite(seconds)) return 0;
  return Math.max(0, Math.min(max, seconds));
}

// ── Bar layout ────────────────────────────────────────────────────────────

export interface BarLayout {
  index: number;
  startSeconds: number;
  endSeconds: number;
  leftPx: number;
  /** Rendered width — floored at MIN_BAR_WIDTH_PX so tiny cues stay visible. */
  widthPx: number;
  /** True geometric width before the min-width floor (for gap/adjacency math). */
  rawWidthPx: number;
}

/** Lay out one cue span. Inverted spans (start > end) are normalized. */
export function layoutBar(cue: CueSpanLike, index: number, vp: TimelineViewport): BarLayout {
  const startSeconds = Math.max(0, Math.min(cue.start, cue.end));
  const endSeconds = Math.max(cue.start, cue.end);
  const leftPx = secondsToPx(startSeconds, vp);
  const rightPx = secondsToPx(endSeconds, vp);
  const rawWidthPx = Math.max(0, rightPx - leftPx);
  const widthPx = Math.max(MIN_BAR_WIDTH_PX, rawWidthPx);
  return { index, startSeconds, endSeconds, leftPx, widthPx, rawWidthPx };
}

export function layoutBars(cues: readonly CueSpanLike[], vp: TimelineViewport): BarLayout[] {
  return cues.map((cue, index) => layoutBar(cue, index, vp));
}

// ── Ruler ticks ───────────────────────────────────────────────────────────

/** "Nice" major-tick intervals (seconds) — the label cadence steps up through these. */
export const NICE_INTERVALS_SECONDS = [0.5, 1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600];

/** Pick the smallest nice interval that keeps majors ≥ targetMajorSpacingPx apart. */
export function chooseTickInterval(
  durationSeconds: number,
  trackWidthPx: number,
  targetMajorSpacingPx = 90,
): number {
  if (!isPositive(durationSeconds) || !isPositive(trackWidthPx)) return NICE_INTERVALS_SECONDS[0];
  const targetMajors = Math.max(1, Math.floor(trackWidthPx / targetMajorSpacingPx));
  const rawInterval = durationSeconds / targetMajors;
  for (const nice of NICE_INTERVALS_SECONDS) {
    if (nice >= rawInterval) return nice;
  }
  return NICE_INTERVALS_SECONDS[NICE_INTERVALS_SECONDS.length - 1];
}

function minorSubdivisions(intervalSeconds: number): number {
  if (intervalSeconds >= 60) return 4;
  if (intervalSeconds >= 15) return 3;
  if (intervalSeconds >= 5) return 5;
  if (intervalSeconds >= 1) return 4;
  return 5;
}

export interface RulerTick {
  seconds: number;
  px: number;
  major: boolean;
  label: string | null;
}

function formatRulerLabel(seconds: number, intervalSeconds: number): string {
  const safe = Math.max(0, seconds);
  const whole = Math.floor(safe);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  let base = hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
  if (intervalSeconds < 1) base += `.${Math.round((safe - whole) * 10)}`;
  return base;
}

/**
 * Ruler ticks across the viewport. Every `subdiv`-th minor tick is a labeled
 * major. Index-based stepping avoids float drift. Positions are frame-agnostic
 * (cosmetic); the clip-end marker is drawn separately by the component.
 */
export function generateRulerTicks(
  vp: TimelineViewport,
  options?: { targetMajorSpacingPx?: number },
): RulerTick[] {
  if (!isPositive(vp.durationSeconds) || !isPositive(vp.trackWidthPx)) return [];
  const major = chooseTickInterval(vp.durationSeconds, vp.trackWidthPx, options?.targetMajorSpacingPx);
  const subdiv = minorSubdivisions(major);
  const minor = major / subdiv;
  const count = Math.floor(vp.durationSeconds / minor + minor / 1000);
  const ticks: RulerTick[] = [];
  for (let i = 0; i <= count; i += 1) {
    const seconds = Math.min(i * minor, vp.durationSeconds);
    const isMajor = i % subdiv === 0;
    ticks.push({
      seconds,
      px: secondsToPx(seconds, vp),
      major: isMajor,
      label: isMajor ? formatRulerLabel(seconds, major) : null,
    });
  }
  return ticks;
}

// ── Hit testing ───────────────────────────────────────────────────────────

export type BarHitZone = 'start-handle' | 'end-handle' | 'body';

export interface TrackHit {
  index: number;
  zone: BarHitZone;
}

/** Per-bar handle width, clamped so both handles stay resolvable on narrow bars. */
export function handleWidthForBar(bar: BarLayout): number {
  return Math.max(2, Math.min(EDGE_HANDLE_PX, Math.floor(bar.widthPx / 2)));
}

/**
 * What does a pointer at absolute track-x hit? 16 px edge handles win over the
 * body; when adjacent bars' handles overlap, the NEAREST boundary wins (ties →
 * start-handle, for predictable grow-into-gap) so a "fight" is never ambiguous
 * (design §6.1.1). Body fallback picks the last (top-most) bar containing x.
 */
export function hitTestTrack(trackXpx: number, bars: readonly BarLayout[]): TrackHit | null {
  const candidates: { index: number; zone: BarHitZone; dist: number; pri: number }[] = [];
  for (const bar of bars) {
    const left = bar.leftPx;
    const right = bar.leftPx + bar.widthPx;
    const hw = handleWidthForBar(bar);
    if (trackXpx >= left && trackXpx <= left + hw) {
      candidates.push({ index: bar.index, zone: 'start-handle', dist: trackXpx - left, pri: 0 });
    }
    if (trackXpx >= right - hw && trackXpx <= right) {
      candidates.push({ index: bar.index, zone: 'end-handle', dist: right - trackXpx, pri: 1 });
    }
  }
  if (candidates.length > 0) {
    candidates.sort((a, b) => a.dist - b.dist || a.pri - b.pri);
    return { index: candidates[0].index, zone: candidates[0].zone };
  }
  let body: TrackHit | null = null;
  for (const bar of bars) {
    if (trackXpx > bar.leftPx && trackXpx < bar.leftPx + bar.widthPx) {
      body = { index: bar.index, zone: 'body' };
    }
  }
  return body;
}

// ── Snap resolution ───────────────────────────────────────────────────────

export type SnapKind = 'neighbor' | 'playhead' | 'tick' | 'frame';

export interface SnapContext {
  fps: number;
  /** Candidate neighbor cue edges (seconds) — highest-priority magnet. */
  neighborSeconds?: readonly number[];
  playheadSeconds?: number | null;
  tickSeconds?: readonly number[];
  /** Magnetism radius in seconds (caller derives from a px tolerance). */
  toleranceSeconds: number;
  /** Shift held — disable magnetism (1–3); frame quantization still applies. */
  disableMagnetism?: boolean;
}

export interface SnapResult {
  seconds: number;
  snappedTo: SnapKind;
}

function nearestWithin(
  value: number,
  candidates: readonly number[] | undefined,
  tol: number,
): number | null {
  if (!candidates || candidates.length === 0) return null;
  let best: number | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    if (!Number.isFinite(c)) continue;
    const d = Math.abs(c - value);
    if (d <= tol && d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Resolve a dragged time against the authoritative magnetism priority
 * (design §6.2): neighbor edge > playhead > tick > frame. Frame quantization
 * (snapTimeToFrame) ALWAYS applies as the final step, even under Shift, so the
 * result is a valid frame PTS (preview=bake). "Fine control" (Shift) means no
 * magnetic pull — not off-grid.
 */
export function resolveSnap(rawSeconds: number, ctx: SnapContext): SnapResult {
  const tol = Math.max(0, ctx.toleranceSeconds);
  if (!ctx.disableMagnetism) {
    const neighbor = nearestWithin(rawSeconds, ctx.neighborSeconds, tol);
    if (neighbor !== null) return { seconds: snapTimeToFrame(neighbor, ctx.fps), snappedTo: 'neighbor' };

    if (
      typeof ctx.playheadSeconds === 'number' &&
      Number.isFinite(ctx.playheadSeconds) &&
      Math.abs(ctx.playheadSeconds - rawSeconds) <= tol
    ) {
      return { seconds: snapTimeToFrame(ctx.playheadSeconds, ctx.fps), snappedTo: 'playhead' };
    }

    const tick = nearestWithin(rawSeconds, ctx.tickSeconds, tol);
    if (tick !== null) return { seconds: snapTimeToFrame(tick, ctx.fps), snappedTo: 'tick' };
  }
  return { seconds: snapTimeToFrame(rawSeconds, ctx.fps), snappedTo: 'frame' };
}

// ── Edit constraints (clamp-to-neighbor policy, design §6.1) ────────────────

/** Minimum editable cue duration — mirrors transcript-editing's editor floor. */
export const MIN_CUE_DURATION_SECONDS = 0.5;

/**
 * Neighbor + duration bounds for a single cue edit. `prevEndSeconds` is the left
 * neighbor's end (0 if none); `nextStartSeconds` is the right neighbor's start
 * (track duration if none). The clamp policy (authoritative, user-confirmed):
 * cues may touch a neighbor edge but never overlap it.
 */
export interface CueEditContext {
  prevEndSeconds: number;
  nextStartSeconds: number;
  minDurationSeconds?: number;
}

function clampValue(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/** Clamp a proposed START: never before the left neighbor's end, never within minDur of end. */
export function constrainResizeStart(
  rawStart: number,
  endSeconds: number,
  ctx: CueEditContext,
): number {
  const minDur = ctx.minDurationSeconds ?? MIN_CUE_DURATION_SECONDS;
  const lo = Math.max(0, ctx.prevEndSeconds);
  const hi = endSeconds - minDur;
  if (hi < lo) return lo; // bar smaller than minDur (degenerate) — pin to the floor
  return clampValue(rawStart, lo, hi);
}

/** Clamp a proposed END: never within minDur of start, never past the right neighbor's start. */
export function constrainResizeEnd(
  startSeconds: number,
  rawEnd: number,
  ctx: CueEditContext,
): number {
  const minDur = ctx.minDurationSeconds ?? MIN_CUE_DURATION_SECONDS;
  const lo = startSeconds + minDur;
  const hi = ctx.nextStartSeconds;
  if (hi < lo) return lo;
  return clampValue(rawEnd, lo, hi);
}

/** Clamp a whole-bar MOVE (duration preserved) so it fits between its neighbors. */
export function constrainMove(
  rawStart: number,
  durationSeconds: number,
  ctx: CueEditContext,
): { start: number; end: number } {
  const lo = Math.max(0, ctx.prevEndSeconds);
  const hi = ctx.nextStartSeconds - durationSeconds;
  const start = hi < lo ? lo : clampValue(rawStart, lo, hi);
  return { start, end: start + durationSeconds };
}

// ── View window (zoom + pan), design §16.2 ──────────────────────────────────
// The visible slice of the clip. All Sprint-4+ sec↔px mapping goes through a
// WindowViewport so cue positions, ruler ticks, and snap tolerances stay
// window-relative — px-derived magnetism therefore scales with zoom for free.

/** The visible time slice [viewStart, viewEnd] of the full clip. */
export interface TimelineWindow {
  viewStartSeconds: number;
  viewEndSeconds: number;
}

/** Absolute floor on the visible window (seconds). */
export const MIN_WINDOW_SECONDS = 0.5;
/** Frame-count floor on the visible window (whichever is larger wins). */
export const MIN_WINDOW_FRAMES = 4;

/** Narrowest legal window: max(0.5 s, 4 frames) — the zoom cap (design §16.2). */
export function minWindowSeconds(fps: number): number {
  const frameFloor = isPositive(fps) ? MIN_WINDOW_FRAMES / fps : 0;
  return Math.max(MIN_WINDOW_SECONDS, frameFloor);
}

/** The 1× window: the whole clip. */
export function fitWindow(clipDurationSeconds: number): TimelineWindow {
  return { viewStartSeconds: 0, viewEndSeconds: Math.max(0, clipDurationSeconds) };
}

export function windowDurationSeconds(w: TimelineWindow): number {
  return Math.max(0, w.viewEndSeconds - w.viewStartSeconds);
}

/** Zoom factor z = clip / window (1 = fit; capped by minWindowSeconds upstream). */
export function windowZoomFactor(w: TimelineWindow, clipDurationSeconds: number): number {
  const dur = windowDurationSeconds(w);
  if (!isPositive(dur) || !isPositive(clipDurationSeconds)) return 1;
  return clipDurationSeconds / dur;
}

/** Normalize a window: duration into [minWindow, clip], position into [0, clip]. */
export function clampWindow(
  w: TimelineWindow,
  clipDurationSeconds: number,
  minWindow: number,
): TimelineWindow {
  const clip = Math.max(0, clipDurationSeconds);
  if (clip <= 0) return { viewStartSeconds: 0, viewEndSeconds: 0 };
  const minDur = Math.min(clip, Math.max(0, minWindow));
  let dur = windowDurationSeconds(w);
  if (!Number.isFinite(dur) || dur <= 0) dur = clip;
  dur = Math.max(minDur, Math.min(clip, dur));
  const rawStart = Number.isFinite(w.viewStartSeconds) ? w.viewStartSeconds : 0;
  const start = Math.max(0, Math.min(clip - dur, rawStart));
  return { viewStartSeconds: start, viewEndSeconds: start + dur };
}

/**
 * Zoom by `factor` (>1 = in) keeping `anchorSeconds` at the same relative x —
 * the time under the cursor stays under the cursor (anchored Ctrl+wheel zoom).
 */
export function zoomWindowAt(
  w: TimelineWindow,
  factor: number,
  anchorSeconds: number,
  clipDurationSeconds: number,
  minWindow: number,
): TimelineWindow {
  const dur = windowDurationSeconds(w);
  if (!isPositive(dur) || !isPositive(factor)) return clampWindow(w, clipDurationSeconds, minWindow);
  const newDur = dur / factor;
  const rel = (anchorSeconds - w.viewStartSeconds) / dur;
  const start = anchorSeconds - rel * newDur;
  return clampWindow(
    { viewStartSeconds: start, viewEndSeconds: start + newDur },
    clipDurationSeconds,
    minWindow,
  );
}

/** Shift the window by a time delta (duration preserved, clamped to the clip). */
export function panWindow(
  w: TimelineWindow,
  deltaSeconds: number,
  clipDurationSeconds: number,
  minWindow: number,
): TimelineWindow {
  return clampWindow(
    {
      viewStartSeconds: w.viewStartSeconds + deltaSeconds,
      viewEndSeconds: w.viewEndSeconds + deltaSeconds,
    },
    clipDurationSeconds,
    minWindow,
  );
}

/** Window framing [start, end] with padding each side ("zoom to selection"). */
export function windowForSpan(
  startSeconds: number,
  endSeconds: number,
  clipDurationSeconds: number,
  minWindow: number,
  paddingFraction = 0.15,
): TimelineWindow {
  const lo = Math.min(startSeconds, endSeconds);
  const hi = Math.max(startSeconds, endSeconds);
  const pad = Math.max(0, hi - lo) * Math.max(0, paddingFraction);
  return clampWindow(
    { viewStartSeconds: lo - pad, viewEndSeconds: hi + pad },
    clipDurationSeconds,
    minWindow,
  );
}

/** Rebuild a window from a zoom factor around a center time (slider input). */
export function windowFromZoomFactor(
  zoomFactor: number,
  centerSeconds: number,
  clipDurationSeconds: number,
  minWindow: number,
): TimelineWindow {
  const clip = Math.max(0, clipDurationSeconds);
  const dur = clip / Math.max(1, zoomFactor);
  const start = centerSeconds - dur / 2;
  return clampWindow(
    { viewStartSeconds: start, viewEndSeconds: start + dur },
    clip,
    minWindow,
  );
}

/** Log-scale zoom-slider mapping: t ∈ [0,1] ↔ z ∈ [1, maxZoom]. */
export function sliderToZoomFactor(t: number, maxZoom: number): number {
  if (!isPositive(maxZoom) || maxZoom <= 1) return 1;
  const clamped = Math.max(0, Math.min(1, t));
  return Math.exp(clamped * Math.log(maxZoom));
}

export function zoomFactorToSlider(zoomFactor: number, maxZoom: number): number {
  if (!isPositive(maxZoom) || maxZoom <= 1) return 0;
  const z = Math.max(1, Math.min(maxZoom, zoomFactor));
  return Math.log(z) / Math.log(maxZoom);
}

// ── Window-relative pixel mapping ───────────────────────────────────────────

/** The track's pixel viewport over a view window (replaces TimelineViewport at z>1). */
export interface WindowViewport {
  window: TimelineWindow;
  trackWidthPx: number;
}

/** Seconds → track x-px, window-relative. NOT clamped — callers cull/hide off-window. */
export function windowSecondsToPx(seconds: number, wv: WindowViewport): number {
  const dur = windowDurationSeconds(wv.window);
  if (!isPositive(dur) || !isPositive(wv.trackWidthPx)) return 0;
  return ((seconds - wv.window.viewStartSeconds) / dur) * wv.trackWidthPx;
}

/** Track x-px → absolute clip seconds, clamped to the window (pointer input). */
export function windowPxToSeconds(px: number, wv: WindowViewport): number {
  const dur = windowDurationSeconds(wv.window);
  if (!isPositive(dur) || !isPositive(wv.trackWidthPx)) {
    return Math.max(0, wv.window.viewStartSeconds);
  }
  const clamped = Math.max(0, Math.min(wv.trackWidthPx, px));
  return wv.window.viewStartSeconds + (clamped / wv.trackWidthPx) * dur;
}

/** A pixel delta → a seconds delta at the current zoom (tolerances/drag/pan). */
export function windowPxDeltaToSeconds(px: number, wv: WindowViewport): number {
  const dur = windowDurationSeconds(wv.window);
  if (!isPositive(dur) || !isPositive(wv.trackWidthPx)) return 0;
  return (px / wv.trackWidthPx) * dur;
}

/** Lay out one cue span window-relative (leftPx may be negative / past the track). */
export function layoutBarInWindow(
  cue: CueSpanLike,
  index: number,
  wv: WindowViewport,
): BarLayout {
  const startSeconds = Math.max(0, Math.min(cue.start, cue.end));
  const endSeconds = Math.max(cue.start, cue.end);
  const leftPx = windowSecondsToPx(startSeconds, wv);
  const rightPx = windowSecondsToPx(endSeconds, wv);
  const rawWidthPx = Math.max(0, rightPx - leftPx);
  const widthPx = Math.max(MIN_BAR_WIDTH_PX, rawWidthPx);
  return { index, startSeconds, endSeconds, leftPx, widthPx, rawWidthPx };
}

/**
 * Lay out all cues, culling bars fully outside the window (+bufferPx) — original
 * indices are preserved on the surviving layouts (B.1 windowing, now window-driven).
 */
export function layoutBarsInWindow(
  cues: readonly CueSpanLike[],
  wv: WindowViewport,
  bufferPx = 200,
): BarLayout[] {
  const out: BarLayout[] = [];
  cues.forEach((cue, index) => {
    const bar = layoutBarInWindow(cue, index, wv);
    if (bar.leftPx + bar.widthPx < -bufferPx) return;
    if (bar.leftPx > wv.trackWidthPx + bufferPx) return;
    out.push(bar);
  });
  return out;
}

/** Ruler ticks across the visible window; labels stay absolute clip time. */
export function generateRulerTicksInWindow(
  wv: WindowViewport,
  options?: { targetMajorSpacingPx?: number },
): RulerTick[] {
  const dur = windowDurationSeconds(wv.window);
  if (!isPositive(dur) || !isPositive(wv.trackWidthPx)) return [];
  const major = chooseTickInterval(dur, wv.trackWidthPx, options?.targetMajorSpacingPx);
  const subdiv = minorSubdivisions(major);
  const minor = major / subdiv;
  const firstIndex = Math.max(0, Math.floor(wv.window.viewStartSeconds / minor));
  const lastIndex = Math.ceil(wv.window.viewEndSeconds / minor + minor / 1000);
  const ticks: RulerTick[] = [];
  for (let i = firstIndex; i <= lastIndex; i += 1) {
    const seconds = i * minor;
    if (seconds < wv.window.viewStartSeconds - 1e-9) continue;
    if (seconds > wv.window.viewEndSeconds + 1e-9) continue;
    const isMajor = i % subdiv === 0;
    ticks.push({
      seconds,
      px: windowSecondsToPx(seconds, wv),
      major: isMajor,
      label: isMajor ? formatRulerLabel(seconds, major) : null,
    });
  }
  return ticks;
}

// ── Minimap (overview strip + lens) ─────────────────────────────────────────

export interface MinimapLens {
  leftPx: number;
  widthPx: number;
}

/** Where the view window sits on the full-clip minimap strip. */
export function minimapLens(
  w: TimelineWindow,
  clipDurationSeconds: number,
  minimapWidthPx: number,
): MinimapLens {
  if (!isPositive(clipDurationSeconds) || !isPositive(minimapWidthPx)) {
    return { leftPx: 0, widthPx: 0 };
  }
  const leftPx = (Math.max(0, w.viewStartSeconds) / clipDurationSeconds) * minimapWidthPx;
  const rightPx =
    (Math.min(clipDurationSeconds, w.viewEndSeconds) / clipDurationSeconds) * minimapWidthPx;
  return { leftPx, widthPx: Math.max(0, rightPx - leftPx) };
}

/** Minimap x-px → absolute clip seconds (clamped). */
export function minimapPxToSeconds(
  px: number,
  clipDurationSeconds: number,
  minimapWidthPx: number,
): number {
  if (!isPositive(clipDurationSeconds) || !isPositive(minimapWidthPx)) return 0;
  const clamped = Math.max(0, Math.min(minimapWidthPx, px));
  return (clamped / minimapWidthPx) * clipDurationSeconds;
}
