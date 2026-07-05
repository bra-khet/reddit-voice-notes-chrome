/**
 * v5.3.10 — Pure FFmpeg argument builder for the WebCodecs dual-stream overlay
 * composite. Leaf module (no imports) so scripts/test-overlay-alphamerge-args.mjs
 * can bundle it without pulling @ffmpeg/ffmpeg into Node.
 *
 * WHY THIS EXISTS: the MediaRecorder path needs normalizeOverlayWebmForComposite
 * (a full libvpx yuva420p re-encode — ~111 s on a 60 s / 200-cue clip, 77% of
 * bake wall time) because MediaRecorder emits VFR WebM with broken metadata and
 * implicit VP8A alpha. The WebCodecs path produces CFR, frame-exact color +
 * alpha IVF streams BY CONSTRUCTION, so the composite consumes them directly:
 * alphamerge attaches the alpha stream's luma as the color stream's alpha
 * plane, unpremultiply undoes the canvas-source premultiplication, and the
 * existing overlay blend runs unchanged — all inside the single libx264 pass
 * the composite already paid for. Normalize's two repair jobs (CFR enforcement,
 * explicit alpha plane) are structurally impossible to need here. This is NOT
 * the v5.3.9.1 compositeReady mistake: these streams are constructed with
 * exact integer PTS, not captured, and any failure in this tier family falls
 * back to the fully-normalized MediaRecorder pipeline.
 *
 * PREMULTIPLICATION: the color stream is captured from a transparent canvas
 * with alpha discarded, which composites color over black — i.e. premultiplied
 * color. FFmpeg's overlay filter expects straight alpha, so unpremultiply
 * (inplace=1: divide color planes by the stream's own alpha plane) restores
 * straight color before the blend. The last tier drops unpremultiply as a
 * degraded-but-working fallback (glow tails render slightly dark).
 *
 * ALPHA LUMA RANGE: the alpha stream encodes opacity as gray luminance. If the
 * encoder produced limited-range luma (16-235 — the common Chrome canvas-encode
 * path, detected at runtime by the webcodecs-support calibration probe), full
 * opacity would decode as 235/255 ≈ 92% — visibly translucent text. The lutyuv
 * expansion below maps 16→0 / 235→255 before alphamerge (lutyuv output is
 * auto-clipped to [0,255], so no explicit clip() — which keeps the expression
 * comma-free and avoids filter-graph quoting).
 *
 * Sync: src/encoding/webcodecs-support.ts (calibration decides limitedRangeAlpha),
 *       subtitle-burnin.ts buildBurnInStrategies (executes these tiers; x264
 *       encode tail must stay identical to buildCanvasOverlayBurnInArgs),
 *       src/encoding/ivf.ts (stream container these args ingest)
 */

/** WASM FS paths for the dual overlay streams written before composite. */
export const OVERLAY_COLOR_IVF_FS_PATH = 'overlay-color.ivf';
export const OVERLAY_ALPHA_IVF_FS_PATH = 'overlay-alpha.ivf';

/**
 * Limited→full luma expansion for the alpha stream. lutyuv clips results to
 * the valid 8-bit range, so 255-luma inputs (already full range would be a
 * calibration miss) saturate harmlessly instead of wrapping.
 */
export const ALPHA_LIMITED_RANGE_EXPAND_LUT = 'lutyuv=y=(val-16)*255/219';

export interface OverlayAlphamergeTier {
  name: string;
  filterComplex: string;
}

export interface OverlayAlphamergeGraphOptions {
  /** From the runtime calibration probe — insert the lutyuv expansion when true. */
  limitedRangeAlpha: boolean;
  /** Divide color by alpha before the blend (canvas sources are premultiplied). */
  unpremultiply: boolean;
  /** Convert the alpha input to gray before alphamerge ('keep' leaves it yuv420p). */
  alphaFormat: 'gray' | 'keep';
}

/**
 * Filter graph: [0:v] base, [1:v] color IVF, [2:v] alpha IVF.
 * color → yuv420p; alpha → (range expand) → (gray); alphamerge → yuva;
 * (unpremultiply) → overlay onto base.
 */
export function buildOverlayAlphamergeFilterGraph(
  options: OverlayAlphamergeGraphOptions,
): string {
  const alphaSteps: string[] = [];
  if (options.limitedRangeAlpha) alphaSteps.push(ALPHA_LIMITED_RANGE_EXPAND_LUT);
  if (options.alphaFormat === 'gray') alphaSteps.push('format=gray');
  const alphaChain =
    alphaSteps.length > 0 ? `[2:v]${alphaSteps.join(',')}[ova]` : '[2:v]null[ova]';

  const merged = options.unpremultiply
    ? `[ovc][ova]alphamerge,unpremultiply=inplace=1[ol]`
    : `[ovc][ova]alphamerge[ol]`;

  return [
    '[1:v]format=yuv420p[ovc]',
    alphaChain,
    merged,
    '[0:v][ol]overlay=0:0:shortest=1[vout]',
  ].join(';');
}

/**
 * Tier family, richest first — mirrors the CANVAS_OVERLAY_COMPOSITE_TIERS
 * idiom. Tier failures are hard FFmpeg errors only; if every tier fails the
 * caller's fallback is the MediaRecorder pipeline (never drawtext directly,
 * which would silently downgrade rich effects).
 */
export function buildOverlayAlphamergeTiers(
  limitedRangeAlpha: boolean,
): OverlayAlphamergeTier[] {
  return [
    {
      name: 'webcodecs-alphamerge-unpremultiply-gray',
      filterComplex: buildOverlayAlphamergeFilterGraph({
        limitedRangeAlpha,
        unpremultiply: true,
        alphaFormat: 'gray',
      }),
    },
    {
      name: 'webcodecs-alphamerge-unpremultiply-yuv',
      filterComplex: buildOverlayAlphamergeFilterGraph({
        limitedRangeAlpha,
        unpremultiply: true,
        alphaFormat: 'keep',
      }),
    },
    {
      name: 'webcodecs-alphamerge-premultiplied',
      filterComplex: buildOverlayAlphamergeFilterGraph({
        limitedRangeAlpha,
        unpremultiply: false,
        alphaFormat: 'gray',
      }),
    },
  ];
}

export interface OverlayAlphamergeArgsInput {
  tier: OverlayAlphamergeTier;
  /** Base MP4 wasm-FS path (subtitle-burnin BURNIN_INPUT_MP4). */
  baseFile: string;
  colorFile: string;
  alphaFile: string;
  outputFile: string;
}

/**
 * Full composite args. The overlay streams are DECODED ONLY (auto VP8/VP9
 * pick from the IVF fourcc — alpha lives in its own stream, so the historical
 * "generic decode drops alpha" trap does not apply); the single encode in this
 * graph is the x264 output pass the composite has always run. The encode tail
 * mirrors buildCanvasOverlayBurnInArgs exactly (Sync: subtitle-burnin.ts).
 */
export function buildOverlayAlphamergeArgs(input: OverlayAlphamergeArgsInput): string[] {
  return [
    '-i',
    input.baseFile,
    '-f',
    'ivf',
    '-i',
    input.colorFile,
    '-f',
    'ivf',
    '-i',
    input.alphaFile,
    '-filter_complex',
    input.tier.filterComplex,
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
    input.outputFile,
  ];
}
