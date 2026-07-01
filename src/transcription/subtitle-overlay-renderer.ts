/**
 * v5.3.4 Canvas Overlay Subtitle Renderer
 * Renders timed styled subtitles + glow/border effects to an off-screen canvas
 * and captures the result as a video track / Blob for later FFmpeg compositing.
 *
 * Sync points:
 * - Uses SubtitleStyleConfig and TranscriptSegment from ./types
 * - Re-uses color helpers from ./subtitle-effects
 * - Will be called from src/ffmpeg/subtitle-burnin.ts and Design Studio
 */

import type { SubtitleStyleConfig, TranscriptSegment } from '@/src/transcription/types';

export interface SubtitleOverlayRenderOptions {
  /** Target output width (should match base video) */
  width: number;
  /** Target output height (should match base video) */
  height: number;
  /** Desired output framerate (e.g. 30) */
  fps: number;
  /** Background color or 'transparent' */
  background?: string | 'transparent';
  /** When true, render faster than real-time (default true for bake) */
  offline?: boolean;
}

export interface SubtitleOverlayResult {
  /** The rendered overlay as a video Blob (webm or mp4) */
  overlayBlob: Blob;
  /** Duration of the rendered overlay in seconds */
  durationSeconds: number;
  /** Actual framerate used */
  fps: number;
}

/**
 * Main entry point. Renders the full timeline offline.
 * Must work completely off-screen (no DOM attachment required).
 */
export async function renderSubtitleOverlay(
  _segments: TranscriptSegment[],
  _style: SubtitleStyleConfig,
  durationSeconds: number,
  options: SubtitleOverlayRenderOptions,
): Promise<SubtitleOverlayResult> {
  // Phase 1 stub — canvas render loop lands in Phase 2.
  void _segments;
  void _style;
  return {
    overlayBlob: new Blob([], { type: 'video/webm' }),
    durationSeconds,
    fps: options.fps,
  };
}

/**
 * Helper for Design Studio / dev testing.
 * Renders and returns a URL that can be played in a <video> element.
 */
export async function renderSubtitleOverlayForPreview(
  segments: TranscriptSegment[],
  style: SubtitleStyleConfig,
  durationSeconds: number,
  options?: Partial<SubtitleOverlayRenderOptions>,
): Promise<string> {
  const result = await renderSubtitleOverlay(segments, style, durationSeconds, {
    width: options?.width ?? 640,
    height: options?.height ?? 360,
    fps: options?.fps ?? 30,
    background: options?.background ?? 'transparent',
    offline: options?.offline ?? true,
    ...options,
  });
  return URL.createObjectURL(result.overlayBlob);
}