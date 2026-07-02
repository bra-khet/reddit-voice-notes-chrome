import {
  buildGlowLayerSpecs,
  drawtextMainFontColor,
  DRAWTEXT_BACKDROP_PLATE_FONT_COLOR,
  ffmpegDrawtextColor,
  resolveGlowColorHex,
  subtitleStyleNeedsGlowLayers,
  type GlowRingMode,
} from '@/src/transcription/subtitle-effects';
import type { SubtitleStyleConfig, TranscriptSegment } from '@/src/transcription/types';
import { prepareSegmentsForSubtitleBake, stripScaffoldPlaceholder } from '@/src/transcription/transcript-editing';
import { BURNIN_PIPELINE_STAMP } from '@/src/utils/constants';

export { BURNIN_PIPELINE_STAMP };

export interface SubtitleBurnInInput {
  segments: TranscriptSegment[];
  style: SubtitleStyleConfig;
  /** Clip duration — used to spread segments when Vosk word timings are missing. */
  videoDurationSeconds?: number;
  /** Active theme bar color — resolves theme-hue glow at bake time. */
  themeBarColor?: string;
  /** Force canvas overlay composite when overlay bytes are supplied (v5.3.4 Phase 4). */
  useCanvasOverlay?: boolean;
  /** Pre-rendered VP8 overlay WebM from renderSubtitleOverlay (content-script only). */
  canvasOverlayBytes?: Uint8Array;
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

/** WASM FS path for the canvas overlay WebM written before composite (v5.3.4 Phase 4). */
export const CANVAS_OVERLAY_FS_PATH = 'subtitle-overlay.webm';

/** Usable cue count above which glow drawtext graphs routinely exceed the layer budget. */
const CANVAS_OVERLAY_AUTO_CUE_THRESHOLD = 6;

const DEFAULT_THEME_BAR = '#00e5ff';

// BUG FIX: bake fails on longer / more-populated clips — drawtext filtergraph explosion (BUG-035)
// Fix: ffmpeg.wasm aborts (memory access OOB / truncated "(w-text_w)/2" expressions) once the
//      filtergraph grows past a ceiling (~70+ drawtext filters for a 640×360 clip). The graph
//      scales as cues × glow-ring layers, so cap the total layer budget and fall back to cheaper
//      glow rings (see buildBurnInStrategies) so a clip downshifts instead of dying. The soft halo
//      now uses cheap single/min rings at bake time (subtitle-effects GlowRingMode) so it renders
//      for realistic cue counts instead of being demoted to no-glow.
// Sync: subtitle-effects.ts buildGlowLayerSpecs (per-cue glow layer count by GlowRingMode).
const MAX_BURNIN_DRAWTEXT_LAYERS = 64;

/** Per-tier toggles for the burn-in degradation chain (richest → simplest). */
interface BurnInFilterOptions {
  /** Emit glow ring layers when the style asks for them. */
  allowGlow: boolean;
  /** Glow ring density for the soft halo (cheaper rings keep the graph small). */
  glowRingMode: GlowRingMode;
}

/** WASM virtual FS path for cue text — avoids drawtext filter escaping bugs (BUG-031). */
export function burnInCueTextFilePath(segmentIndex: number): string {
  return `burnin-cue-${segmentIndex}.txt`;
}

/**
 * Vosk partial results can carry text without word timestamps (start/end = 0).
 * Spread cues across the clip so drawtext enable windows are visible.
 * CHANGED: delegates to prepareSegmentsForSubtitleBake (v5.3.4 Phase 5.2).
 */
export function normalizeSegmentsForBurnIn(
  segments: TranscriptSegment[],
  videoDurationSeconds?: number,
): TranscriptSegment[] {
  return prepareSegmentsForSubtitleBake(segments, videoDurationSeconds);
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
  // Strip the soft-hyphen scaffold placeholder so a partly-filled scaffold never
  // bakes an invisible glyph (mirrors usableSegments' blank check).
  const text = stripScaffoldPlaceholder(segment.text).trim();
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
function buildSimpleDrawtextParts(
  segments: TranscriptSegment[],
  style: SubtitleStyleConfig,
  fontFile: string,
  themeBarColor: string,
  opts: BurnInFilterOptions,
): string[] {
  const fontSize = style.fontSize ?? 22;
  const y = drawtextY(style.position, fontSize);
  const textColor = drawtextMainFontColor(style, themeBarColor);

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
      buildDrawtextLayer(
        { textFilePath, start, end, fontSize, fontColor: textColor, x: drawtextX(0), y },
        fontFile,
      ),
    );
  }

