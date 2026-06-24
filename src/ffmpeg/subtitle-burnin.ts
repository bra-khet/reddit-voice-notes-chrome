import {
  buildGlowLayerSpecs,
  drawtextMainFontColor,
  DRAWTEXT_BACKDROP_PLATE_FONT_COLOR,
  ffmpegDrawtextColor,
  resolveGlowColorHex,
  styleUsesSpecialHueRainbow,
  subtitleStyleNeedsGlowLayers,
  temporalizeDrawtextColor,
} from '@/src/transcription/subtitle-effects';
import type { SubtitleStyleConfig, TranscriptSegment } from '@/src/transcription/types';
import { BURNIN_PIPELINE_STAMP } from '@/src/utils/constants';

export { BURNIN_PIPELINE_STAMP };

export interface SubtitleBurnInInput {
  segments: TranscriptSegment[];
  style: SubtitleStyleConfig;
  /** Clip duration — used to spread segments when Vosk word timings are missing. */
  videoDurationSeconds?: number;
  /** Active theme bar color — resolves theme-hue glow at bake time. */
  themeBarColor?: string;
}

// BUG FIX: drawtext fontfile= with relative path fails silently in Emscripten MEMFS on some builds
// Fix: Use absolute path so FreeType open() doesn't depend on FFmpeg's CWD matching the FS CWD.
export const BURNIN_FONT_FS_PATH = '/burnin-font.ttf';
export const BURNIN_FONT_ASSET = 'assets/fonts/DejaVuSans.ttf';

// Map picker value keys → bundled DejaVu TTF assets in public/assets/fonts/.
// Keys are opaque identifiers set by FONT_FAMILY_OPTIONS in subtitle-controls.ts — not CSS strings.
const FONT_ASSETS: Readonly<Record<string, string>> = {
  'dejavu-sans': 'assets/fonts/DejaVuSans.ttf',
  'dejavu-serif': 'assets/fonts/DejaVuSerif.ttf',
  'dejavu-mono': 'assets/fonts/DejaVuSansMono.ttf',
  'dejavu-bold': 'assets/fonts/DejaVuSansCondensedBold.ttf',
};

export function resolveBurnInFontAsset(fontFamily?: string): string {
  return (fontFamily && FONT_ASSETS[fontFamily]) ?? BURNIN_FONT_ASSET;
}

const INPUT_MP4 = 'base.mp4';
const OUTPUT_MP4 = 'final.mp4';

const DEFAULT_THEME_BAR = '#00e5ff';

function usableSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  return segments.filter((segment) => segment.text.trim().length > 0);
}

/** WASM virtual FS path for cue text — avoids drawtext filter escaping bugs (BUG-031). */
export function burnInCueTextFilePath(segmentIndex: number): string {
  return `burnin-cue-${segmentIndex}.txt`;
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
  const primaryColour = style.textColor === 'black' ? '&H00000000&' : '&H00FFFFFF&';

  return [
    'FontName=DejaVu Sans',
    `FontSize=${fontSize}`,
    `PrimaryColour=${primaryColour}`,
    `BackColour=${backColour}`,
    `BorderStyle=${borderStyle}`,
    `Outline=${outline}`,
    'Shadow=0',
    `Alignment=${alignment}`,
    'MarginV=24',
  ].join(',');
}

function drawtextY(position: SubtitleStyleConfig['position'], fontSize: number): string {
  const margin = Math.max(16, Math.round(fontSize * 0.9));
  if (position === 'top') return String(margin);
  if (position === 'center') return '(h-text_h)/2';
  return `h-text_h-${margin}`;
}

function drawtextX(offsetX: number): string {
  if (offsetX === 0) return '(w-text_w)/2';
  const sign = offsetX > 0 ? '+' : '-';
  return `(w-text_w)/2${sign}${Math.abs(offsetX)}`;
}

function drawtextYWithOffset(y: string, offsetY: number): string {
  if (offsetY === 0) return y;
  const sign = offsetY > 0 ? '+' : '-';
  return `${y}${sign}${Math.abs(offsetY)}`;
}

function segmentTiming(segment: TranscriptSegment): { start: number; end: number; text: string } {
  const text = segment.text.trim();
  const start = Math.max(0, segment.start);
  const end = Math.max(start + 0.35, segment.end);
  return { start, end, text };
}

