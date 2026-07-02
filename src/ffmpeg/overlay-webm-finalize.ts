/**
 * v5.3.4 — Post-process MediaRecorder overlay WebM for seekable metadata + cleaner VP8 edges.
 *
 * MediaRecorder often emits WebM without a Cues index (no scrubbing) and with fringe
 * artifacts on semi-transparent caption plates. FFmpeg remux/re-encode fixes both.
 *
 * Sync: subtitle-overlay-renderer.ts (calls after canvas capture)
 */

import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { attachLogCollector, loadFfmpeg } from '@/src/ffmpeg/ffmpeg-runner';
import { withTranscodeLock } from '@/src/ffmpeg/transcode-lock';
import { EXTENSION_LOG_PREFIX } from '@/src/utils/constants';

const INPUT_WEBM = 'overlay-raw.webm';
const OUTPUT_WEBM = 'overlay-final.webm';
const COMPOSITE_ALPHA_INPUT = 'overlay-alpha-in.webm';
const COMPOSITE_ALPHA_OUTPUT = 'overlay-alpha-out.webm';
const FINALIZE_TIMEOUT_MS = 45_000;

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

async function execFinalize(ffmpeg: FFmpeg, args: string[]): Promise<void> {
  const exit = await withTimeout(ffmpeg.exec(args), FINALIZE_TIMEOUT_MS, 'Overlay WebM finalize');
  if (exit !== 0) {
    throw new Error(`Overlay WebM finalize failed (exit ${exit}).`);
  }
}

function buildFinalizeStrategies(fps: number): { name: string; args: string[] }[] {
  // BUG FIX: compare harness canvas video vanished after drawtext finished
  // Fix: try stream-copy remux first — preserves MediaRecorder alpha, fast, and avoids
  //      noisy libvpx-vp8 failures in the trimmed FFmpeg WASM build.
  // Sync: subtitle-controls.ts compare harness (canvas overlay must stay visible)
  return [
    {
      name: 'vp8-copy-remux',
      args: [
        '-fflags',
        '+genpts',
        '-i',
        INPUT_WEBM,
        '-an',
        '-c:v',
        'copy',
        '-f',
        'webm',
        OUTPUT_WEBM,
      ],
    },
    {
      name: 'vp8-yuva-reencode',
      args: [
        '-fflags',
        '+genpts',
        '-i',
        INPUT_WEBM,
        '-r',
        String(fps),
        '-an',
        '-c:v',
        'libvpx-vp8',
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
        OUTPUT_WEBM,
      ],
    },
  ];
}

/**
 * Rebuild overlay WebM with seek index (Cues) and alpha-friendly VP8 when possible.
 * Falls back to the raw blob if every strategy fails.
 */
export async function finalizeOverlayWebm(rawBlob: Blob, fps: number): Promise<Blob> {
  return withTranscodeLock(async () => {
    const ffmpeg = await loadFfmpeg();
    const inputBytes = new Uint8Array(await rawBlob.arrayBuffer());
    await ffmpeg.writeFile(INPUT_WEBM, inputBytes.slice());

    let lastError: unknown = null;

    for (const strategy of buildFinalizeStrategies(fps)) {
      await safeDeleteFile(ffmpeg, OUTPUT_WEBM);

      const { lines, detach } = attachLogCollector(ffmpeg);
      try {
        await execFinalize(ffmpeg, strategy.args);
        const output = (await ffmpeg.readFile(OUTPUT_WEBM)) as Uint8Array;
        if (output.byteLength > 0) {
          console.log(
            `${EXTENSION_LOG_PREFIX} Overlay WebM finalized via ${strategy.name} (${output.byteLength} bytes)`,
          );
          await safeDeleteFile(ffmpeg, INPUT_WEBM);
          await safeDeleteFile(ffmpeg, OUTPUT_WEBM);
          return new Blob([output.slice()], { type: 'video/webm' });
        }
      } catch (error: unknown) {
        lastError = error;
        const tail = lines
          .filter((line) => /error|invalid|unknown encoder|failed|cannot|not found/i.test(line))
          .slice(-4)
          .join(' | ');
        console.warn(
          `${EXTENSION_LOG_PREFIX} Overlay WebM finalize strategy ${strategy.name} failed`,
          error,
          tail || undefined,
        );
      } finally {
        detach();
      }
    }

    await safeDeleteFile(ffmpeg, INPUT_WEBM);
    await safeDeleteFile(ffmpeg, OUTPUT_WEBM);

    console.warn(
      `${EXTENSION_LOG_PREFIX} Overlay WebM finalize fell back to raw MediaRecorder blob`,
      lastError,
    );
    return rawBlob;
  });
}