  return parts;
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

function buildSegmentGlowLayers(
  segment: TranscriptSegment,
  segmentIndex: number,
  style: SubtitleStyleConfig,
  fontFile: string,
  themeBarColor: string,
  opts: BurnInFilterOptions,
): string[] {
  const { start, end, text } = segmentTiming(segment);
  if (!text) return [];

  const textFilePath = burnInCueTextFilePath(segmentIndex);
  const fontSize = style.fontSize ?? 22;
  const yBase = drawtextY(style.position, fontSize);
  const glow = style.glow!;
  const glowHex = resolveGlowColorHex(glow.colorSource, themeBarColor, style.specialHue);
  const parts: string[] = [];

  const plate = buildBackdropPlateLayer(textFilePath, start, end, fontSize, yBase, style);
  if (plate) {
    parts.push(buildDrawtextLayer(plate, fontFile));
  }

  for (const spec of buildGlowLayerSpecs(glow, fontSize, opts.glowRingMode)) {
    parts.push(
      buildDrawtextLayer(
        {
          textFilePath,
          start,
          end,
          fontSize: spec.fontSize,
          fontColor: ffmpegDrawtextColor(glowHex, spec.opacity),
          x: drawtextX(spec.offsetX),
          y: drawtextYWithOffset(yBase, spec.offsetY),
        },
        fontFile,
      ),
    );
  }

  parts.push(
    buildDrawtextLayer(
      {
        textFilePath,
        start,
        end,
        fontSize,
        fontColor: drawtextMainFontColor(style, themeBarColor),
        x: drawtextX(0),
        y: yBase,
      },
      fontFile,
    ),
  );

  return parts;
}

/** Collect the per-tier drawtext layer list (length = filtergraph cost for the budget). */
function collectBurnInDrawtextParts(
  segments: TranscriptSegment[],
  style: SubtitleStyleConfig,
  fontFile: string,
  themeBarColor: string,
  opts: BurnInFilterOptions,
): string[] {
  const useGlow = opts.allowGlow && subtitleStyleNeedsGlowLayers(style);
  if (!useGlow) {
    return buildSimpleDrawtextParts(segments, style, fontFile, themeBarColor, opts);
  }

  return segments.flatMap((segment, index) =>
    buildSegmentGlowLayers(segment, index, style, fontFile, themeBarColor, opts),
  );
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

/** Degradation tiers for the burn-in filtergraph — richest first, each cheaper. */
const BURNIN_FILTER_TIERS: ReadonlyArray<{ name: string; opts: BurnInFilterOptions }> = [
  // Soft halo as a single 8-neighbour ring + centre (≈9 glow layers/cue). Border mode
  // ignores ring density and always uses its fixed ring.
  { name: 'drawtext-glow', opts: { allowGlow: true, glowRingMode: 'single' } },
  // Cheaper 4-neighbour ring (≈4 glow layers/cue) so glow still renders on busier clips.
  { name: 'drawtext-glow-min', opts: { allowGlow: true, glowRingMode: 'min' } },
  // Backdrop plate + caption only — guaranteed small (≈2 layers/cue).
  { name: 'drawtext-plain', opts: { allowGlow: false, glowRingMode: 'min' } },
];

function buildBurnInArgs(drawtextFilter: string): string[] {
  return [
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
  ];
}

/**
 * Canvas-only styling that drawtext cannot replicate without layer explosion (v5.3.4 Phase 3.5).
 * Sync: subtitle-overlay-renderer.ts rich effects; drawtext tiers stay simpler.
 */
export function subtitleStyleHasCanvasOnlyEffects(style: SubtitleStyleConfig): boolean {
  const glow = style.glow;
  if (glow?.dualBorder === true) return true;
  if (glow?.colorSource === 'rainbow') return true;
  if (style.textGradientWave === true) return true;
  if (style.textGradient !== false) return true;
  return false;
}

/** Whether burn-in should prefer the canvas overlay path when overlay bytes are available. */
export function shouldPreferCanvasOverlay(input: SubtitleBurnInInput): boolean {
  if (input.useCanvasOverlay === true) return true;

  const segments = normalizeSegmentsForBurnIn(input.segments, input.videoDurationSeconds);
  const glowEnabled = input.style.glow?.enabled === true;
  if (segments.length > CANVAS_OVERLAY_AUTO_CUE_THRESHOLD && glowEnabled) return true;

  return subtitleStyleHasCanvasOnlyEffects(input.style);
}

interface CanvasOverlayCompositeTier {
  name: string;
  /** Decoder options applied immediately before the overlay WebM input. */
  overlayInputOpts: string[];
  filterComplex: string;
}

// BUG FIX: canvas overlay composite blocks base video with opaque black matte
// Fix: decode VP8A via libvpx, keep overlay on yuva420p, and blend without format=auto
//      (wasm default decode drops alpha → transparent pixels become opaque black).
// Sync: overlay-webm-finalize.ts normalizeOverlayWebmForComposite (yuva420p pre-pass)
const CANVAS_OVERLAY_COMPOSITE_TIERS: ReadonlyArray<CanvasOverlayCompositeTier> = [
  {
    name: 'canvas-overlay-alpha',
    overlayInputOpts: ['-c:v', 'libvpx'],
    filterComplex: '[1:v]format=yuva420p[ol];[0:v][ol]overlay=0:0:shortest=1[vout]',
  },
  {
    name: 'canvas-overlay-rgba',
    overlayInputOpts: ['-c:v', 'libvpx'],
    filterComplex: '[1:v]format=rgba[ol];[0:v][ol]overlay=0:0:shortest=1[vout]',
  },
  {
    name: 'canvas-overlay-yuva',
    overlayInputOpts: [],
    filterComplex: '[1:v]format=yuva420p[ol];[0:v][ol]overlay=0:0:shortest=1[vout]',
  },
];

function buildCanvasOverlayBurnInArgs(tier: CanvasOverlayCompositeTier): string[] {
  return [
    '-i',
    INPUT_MP4,
    ...tier.overlayInputOpts,
    '-i',
    CANVAS_OVERLAY_FS_PATH,
    '-filter_complex',
    tier.filterComplex,
    '-map',
    '[vout]',
    '-map',
    '0:a?',
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
  ];
}

/**
 * Canvas overlay composite strategies — alpha-preserving overlay blend over base.mp4 (v5.3.4 Phase 4).
 * Overlay bytes should be normalized with normalizeOverlayWebmForComposite before burn-in.
 */
export function buildCanvasOverlayStrategies(overlayBytes: Uint8Array): BurnInStrategy[] {
  if (!overlayBytes || overlayBytes.byteLength < 256) {
    throw new Error('Canvas overlay WebM is empty or too small for burn-in composite.');
  }
  return CANVAS_OVERLAY_COMPOSITE_TIERS.map((tier) => ({
    name: tier.name,
    requiresFont: false,
    extraFiles: { [CANVAS_OVERLAY_FS_PATH]: overlayBytes },
    args: buildCanvasOverlayBurnInArgs(tier),
  }));
}

/** First alpha-preserving canvas composite tier (tests / callers that need a single strategy). */
export function buildCanvasOverlayStrategy(overlayBytes: Uint8Array): BurnInStrategy {
  return buildCanvasOverlayStrategies(overlayBytes)[0];
}

function buildDrawtextBurnInStrategies(input: SubtitleBurnInInput): BurnInStrategy[] {
  const segments = normalizeSegmentsForBurnIn(input.segments, input.videoDurationSeconds);
  if (segments.length === 0) {
    throw new Error('No subtitle segments to burn in.');
  }

  const themeBarColor = input.themeBarColor ?? DEFAULT_THEME_BAR;
  const cueTextFiles = buildCueTextFiles(segments);
  const fontAsset = resolveBurnInFontAsset(input.style?.fontFamily);

  const built: { name: string; filter: string; layers: number }[] = [];
  const seenFilters = new Set<string>();
  for (const tier of BURNIN_FILTER_TIERS) {
    const parts = collectBurnInDrawtextParts(
      segments,
      input.style,
      BURNIN_FONT_FS_PATH,
      themeBarColor,
      tier.opts,
    );
    const filter = parts.join(',');
    if (seenFilters.has(filter)) continue;
    seenFilters.add(filter);
    built.push({ name: tier.name, filter, layers: parts.length });
  }

  const withinBudget = built.filter((tier) => tier.layers <= MAX_BURNIN_DRAWTEXT_LAYERS);
  const chosen = withinBudget.length > 0 ? withinBudget : built.slice(-1);

  return chosen.map((tier) => ({
    name: tier.name,
    requiresFont: true,
    fontAsset,
    extraFiles: cueTextFiles,
    args: buildBurnInArgs(tier.filter),
  }));
}

// BUG FIX: silent burn-in success with no visible subs (BUG-025 / BUG-030)
// Fix: drawtext + bundled DejaVu TTF only — subtitles/libass fallback removed (wasm exit-0 no-op).
// Sync: ffmpeg-runner.ts burnInLogIndicatesFailure, public/assets/fonts/DejaVuSans.ttf
//
// Filtergraph-explosion guard: build every tier, drop duplicates, then keep the tiers within the
// layer budget (the richest in-budget tier runs first, so the common case bakes on attempt 1 with
// no wasted wasm reload). If even the simplest tier is over budget (very many cues), fall back to it
// alone — it's the smallest possible graph. ffmpeg-runner reloads a fresh wasm instance per tier,
// so a tier that still OOMs at runtime degrades to the next instead of hard-failing.
export function buildBurnInStrategies(input: SubtitleBurnInInput): BurnInStrategy[] {
  const drawtextStrategies = buildDrawtextBurnInStrategies(input);
  const overlayBytes = input.canvasOverlayBytes;

  if (
    overlayBytes &&
    overlayBytes.byteLength >= 256 &&
    shouldPreferCanvasOverlay(input)
  ) {
    return [...buildCanvasOverlayStrategies(overlayBytes), ...drawtextStrategies];
  }

  return drawtextStrategies;
}

export const BURNIN_INPUT_MP4 = INPUT_MP4;
export const BURNIN_OUTPUT_MP4 = OUTPUT_MP4;