function buildCueTextFiles(segments: TranscriptSegment[]): Record<string, string> {
  const files: Record<string, string> = {};
  segments.forEach((segment, index) => {
    const { text } = segmentTiming(segment);
    if (!text) return;
    files[burnInCueTextFilePath(index)] = text;
  });
  return files;
}

// BUG FIX: backdrop plate covers glow and caption at high opacity (BUG-029)
// Fix: render box on a transparent first drawtext layer; caption/glow layers stack above.
// Sync: DRAWTEXT_BACKDROP_PLATE_FONT_COLOR in subtitle-effects.ts (never black@0.00 — breaks -vf, BUG-030)

function buildBackdropBoxOpt(style: SubtitleStyleConfig): string {
  if (style.backdrop?.enabled === false) return '';
  const opacity = style.backdrop?.opacity ?? 0.72;
  return `:box=1:boxcolor=black@${opacity.toFixed(2)}:boxborderw=12`;
}

function buildBackdropPlateLayer(
  textFilePath: string,
  start: number,
  end: number,
  fontSize: number,
  y: string,
  style: SubtitleStyleConfig,
): DrawtextLayer | null {
  const box = buildBackdropBoxOpt(style);
  if (!box) return null;
  return {
    textFilePath,
    start,
    end,
    fontSize,
    fontColor: DRAWTEXT_BACKDROP_PLATE_FONT_COLOR,
    x: drawtextX(0),
    y,
    box,
  };
}

/** BUG-025 proven path: drawtext per cue; backdrop plate is a separate first layer. */
function buildSimpleDrawtextFilter(
  segments: TranscriptSegment[],
  style: SubtitleStyleConfig,
  fontFile: string,
  themeBarColor: string,
): string {
  const fontSize = style.fontSize ?? 22;
  const y = drawtextY(style.position, fontSize);
  const animateText = styleUsesSpecialHueRainbow(style) && style.textColor === 'special';

  const parts: string[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const { start, end, text } = segmentTiming(segment);
    if (!text) continue;

    const textFilePath = burnInCueTextFilePath(index);
    const plate = buildBackdropPlateLayer(textFilePath, start, end, fontSize, y, style);
    if (plate) {
      parts.push(buildDrawtextLayer(plate, fontFile));
    }

    parts.push(
      ...emitTemporalDrawtextLayers(
        {
          textFilePath,
          start,
          end,
          fontSize,
          x: drawtextX(0),
          y,
        },
        (timeSeconds) => drawtextMainFontColor(style, themeBarColor, timeSeconds),
        animateText,
        fontFile,
      ),
    );
  }

  return parts.join(',');
}

interface DrawtextLayer {
  textFilePath: string;
  start: number;
  end: number;
  fontSize: number;
  fontColor: string;
  x: string;
  y: string;
  box?: string;
}

// BUG FIX: transcript punctuation breaks drawtext filter graph (BUG-031)
// Fix: cue text via textfile= in WASM FS — commas/colons/apostrophes stay out of -vf string.
function buildDrawtextLayer(layer: DrawtextLayer, fontFile: string): string {
  return (
    `drawtext=fontfile=${fontFile}:fontcolor=${layer.fontColor}:fontsize=${layer.fontSize}` +
    `:x=${layer.x}:y=${layer.y}${layer.box ?? ''}` +
    `:textfile=${layer.textFilePath}:enable='between(t,${layer.start},${layer.end})'`
  );
}

/**
 * FFmpeg drawtext fontcolor is static per filter — rainbow bakes as time-sliced duplicates.
 * Sync: temporalizeDrawtextColor + subtitle-preview previewTimeMs (live RAF path).
 */
function emitTemporalDrawtextLayers(
  base: Omit<DrawtextLayer, 'fontColor'>,
  colorAtTime: (timeSeconds: number) => string,
  animate: boolean,
  fontFile: string,
): string[] {
  if (!animate) {
    const mid = (base.start + base.end) / 2;
    return [buildDrawtextLayer({ ...base, fontColor: colorAtTime(mid) }, fontFile)];
  }

  return temporalizeDrawtextColor(base.start, base.end, colorAtTime).map((slice) =>
    buildDrawtextLayer({ ...base, start: slice.start, end: slice.end, fontColor: slice.fontColor }, fontFile),
  );
}

