/**
 * v5.3.9 — Stitch parallel overlay chunk WebMs into one composite-ready overlay.
 *
 * Consumes raw MediaRecorder chunk blobs from concurrent captures
 * (subtitle-overlay-parallel.ts) and produces the same artifact the serial
 * path's normalizeOverlayWebmForComposite emits: a seekable yuva420p VP8 WebM
 * that the burn-in composite tiers decode with alpha intact.
 *
 * Sync: overlay-concat-args.ts (arg construction), overlay-webm-finalize.ts
 *       (idioms: transcode lock, strategy tiers, log tails, FS cleanup)
 */

import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { attachLogCollector, loadFfmpeg } from '@/src/ffmpeg/ffmpeg-runner';
import { buildOverlayConcatArgs } from '@/src/ffmpeg/overlay-concat-args';
import { withTranscodeLock } from '@/src/ffmpeg/transcode-lock';
import { EXTENSION_LOG_PREFIX } from '@/src/utils/constants';

const CHUNK_INPUT_PREFIX = 'overlay-chunk-';
const CONCAT_OUTPUT_WEBM = 'overlay-concat-out.webm';
/** Same ceiling as overlay finalize — decode+encode scales with total clip length. */
const CONCAT_TIMEOUT_MS = 360_000;

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

/**
 * Concat chunk WebMs → single composite-ready yuva420p overlay WebM.
 * Throws when every strategy fails — the caller falls back to a serial render
 * (never returns a partially stitched overlay).
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

    const strategies: { name: string; inputDecoder: string | null }[] = [
      { name: 'libvpx-decode-concat', inputDecoder: 'libvpx' },
      { name: 'generic-decode-concat', inputDecoder: null },
    ];

    let lastError: unknown = null;
    try {
      for (const strategy of strategies) {
        await safeDeleteFile(ffmpeg, CONCAT_OUTPUT_WEBM);

        const args = buildOverlayConcatArgs({
          chunkFiles,
          chunkDurationsSeconds: input.chunkDurationsSeconds,
          fps: input.fps,
          outputFile: CONCAT_OUTPUT_WEBM,
          inputDecoder: strategy.inputDecoder,
        });

        const { lines, detach } = attachLogCollector(ffmpeg);
        try {
          const exit = await withTimeout(
            ffmpeg.exec(args),
            CONCAT_TIMEOUT_MS,
            'Overlay chunk concat',
          );
          if (exit !== 0) {
            throw new Error(`Overlay chunk concat failed (exit ${exit}).`);
          }
          const output = (await ffmpeg.readFile(CONCAT_OUTPUT_WEBM)) as Uint8Array;
          if (output.byteLength > 0) {
            console.log(
              `${EXTENSION_LOG_PREFIX} Overlay chunk concat via ${strategy.name} ` +
                `(${input.chunkBlobs.length} chunks, ${output.byteLength} bytes)`,
            );
            return new Blob([output.slice()], { type: 'video/webm' });
          }
          throw new Error('Overlay chunk concat produced an empty output.');
        } catch (error: unknown) {
          lastError = error;
          const tail = lines
            .filter((line) => /error|invalid|unknown encoder|failed|cannot|not found/i.test(line))
            .slice(-4)
            .join(' | ');
          console.warn(
            `${EXTENSION_LOG_PREFIX} Overlay chunk concat strategy ${strategy.name} failed`,
            error,
            tail || undefined,
          );
        } finally {
          detach();
        }
      }
    } finally {
      for (const file of chunkFiles) {
        await safeDeleteFile(ffmpeg, file);
      }
      await safeDeleteFile(ffmpeg, CONCAT_OUTPUT_WEBM);
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Overlay chunk concat failed for all strategies.');
  });
}