function buildCompositeAlphaNormalizeStrategies(fps: number): {
  name: string;
  inputOpts: string[];
  outputArgs: string[];
}[] {
  const encodeTail = [
    '-r',
    String(fps),
    '-an',
    '-c:v',
    'libvpx-vp8',
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
    COMPOSITE_ALPHA_OUTPUT,
  ];

  return [
    {
      name: 'libvpx-decode-yuva',
      inputOpts: ['-c:v', 'libvpx-vp8'],
      outputArgs: ['-fflags', '+genpts', ...encodeTail],
    },
    {
      name: 'generic-decode-yuva',
      inputOpts: [],
      outputArgs: ['-fflags', '+genpts', ...encodeTail],
    },
  ];
}

/**
 * Re-encode overlay WebM with an explicit yuva420p VP8 alpha plane for FFmpeg composite.
 * Preview finalize keeps stream-copy first; this path is for burn-in only.
 * Sync: subtitle-burnin.ts canvas overlay composite tiers
 */
export async function normalizeOverlayWebmForComposite(rawBlob: Blob, fps: number): Promise<Blob> {
  return withTranscodeLock(async () => {
    const ffmpeg = await loadFfmpeg();
    const inputBytes = new Uint8Array(await rawBlob.arrayBuffer());
    await ffmpeg.writeFile(COMPOSITE_ALPHA_INPUT, inputBytes.slice());

    let lastError: unknown = null;

    for (const strategy of buildCompositeAlphaNormalizeStrategies(fps)) {
      await safeDeleteFile(ffmpeg, COMPOSITE_ALPHA_OUTPUT);

      const { lines, detach } = attachLogCollector(ffmpeg);
      try {
        await execFinalize(ffmpeg, [...strategy.inputOpts, '-i', COMPOSITE_ALPHA_INPUT, ...strategy.outputArgs]);
        const output = (await ffmpeg.readFile(COMPOSITE_ALPHA_OUTPUT)) as Uint8Array;
        if (output.byteLength > 0) {
          console.log(
            `${EXTENSION_LOG_PREFIX} Overlay alpha normalize via ${strategy.name} (${output.byteLength} bytes)`,
          );
          await safeDeleteFile(ffmpeg, COMPOSITE_ALPHA_INPUT);
          await safeDeleteFile(ffmpeg, COMPOSITE_ALPHA_OUTPUT);
          return new Blob([output.slice()], { type: 'video/webm' });
        }
      } catch (error: unknown) {
        lastError = error;
        const tail = lines
          .filter((line) => /error|invalid|unknown encoder|failed|cannot|not found/i.test(line))
          .slice(-4)
          .join(' | ');
        console.warn(
          `${EXTENSION_LOG_PREFIX} Overlay alpha normalize ${strategy.name} failed`,
          error,
          tail || undefined,
        );
      } finally {
        detach();
      }
    }

    await safeDeleteFile(ffmpeg, COMPOSITE_ALPHA_INPUT);
    await safeDeleteFile(ffmpeg, COMPOSITE_ALPHA_OUTPUT);

    console.warn(
      `${EXTENSION_LOG_PREFIX} Overlay alpha normalize fell back to raw MediaRecorder blob`,
      lastError,
    );
    return rawBlob;
  });
}