function buildSegmentGlowLayers(
  segment: TranscriptSegment,
  segmentIndex: number,
  style: SubtitleStyleConfig,
  fontFile: string,
  themeBarColor: string,
): string[] {
  const { start, end, text } = segmentTiming(segment);
  if (!text) return [];

  const textFilePath = burnInCueTextFilePath(segmentIndex);
  const fontSize = style.fontSize ?? 22;
  const yBase = drawtextY(style.position, fontSize);
  const glow = style.glow!;
  const rainbow = styleUsesSpecialHueRainbow(style);
  const animateGlow = rainbow && glow.colorSource === 'special';
  const animateText = rainbow && style.textColor === 'special';
  const parts: string[] = [];

  const plate = buildBackdropPlateLayer(textFilePath, start, end, fontSize, yBase, style);
  if (plate) {
    parts.push(buildDrawtextLayer(plate, fontFile));
  }

  for (const spec of buildGlowLayerSpecs(glow, fontSize)) {
    parts.push(
      ...emitTemporalDrawtextLayers(
        {
          textFilePath,
          start,
          end,
          fontSize: spec.fontSize,
          x: drawtextX(spec.offsetX),
          y: drawtextYWithOffset(yBase, spec.offsetY),
        },
        (timeSeconds) => {
          const hex = resolveGlowColorHex(
            glow.colorSource,
            themeBarColor,
            style.specialHue,
            timeSeconds,
            animateGlow,
          );
          return ffmpegDrawtextColor(hex, spec.opacity);
        },
        animateGlow,
        fontFile,
      ),
    );
  }

  parts.push(
    ...emitTemporalDrawtextLayers(
      {
        textFilePath,
        start,
        end,
        fontSize,
        x: drawtextX(0),
        y: yBase,
      },
      (timeSeconds) => drawtextMainFontColor(style, themeBarColor, timeSeconds),
      animateText,
      fontFile,
    ),
  );

  return parts;
}

function buildDrawtextFilter(
  segments: TranscriptSegment[],
  style: SubtitleStyleConfig,
  fontFile: string,
  themeBarColor: string,
): string {
  if (!subtitleStyleNeedsGlowLayers(style)) {
    return buildSimpleDrawtextFilter(segments, style, fontFile, themeBarColor);
  }

  const parts = segments.flatMap((segment, index) =>
    buildSegmentGlowLayers(segment, index, style, fontFile, themeBarColor),
  );
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
    // FreeType font-load failures (exit 0 in some builds, so we catch them here)
    'error while loading freetype font',
    'could not load freetype',
    'no font filename provided',
    'cannot open stream',
    'cannot open resource',
    'failed to parse',
    'invalid argument',
    'fontconfig error',
    'failed to load libass',
    'error parsing filter',
    'unable to parse option',
    'failed to set value',
    'error when evaluating the expression',
    'required option is missing',
    'no output streams',
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
  /** Which extension-relative font asset to write to WASM FS when requiresFont is true. */
  fontAsset?: string;
}

export function buildBurnInStrategies(input: SubtitleBurnInInput): BurnInStrategy[] {
  const segments = normalizeSegmentsForBurnIn(input.segments, input.videoDurationSeconds);
  if (segments.length === 0) {
    throw new Error('No subtitle segments to burn in.');
  }

  const themeBarColor = input.themeBarColor ?? DEFAULT_THEME_BAR;
  const cueTextFiles = buildCueTextFiles(segments);
  const fontAsset = resolveBurnInFontAsset(input.style?.fontFamily);
  const drawtextFilter = buildDrawtextFilter(segments, input.style, BURNIN_FONT_FS_PATH, themeBarColor);

  // BUG FIX: silent burn-in success with no visible subs (BUG-025 / BUG-030)
  // Fix: drawtext + bundled DejaVu TTF only — subtitles/libass fallback removed (wasm exit-0 no-op).
  // Sync: ffmpeg-runner.ts burnInLogIndicatesFailure, public/assets/fonts/DejaVuSans.ttf
  return [
    {
      name: 'drawtext-font',
      requiresFont: true,
      fontAsset,
      extraFiles: cueTextFiles,
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
  ];
}

export const BURNIN_INPUT_MP4 = INPUT_MP4;
export const BURNIN_OUTPUT_MP4 = OUTPUT_MP4;