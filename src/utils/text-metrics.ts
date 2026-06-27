/**
 * Subtitle text metrics — canvas-backed width measurement + greedy word grouping
 * for the Phase 6 long-segment Smart Split and the per-cue overflow badge (v5.3).
 *
 * WHY anchor to the PREVIEW caption box (not the baked MP4)? Burn-in
 * (subtitle-burnin.ts) renders each cue as a SINGLE drawtext line with no
 * wrapping — so a cue that needs more than one preview line is exactly the cue
 * that will trail off screen in the baked video. Measuring against the same font
 * + box the preview uses makes the editor's "does this fit?" call WYSIWYG with
 * what the user sees in the Subtitles preview.
 *
 * The measure function is INJECTED into the pure helpers (groupWordsByWidth /
 * textOverflowsWidth / estimateMaxWords) so they unit-test in node with a fake
 * metric. Only createTextMeasurer touches the DOM/canvas (browser-only).
 */

export type MeasureWidth = (text: string) => number;

export interface SubtitleMeasureSpec {
  fontSize: number;
  /** Already-resolved CSS family (e.g. 'RVN-DejaVu-Sans'), NOT the picker key. */
  fontFamily: string;
  fontWeight: number;
}

// Sync: subtitle-preview.ts drawSubtitlePreview() — these mirror the preview
// canvas geometry (width, 0.88 text-box ratio, 14px horizontal padding, 600
// weight). If the preview box changes, update here so the fit estimate stays WYSIWYG.
export const PREVIEW_CANVAS_WIDTH = 320;
export const PREVIEW_TEXT_WIDTH_RATIO = 0.88;
export const PREVIEW_TEXT_PADDING_X = 14;
export const PREVIEW_FONT_WEIGHT = 600;

/** Usable single-line caption width inside the preview box, in px. */
export function previewCaptionMaxWidth(canvasWidth: number = PREVIEW_CANVAS_WIDTH): number {
  return Math.round(canvasWidth * PREVIEW_TEXT_WIDTH_RATIO) - PREVIEW_TEXT_PADDING_X * 2;
}

/**
 * Reusable canvas-backed width measurer for one font. The canvas/context is
 * created once; the returned fn is cheap to call per word/line. Browser-only.
 * Falls back to a crude char-width heuristic if a 2D context is unavailable
 * (keeps Smart Split usable rather than throwing in odd environments).
 */
export function createTextMeasurer(spec: SubtitleMeasureSpec): MeasureWidth {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return (text: string) => text.length * spec.fontSize * 0.5;
  }
  ctx.font = `${spec.fontWeight} ${spec.fontSize}px ${spec.fontFamily}`;
  return (text: string) => ctx.measureText(text).width;
}

function splitWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/**
 * Greedily group words into chunks so each chunk's measured width stays within
 * maxWidth. A single word wider than maxWidth becomes its own (still-overflowing)
 * chunk — we never break mid-word (no hyphenation; out of scope). Blank → [].
 *
 * This is the core of Smart Split: each returned chunk is a future cue line that
 * fits on one preview/burn-in line.
 */
export function groupWordsByWidth(
  text: string,
  maxWidth: number,
  measure: MeasureWidth,
): string[] {
  const words = splitWords(text);
  if (words.length === 0) return [];

  const chunks: string[] = [];
  let current = words[0];
  for (let i = 1; i < words.length; i += 1) {
    const trial = `${current} ${words[i]}`;
    if (measure(trial) <= maxWidth) {
      current = trial;
    } else {
      chunks.push(current);
      current = words[i];
    }
  }
  chunks.push(current);
  return chunks;
}

/** True when text won't fit on a single caption line (drives the overflow badge). */
export function textOverflowsWidth(
  text: string,
  maxWidth: number,
  measure: MeasureWidth,
): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return measure(trimmed) > maxWidth;
}

/**
 * Largest leading word-count that fits within maxWidth (design doc §9 name).
 * Thin convenience over the same greedy logic; 0 when even the first word is too wide.
 */
export function estimateMaxWords(
  text: string,
  maxWidth: number,
  measure: MeasureWidth,
): number {
  const words = splitWords(text);
  let fit = 0;
  for (let n = 1; n <= words.length; n += 1) {
    if (measure(words.slice(0, n).join(' ')) <= maxWidth) fit = n;
    else break;
  }
  return fit;
}
