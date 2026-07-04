/**
 * v5.3.9 — Pure FFmpeg argument builder for parallel overlay chunk concat.
 * Leaf module (no imports) so scripts/test-overlay-concat-args.mjs can bundle it
 * without pulling @ffmpeg/ffmpeg into Node.
 *
 * One pass replaces the serial path's alpha-normalize re-encode: decode N raw
 * MediaRecorder chunks (VP8A via libvpx), trim each to its exact planned frame
 * duration (drops per-chunk MediaRecorder tail-hold frames), concat, and encode
 * a single composite-ready yuva420p VP8 WebM. Decoding N chunks costs the same
 * as decoding one full-length overlay, so chunking is ~free on the FFmpeg side.
 *
 * Sync: overlay-webm-finalize.ts normalizeOverlayWebmForComposite (encode params
 *       must stay identical), subtitle-burnin.ts composite tiers (consume output),
 *       overlay-chunk-concat.ts (executes these args).
 */

export interface OverlayConcatArgsInput {
  /** Virtual-FS chunk filenames, timeline order. */
  chunkFiles: string[];
  /** Planned exact durations (frameCount / fps) — trim targets per chunk. */
  chunkDurationsSeconds: number[];
  fps: number;
  outputFile: string;
  /**
   * Decoder forced per input. Default 'libvpx' — the wasm build's native VP8
   * decoder drops the alpha plane (BUG: opaque black matte, v5.3.4 Phase 4).
   * Pass null for the generic-decode fallback tier.
   */
  inputDecoder?: string | null;
}

/** Encode tail — MUST match normalizeOverlayWebmForComposite (composite contract). */
export function overlayConcatEncodeArgs(fps: number, outputFile: string): string[] {
  return [
    '-r',
    String(fps),
    '-an',
    '-c:v',
    'libvpx',
    '-pix_fmt',
    'yuva420p',
    '-auto-alt-ref',
    '0',
    '-lag-in-frames',
    '0',
    '-deadline',
    'good',
    '-b:v',
    '1800k',
    '-f',
    'webm',
    outputFile,
  ];
}

/**
 * Filter graph: per-input exact-duration trim + PTS rebase, then concat.
 * trim removes the RECORDER_TAIL_FRAME_COUNT hold frames each chunk captures
 * past its planned window — without it every seam would insert ~100 ms of
 * blank frames and accumulate cue drift.
 */
export function buildOverlayConcatFilterGraph(chunkDurationsSeconds: number[]): string {
  const trims = chunkDurationsSeconds.map(
    (duration, i) => `[${i}:v]trim=end=${duration.toFixed(6)},setpts=PTS-STARTPTS[v${i}]`,
  );
  const concatInputs = chunkDurationsSeconds.map((_, i) => `[v${i}]`).join('');
  const concat = `${concatInputs}concat=n=${chunkDurationsSeconds.length}:v=1:a=0,format=yuva420p[vout]`;
  return [...trims, concat].join(';');
}

export function buildOverlayConcatArgs(input: OverlayConcatArgsInput): string[] {
  if (input.chunkFiles.length === 0) {
    throw new Error('Overlay concat requires at least one chunk file.');
  }
  if (input.chunkFiles.length !== input.chunkDurationsSeconds.length) {
    throw new Error('Overlay concat chunk files and durations must align.');
  }

  const decoder = input.inputDecoder === undefined ? 'libvpx' : input.inputDecoder;
  const inputArgs: string[] = [];
  for (const file of input.chunkFiles) {
    // +genpts per input: raw MediaRecorder chunks often lack clean PTS/duration
    // metadata (same reason the serial finalize pass exists).
    inputArgs.push('-fflags', '+genpts');
    if (decoder) inputArgs.push('-c:v', decoder);
    inputArgs.push('-i', file);
  }

  return [
    ...inputArgs,
    '-filter_complex',
    buildOverlayConcatFilterGraph(input.chunkDurationsSeconds),
    '-map',
    '[vout]',
    ...overlayConcatEncodeArgs(input.fps, input.outputFile),
  ];
}
