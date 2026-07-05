/**
 * v5.3.9 — Stitch parallel overlay chunk WebMs into one composite-ready overlay.
 *
 * Consumes raw MediaRecorder chunk blobs from concurrent captures
 * (subtitle-overlay-parallel.ts). Two tiers:
 *
 * 1. **Stream-copy concat demuxer** (primary) — `-f concat` + per-file
 *    `outpoint` trim + `-c copy`. No decode, no encode: packet-level
 *    concatenation. This is the fast path and should handle the overwhelming
 *    majority of bakes.
 * 2. **Decode + filter concat + re-encode** (fallback) — only reached if tier 1
 *    fails or produces bad output. Full libvpx alpha decode of every chunk,
 *    trim/concat filter graph, quality re-encode.
 *
 * v5.3.9.1 PERF FIX (2026-07-04): tier 2 used to be the ONLY strategy, and its
 * output was treated as already composite-ready (skipping the normalize step).
 * Real QA timing showed this cost 70-150s on 60s clips — the filter_complex's
 * N-way alpha decode + concat + full quality re-encode is drastically more
 * expensive than a plain stream copy, enough to erase the entire render-phase
 * win. Tier 1 now handles the common case in well under a second; NEITHER
 * tier's output is treated as composite-ready anymore (see
 * subtitle-overlay-parallel.ts) — normalizeOverlayWebmForComposite always runs
 * afterward, exactly as it does for the serial path, so this module's only job
 * is stitching, not encoding.
 *
 * Sync: overlay-concat-args.ts (arg construction), overlay-webm-finalize.ts
 *       (idioms: transcode lock, strategy tiers, log tails, FS cleanup)
 */

import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { attachLogCollector, loadFfmpeg } from '@/src/ffmpeg/ffmpeg-runner';
import {
  buildOverlayConcatArgs,
  buildOverlayConcatDemuxerArgs,
  buildOverlayConcatListFile,
} from '@/src/ffmpeg/overlay-concat-args';
import { withTranscodeLock } from '@/src/ffmpeg/transcode-lock';
import { EXTENSION_LOG_PREFIX } from '@/src/utils/constants';

const CHUNK_INPUT_PREFIX = 'overlay-chunk-';
const CONCAT_LIST_FILE = 'overlay-concat-list.txt';
const CONCAT_OUTPUT_WEBM = 'overlay-concat-out.webm';
/**
 * Stream copy should complete in well under a second; a generous but bounded
 * ceiling here means a hung/broken fast tier fails over to the fallback tier
 * quickly instead of burning most of the overall bake timeout on it.
 */
const STREAM_COPY_TIMEOUT_MS = 45_000;
/** Fallback tier does a real decode+encode — same ceiling as overlay finalize. */
const REENCODE_TIMEOUT_MS = 360_000;

async function safeDeleteFile(ffmpeg: FFmpeg, path: string): Promise<void> {
  try {
    await ffmpeg.deleteFile(path);
  } catch {
    // File may not exist between strategy attempts.
  }
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);

    void work.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export interface ConcatOverlayChunksInput {
  /** Raw MediaRecorder chunk blobs, timeline order. */
  chunkBlobs: Blob[];
  /** Planned exact chunk durations (frameCount / fps). */
  chunkDurationsSeconds: number[];
  fps: number;
}

async function tryExec(
  ffmpeg: FFmpeg,
  args: string[],
  timeoutMs: number,
  label: string,
): Promise<Uint8Array> {
  const { lines, detach } = attachLogCollector(ffmpeg);
  try {
    const exit = await withTimeout(ffmpeg.exec(args), timeoutMs, label);
    if (exit !== 0) {
      throw new Error(`${label} failed (exit ${exit}).`);
    }
    const output = (await ffmpeg.readFile(CONCAT_OUTPUT_WEBM)) as Uint8Array;
    if (output.byteLength === 0) {
      throw new Error(`${label} produced an empty output.`);
    }
    return output;
  } catch (error: unknown) {
    const tail = lines
      .filter((line) => /error|invalid|unknown encoder|failed|cannot|not found/i.test(line))
      .slice(-4)
      .join(' | ');
    console.warn(`${EXTENSION_LOG_PREFIX} ${label} failed`, error, tail || undefined);
    throw error;
  } finally {
    detach();
  }
}

