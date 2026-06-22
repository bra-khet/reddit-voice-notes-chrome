import { buildSrtFromSegments } from '@/src/transcription/srt-builder';
import type { SubtitleStyleConfig, TranscriptSegment } from '@/src/transcription/types';

export interface SubtitleBurnInInput {
  segments: TranscriptSegment[];
  style: SubtitleStyleConfig;
  /** Clip duration — used to spread segments when Vosk word timings are missing. */
  videoDurationSeconds?: number;
}

export const BURNIN_FONT_FS_PATH = 'burnin-font.ttf';
export const BURNIN_FONT_ASSET = 'assets/fonts/DejaVuSans.ttf';

const INPUT_MP4 = 'base.mp4';
const OUTPUT_MP4 = 'final.mp4';
const SRT_FILE = 'subs.srt';

function usableSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  return segments.filter((segment) => segment.text.trim().length > 0);
}

/**
 * Vosk partial results can carry text without word timestamps (start/end = 0).
 * Spread cues across the clip so drawtext enable windows are visible.
 */
export function normalizeSegmentsForBurnIn(
  segments: TranscriptSegment[],
  videoDurationSeconds?: number,
): TranscriptSegment[] {
  const usable = usableSegments(segments);
  if (usable.length === 0) return [];

  const duration = Math.max(1, videoDurationSeconds ?? 0);
  const missingTimings = usable.every((segment) => segment.end <= segment.start);

  if (missingTimings && duration > 0) {
    const slot = duration / usable.length;
    return usable.map((segment, index) => ({
      ...segment,
      start: index * slot,
      end: Math.min(duration, (index + 1) * slot - 0.05),
    }));
  }

  return usable.map((segment) => ({
    ...segment,
    start: Math.max(0, segment.start),
    end: Math.max(segment.start + 0.35, segment.end),
  }));
}

function assAlignment(position: SubtitleStyleConfig['position']): number {
  if (position === 'top') return 8;
  if (position === 'center') return 5;
  return 2;
}

function assBackColour(style: SubtitleStyleConfig): string {
  const backdrop = style.backdrop;
  if (backdrop?.enabled === false) return '&H00000000&';
  const opacity = backdrop?.opacity ?? 0.72;
  const alpha = Math.round((1 - opacity) * 255);
  const aa = alpha.toString(16).padStart(2, '0').toUpperCase();
  return `&H${aa}000000&`;
}

/** Build force_style for FFmpeg subtitles filter from studio subtitle prefs. */
export function buildSubtitleForceStyle(style: SubtitleStyleConfig): string {
  const fontSize = style.fontSize ?? 22;
  const alignment = assAlignment(style.position);
  const backColour = assBackColour(style);
  const borderStyle = style.backdrop?.enabled === false ? 1 : 4;
  const outline = style.outline?.enabled === true ? (style.outline.width ?? 1) : 0;
  const shadow = style.shadow?.enabled === false ? 0 : 1;

  return [
    'FontName=DejaVu Sans',
    `FontSize=${fontSize}`,
    'PrimaryColour=&H00FFFFFF&',
    `BackColour=${backColour}`,
    `BorderStyle=${borderStyle}`,
    `Outline=${outline}`,
    `Shadow=${shadow}`,
    `Alignment=${alignment}`,
    'MarginV=24',
  ].join(',');
}

function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/\n/g, ' ');
}

function drawtextY(position: SubtitleStyleConfig['position'], fontSize: number): string {
  const margin = Math.max(16, Math.round(fontSize * 0.9));
  if (position === 'top') return String(margin);
  if (position === 'center') return '(h-text_h)/2';
  return `h-text_h-${margin}`;
}

function buildDrawtextFilter(
  segments: TranscriptSegment[],
  style: SubtitleStyleConfig,
  fontFile: string,
): string {
  const fontSize = style.fontSize ?? 22;
  const y = drawtextY(style.position, fontSize);
  const backdropOn = style.backdrop?.enabled !== false;
  const opacity = style.backdrop?.opacity ?? 0.72;
  const box = backdropOn ? `:box=1:boxcolor=black@${opacity.toFixed(2)}:boxborderw=12` : '';
  const shadowOn = style.shadow?.enabled !== false;
  const shadow = shadowOn ? ':shadowcolor=black@0.85:shadowx=1:shadowy=1' : '';

  const parts = segments.map((segment) => {
    const text = escapeDrawtext(segment.text.trim());
    const start = Math.max(0, segment.start);
    const end = Math.max(start + 0.35, segment.end);
    return (
      `drawtext=fontfile=${fontFile}:fontcolor=white:fontsize=${fontSize}` +
      `:x=(w-text_w)/2:y=${y}${box}${shadow}` +
      `:text='${text}':enable='between(t,${start},${end})'`
    );
  });

  return parts.join(',');
}

/** Detect ffmpeg.wasm no-op / missing-filter attempts that still return exit 0. */
export function burnInLogIndicatesFailure(lines: string[]): string | null {
  const text = lines.join('\n').toLowerCase();
  const needles = [
    'no such filter',
    'error applying option',
    'error initializing filter',
    'error reinitializing filters',
    'unable to load',
    'cannot find a valid font',
    'failed to parse',
    'invalid argument',
    'fontconfig error',
    'failed to load libass',
  ];
  for (const needle of needles) {
    if (text.includes(needle)) return needle;
  }
  return null;
}

export interface BurnInStrategy {
  name: string;
  args: string[];
  extraFiles?: Record<string, string | Uint8Array>;
  requiresFont?: boolean;
}

export function buildBurnInStrategies(input: SubtitleBurnInInput): BurnInStrategy[] {
  const segments = normalizeSegmentsForBurnIn(input.segments, input.videoDurationSeconds);
  if (segments.length === 0) {
    throw new Error('No subtitle segments to burn in.');
  }

  const srt = buildSrtFromSegments(segments);
  const forceStyle = buildSubtitleForceStyle(input.style);
  const drawtextFilter = buildDrawtextFilter(segments, input.style, BURNIN_FONT_FS_PATH);

  // BUG FIX: silent burn-in success with no visible subs (BUG-025)
  // Fix: drawtext + bundled DejaVu TTF first; subtitles filter is fallback only (no libass/fonts in wasm).
  // Sync: ffmpeg-runner.ts burnInLogIndicatesFailure, public/assets/fonts/DejaVuSans.ttf
  return [
    {
      name: 'drawtext-font',
      requiresFont: true,
      args: [
        '-i',
        INPUT_MP4,
        '-vf',
        drawtextFilter,
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'copy',
        '-movflags',
        '+faststart',
        OUTPUT_MP4,
      ],
    },
    {
      name: 'subtitles-srt',
      extraFiles: { [SRT_FILE]: srt },
      args: [
        '-i',
        INPUT_MP4,
        '-vf',
        `subtitles=filename=${SRT_FILE}:force_style='${forceStyle}'`,
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'copy',
        '-movflags',
        '+faststart',
        OUTPUT_MP4,
      ],
    },
  ];
}

export const BURNIN_INPUT_MP4 = INPUT_MP4;
export const BURNIN_OUTPUT_MP4 = OUTPUT_MP4;