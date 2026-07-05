/**
 * v5.3.9 — Pure FFmpeg argument builder for parallel overlay chunk concat.
 * Leaf module (no imports) so scripts/test-overlay-concat-args.mjs can bundle it
 * without pulling @ffmpeg/ffmpeg into Node.
 *
 * v5.3.9.1 PERF FIX: the primary tier is now a **stream-copy concat demuxer**
 * (`buildOverlayConcatDemuxerArgs` / `buildOverlayConcatListFile`) — no decode,
 * no encode, just packet-level concatenation. Real QA timing (2026-07-04)
 * showed the original approach (decode all N chunks via a filter_complex,
 * trim+concat, then re-encode the WHOLE clip through libvpx at deadline=good)
 * cost 70-150s on 60s clips — MUCH more than the ~65-150ms a plain stream copy
 * takes, and enough to blow the entire render-phase win (16.9s) and land the
 * parallel path far ABOVE the serial baseline. The filter+re-encode path
 * (`buildOverlayConcatArgs` / `buildOverlayConcatFilterGraph`) is now the
 * fallback tier only, used if the demuxer copy fails or produces bad output.
 * Frame-exact per-chunk trimming (dropping MediaRecorder's tail-hold frames)
 * moves to the concat demuxer's `outpoint` directive, which crops each listed
 * file's own timeline without touching a decoder — same precision as the old
 * `trim=end=` filter, at packet-copy cost instead of re-encode cost.
 *
 * Sync: overlay-webm-finalize.ts normalizeOverlayWebmForComposite (encode params
 *       must stay identical for the fallback tier), subtitle-burnin.ts composite
 *       tiers (consume output — always run through normalize afterward, see
 *       subtitle-overlay-parallel.ts), overlay-chunk-concat.ts (executes these args).
 */

export interface OverlayConcatListEntry {
  /** Virtual-FS chunk filename. */
  file: string;
  /** Planned exact duration (frameCount / fps) — crops this file's own 0-based timeline. */
  outpointSeconds: number;
}

/**
 * Escape a filename for the concat demuxer's single-quoted `file` directive
 * (POSIX-shell-style: close the quote, emit an escaped quote, reopen).
 * Defensive — chunk filenames are always our own safe `overlay-chunk-N.webm`
 * strings today, but the list-file format itself demands correct escaping.
 */
export function escapeConcatListPath(path: string): string {
  return path.replace(/'/g, `'\\''`);
}

/**
 * Concat demuxer list file — pairs each chunk with an `outpoint` directive.
 * `outpoint` crops that file's OWN timeline (0-based, matching `inpoint 0`
 * default) to the given number of seconds — the demuxer-level equivalent of
 * the filter graph's `trim=end=`, but implemented as a packet-timestamp cutoff
 * rather than a decode. This is what makes the primary concat tier a pure
 * stream copy: every trim happens before any bytes are decoded.
 */
export function buildOverlayConcatListFile(entries: OverlayConcatListEntry[]): string {
  const lines: string[] = [];
  for (const entry of entries) {
    lines.push(`file '${escapeConcatListPath(entry.file)}'`);
    lines.push(`outpoint ${entry.outpointSeconds.toFixed(6)}`);
  }
  return `${lines.join('\n')}\n`;
}

export interface OverlayConcatDemuxerArgsInput {
  /** Virtual-FS path of the list file built by buildOverlayConcatListFile. */
  listFile: string;
  outputFile: string;
}

/**
 * Primary (fast) concat tier: `-f concat` demuxer + `-c copy`. No decode, no
 * encode — FFmpeg concatenates the already-encoded VP8(A) packets directly,
 * the same mechanism `finalizeOverlayWebm`'s proven `vp8-copy-remux` strategy
 * already relies on to preserve MediaRecorder's native alpha via plain remux.
 * `-safe 0` is required because the list file uses plain relative wasm-FS
 * paths, which the demuxer otherwise refuses as "unsafe".
 */
export function buildOverlayConcatDemuxerArgs(input: OverlayConcatDemuxerArgsInput): string[] {
  return [
    '-fflags',
    '+genpts',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    input.listFile,
    '-c',
    'copy',
    '-f',
    'webm',
    input.outputFile,
  ];
}

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

/**
 * Fallback-tier encode tail — MUST match normalizeOverlayWebmForComposite's
 * own encode params (not a correctness requirement anymore, since concat's
 * output always passes through normalize afterward regardless of which tier
 * ran, but keeping them identical means the fallback tier degrades gracefully
 * to "normalize happens twice" rather than "normalize sees different params").
 */
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
 * FALLBACK TIER ONLY (see module docblock) — decode all N inputs, trim + PTS
 * rebase, concat, and re-encode. Only reached when the stream-copy demuxer
 * tier fails or produces bad output; measurably far more expensive (a full
 * quality-based libvpx re-encode of the whole clip, ×N alpha decodes) than
 * the primary tier, so it must stay a fallback, not the default path.
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