/**
 * Stitch chunk WebMs into a single overlay WebM (NOT composite-ready — the
 * caller must still run normalizeOverlayWebmForComposite). Throws when every
 * tier fails — the caller falls back to a serial render.
 */
export async function concatOverlayChunksForComposite(
  input: ConcatOverlayChunksInput,
): Promise<Blob> {
  if (input.chunkBlobs.length !== input.chunkDurationsSeconds.length) {
    throw new Error('Overlay concat chunk blobs and durations must align.');
  }
  if (input.chunkBlobs.length === 0) {
    throw new Error('Overlay concat requires at least one chunk.');
  }

  return withTranscodeLock(async () => {
    const ffmpeg = await loadFfmpeg();
    const chunkFiles = input.chunkBlobs.map((_, i) => `${CHUNK_INPUT_PREFIX}${i}.webm`);

    for (let i = 0; i < input.chunkBlobs.length; i += 1) {
      const bytes = new Uint8Array(await input.chunkBlobs[i].arrayBuffer());
      // Fresh slice per write — wasm FS transfer detaches buffers (BUG-002 rule).
      await ffmpeg.writeFile(chunkFiles[i], bytes.slice());
    }

    let lastError: unknown = null;

    try {
      // Tier 1 (primary): stream-copy concat demuxer. No decode/encode — see
      // module docblock for why this replaced the filter+re-encode default.
      await safeDeleteFile(ffmpeg, CONCAT_OUTPUT_WEBM);
      const listFileContent = buildOverlayConcatListFile(
        chunkFiles.map((file, i) => ({ file, outpointSeconds: input.chunkDurationsSeconds[i] })),
      );
      await ffmpeg.writeFile(CONCAT_LIST_FILE, new TextEncoder().encode(listFileContent));

      try {
        const output = await tryExec(
          ffmpeg,
          buildOverlayConcatDemuxerArgs({ listFile: CONCAT_LIST_FILE, outputFile: CONCAT_OUTPUT_WEBM }),
          STREAM_COPY_TIMEOUT_MS,
          'Overlay chunk concat (stream copy)',
        );
        console.log(
          `${EXTENSION_LOG_PREFIX} Overlay chunk concat via stream-copy-demuxer ` +
            `(${input.chunkBlobs.length} chunks, ${output.byteLength} bytes)`,
        );
        return new Blob([output.slice()], { type: 'video/webm' });
      } catch (error: unknown) {
        lastError = error;
        console.warn(
          `${EXTENSION_LOG_PREFIX} Overlay chunk concat stream-copy tier failed — ` +
            'falling back to decode+re-encode (slower)',
          error,
        );
      }

      // Tier 2 (fallback): decode + filter concat + re-encode. Only reached on
      // tier 1 failure — see module docblock for why this must not be the default.
      const reencodeStrategies: { name: string; inputDecoder: string | null }[] = [
        { name: 'libvpx-decode-concat', inputDecoder: 'libvpx' },
        { name: 'generic-decode-concat', inputDecoder: null },
      ];

      for (const strategy of reencodeStrategies) {
        await safeDeleteFile(ffmpeg, CONCAT_OUTPUT_WEBM);
        const args = buildOverlayConcatArgs({
          chunkFiles,
          chunkDurationsSeconds: input.chunkDurationsSeconds,
          fps: input.fps,
          outputFile: CONCAT_OUTPUT_WEBM,
          inputDecoder: strategy.inputDecoder,
        });

        try {
          const output = await tryExec(
            ffmpeg,
            args,
            REENCODE_TIMEOUT_MS,
            `Overlay chunk concat (${strategy.name})`,
          );
          console.log(
            `${EXTENSION_LOG_PREFIX} Overlay chunk concat via ${strategy.name} ` +
              `(${input.chunkBlobs.length} chunks, ${output.byteLength} bytes)`,
          );
          return new Blob([output.slice()], { type: 'video/webm' });
        } catch (error: unknown) {
          lastError = error;
        }
      }
    } finally {
      for (const file of chunkFiles) {
        await safeDeleteFile(ffmpeg, file);
      }
      await safeDeleteFile(ffmpeg, CONCAT_LIST_FILE);
      await safeDeleteFile(ffmpeg, CONCAT_OUTPUT_WEBM);
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Overlay chunk concat failed for all strategies.');
  });
}
