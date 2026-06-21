import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { disposeFfmpeg, loadFfmpeg, type FfmpegProgressCallback } from '@/src/ffmpeg/ffmpeg-runner';
import { EXTENSION_LOG_PREFIX } from '@/src/utils/constants';
import { buildFfmpegAudioFilter } from './filter-graphs';
import {
  normalizeVoiceEffectConfig,
  voiceEffectIsActive,
  type VoiceEffectConfig,
} from './types';

const WEBM_EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3] as const;
const MIN_INPUT_BYTES = 256;
/** Audio-only pass — shorter than full mux transcode but includes loudnorm worst case. */
const VOICE_PROCESS_TIMEOUT_MS = 45_000;
const WASM_SETTLE_MS = 200;

const INPUT_PATH = 'voice-input.webm';
const OUTPUT_PATH = 'voice-output.webm';

export interface ProcessAudioResult {
  blob: Blob;
  /** True when FFmpeg applied filters and produced new output bytes. */
  applied: boolean;
  /** True when processing failed and the original blob was returned unchanged. */
  fallback: boolean;
  stage: string;
  elapsedMs: number;
}

export interface ProcessAudioBytesResult {
  bytes: Uint8Array;
  mimeType: string;
  applied: boolean;
  fallback: boolean;
  stage: string;
  elapsedMs: number;
}

function wasmSettle(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, WASM_SETTLE_MS);
  });
}

function isValidWebm(bytes: Uint8Array): boolean {
  if (bytes.byteLength < MIN_INPUT_BYTES) return false;
  return WEBM_EBML_MAGIC.every((value, index) => bytes[index] === value);
}

async function safeDeleteFile(ffmpeg: FFmpeg, path: string): Promise<void> {
  try {
    await ffmpeg.deleteFile(path);
  } catch {
    // Output may not exist after a failed attempt.
  }
}

async function execWithTimeout(ffmpeg: FFmpeg, args: string[], timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn(
        `${EXTENSION_LOG_PREFIX} Voice process timed out after ${Math.round(timeoutMs / 1000)}s`,
      );
      disposeFfmpeg();
      resolve(-1);
    }, timeoutMs);

    void ffmpeg
      .exec(args)
      .then((exitCode) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(exitCode);
      })
      .catch((error: unknown) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

function buildVoiceProcessArgs(audioFilter: string): string[] {
  return [
    '-i',
    INPUT_PATH,
    '-vn',
    '-af',
    audioFilter,
    '-c:a',
    'libopus',
    '-b:a',
    '128k',
    OUTPUT_PATH,
  ];
}

/**
 * Isolated Dulcet audio processor (dulcet-1).
 * Extracts audio from a captured WebM, applies voice filters, returns Opus WebM.
 * Disabled configs and failures return the input bytes unchanged (non-destructive).
 */
export async function processAudioBytes(
  inputBytes: Uint8Array,
  config: VoiceEffectConfig,
  onProgress?: FfmpegProgressCallback,
): Promise<ProcessAudioBytesResult> {
  const startedAt = Date.now();
  const normalized = normalizeVoiceEffectConfig(config);
  const inputCopy = inputBytes.slice();

  if (!voiceEffectIsActive(normalized)) {
    return {
      bytes: inputCopy,
      mimeType: 'video/webm',
      applied: false,
      fallback: false,
      stage: 'voice-skip',
      elapsedMs: Date.now() - startedAt,
    };
  }

  if (!isValidWebm(inputCopy)) {
    console.warn(`${EXTENSION_LOG_PREFIX} Voice process skipped — invalid WebM input`);
    return {
      bytes: inputCopy,
      mimeType: 'video/webm',
      applied: false,
      fallback: true,
      stage: 'voice-invalid-input',
      elapsedMs: Date.now() - startedAt,
    };
  }

  const { filter, stage } = buildFfmpegAudioFilter(normalized);
  if (!filter) {
    return {
      bytes: inputCopy,
      mimeType: 'video/webm',
      applied: false,
      fallback: false,
      stage: 'voice-skip',
      elapsedMs: Date.now() - startedAt,
    };
  }

  onProgress?.(0.05, 'voice-loading-wasm');

  try {
    const ffmpeg = await loadFfmpeg(onProgress);
    await safeDeleteFile(ffmpeg, INPUT_PATH);
    await safeDeleteFile(ffmpeg, OUTPUT_PATH);
    // BUG FIX: ArrayBuffer detached on Worker postMessage
    // Fix: ffmpeg.writeFile() transfers the backing buffer; pass a fresh slice per job.
    await ffmpeg.writeFile(INPUT_PATH, inputCopy.slice());

    onProgress?.(0.2, stage);

    const exitCode = await execWithTimeout(
      ffmpeg,
      buildVoiceProcessArgs(filter),
      VOICE_PROCESS_TIMEOUT_MS,
    );

    if (exitCode !== 0) {
      throw new Error(`Voice FFmpeg exited with code ${exitCode}`);
    }

    const output = (await ffmpeg.readFile(OUTPUT_PATH)) as Uint8Array;
    if (!output?.byteLength) {
      throw new Error('Voice FFmpeg produced empty output.');
    }

    await safeDeleteFile(ffmpeg, INPUT_PATH);
    await safeDeleteFile(ffmpeg, OUTPUT_PATH);

    onProgress?.(1, 'voice-done');

    return {
      bytes: output.slice(),
      mimeType: 'audio/webm;codecs=opus',
      applied: true,
      fallback: false,
      stage,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    disposeFfmpeg();
    await wasmSettle();
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`${EXTENSION_LOG_PREFIX} Voice process failed — returning raw audio`, detail);

    return {
      bytes: inputCopy,
      mimeType: 'video/webm',
      applied: false,
      fallback: true,
      stage: 'voice-fallback',
      elapsedMs: Date.now() - startedAt,
    };
  }
}

export async function processAudio(
  input: Blob,
  config: VoiceEffectConfig,
  onProgress?: FfmpegProgressCallback,
): Promise<ProcessAudioResult> {
  const inputBytes = new Uint8Array(await input.arrayBuffer());
  const result = await processAudioBytes(inputBytes, config, onProgress);

  return {
    blob: new Blob([Uint8Array.from(result.bytes)], { type: result.mimeType }),
    applied: result.applied,
    fallback: result.fallback,
    stage: result.stage,
    elapsedMs: result.elapsedMs,
  };
}