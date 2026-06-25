import type { FFmpeg } from '@ffmpeg/ffmpeg';
import {
  attachLogCollector,
  disposeFfmpeg,
  loadFfmpeg,
  type FfmpegProgressCallback,
} from '@/src/ffmpeg/ffmpeg-runner';
import { EXTENSION_LOG_PREFIX } from '@/src/utils/constants';
import { buildFfmpegAudioFilter } from './filter-graphs';
import {
  normalizeVoiceEffectConfig,
  type VoiceEffectConfig,
} from './types';
import { voiceEffectIsActive } from './resolve-config';
import {
  buildStylizedGraph,
  normalizeStylizedGraph,
  type FfmpegGraphResult,
  type StylizedGraph,
} from './dsp';

const WEBM_EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3] as const;
const MIN_INPUT_BYTES = 256;
/** Audio-only pass — shorter than full mux transcode but includes loudnorm worst case. */
const VOICE_PROCESS_TIMEOUT_MS = 45_000;
const WASM_SETTLE_MS = 200;

const INPUT_PATH = 'voice-input.webm';
// BUG FIX: voice exec OOB ("memory access out of bounds") on every harness run
// Fix: libopus is absent/broken in the shipped @ffmpeg/core 0.12 build, so the
// encoder init crashed as a generic OOB. Encode AAC/M4A instead — the same proven
// encoder the shipped WebM→MP4 transcode uses (ffmpeg-runner TRANSCODE_STRATEGIES).
// Sync: buildVoiceProcessArgs + buildGraphProcessArgs codec; success-return mimeType.
const OUTPUT_PATH = 'voice-output.m4a';

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
  // Surface ffmpeg's own stderr (filter/encoder errors) — a bare exec OOB is otherwise opaque.
  const { detach } = attachLogCollector(ffmpeg);
  try {
    return await execWithTimeoutInner(ffmpeg, args, timeoutMs);
  } finally {
    detach();
  }
}

function execWithTimeoutInner(ffmpeg: FFmpeg, args: string[], timeoutMs: number): Promise<number> {
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
    'aac',
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
      mimeType: 'audio/mp4',
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

/* ------------------------------------------------------------------ *
 * Dulcet II (v5) — StylizedGraph processing path (Sub-Phase 1.3, step 1).
 *
 * Runs the new fragment graph through ffmpeg.wasm. Additive: the legacy
 * VoiceEffectConfig path above is untouched; storage / live-export wiring lands
 * in later 1.3 steps. Supports both the linear `-af` chain and the complex
 * `-filter_complex` graph (extra `-i` aux WAVs for convolution + `-map`).
 * ------------------------------------------------------------------ */

const AUX_PATH = (index: number) => `voice-aux-${index}.wav`;
/** Complex graphs (convolution, multi-stage) are heavier than a linear chain. */
const GRAPH_COMPLEX_TIMEOUT_MS = 120_000;

/** Build ffmpeg args for a rendered graph result (pure; aux paths match input order). */
function buildGraphProcessArgs(
  result: FfmpegGraphResult,
  auxPaths: string[],
  maxDurationSeconds?: number,
): string[] {
  const args = ['-i', INPUT_PATH];
  for (const auxPath of auxPaths) args.push('-i', auxPath);

  if (result.mode === 'complex' && result.filterComplex && result.outputLabel) {
    // -map the labeled audio pad; video is simply never referenced by the graph.
    args.push('-filter_complex', result.filterComplex, '-map', `[${result.outputLabel}]`);
  } else if (result.mode === 'af' && result.af) {
    args.push('-vn', '-af', result.af);
  } else {
    args.push('-vn');
  }

  // Preview-only duration cap (Branch 3 §3.2): limits the rendered output so long
  // recordings audition fast. Never passed by the export path → bakes stay full-length.
  if (typeof maxDurationSeconds === 'number' && maxDurationSeconds > 0) {
    args.push('-t', String(maxDurationSeconds));
  }

  args.push('-c:a', 'aac', '-b:a', '128k', OUTPUT_PATH);
  return args;
}

/** Options for the graph processor — preview tuning that the export path never sets. */
export interface GraphProcessOptions {
  /** Cap the rendered output duration (seconds). Used by the one-shot Studio preview. */
  maxDurationSeconds?: number;
}

/**
 * Process audio bytes with a {@link StylizedGraph}. Disabled / no-op graphs and
 * any failure return the input bytes unchanged (non-destructive, same contract
 * as {@link processAudioBytes}).
 */
export async function processAudioBytesWithGraph(
  inputBytes: Uint8Array,
  graph: StylizedGraph,
  onProgress?: FfmpegProgressCallback,
  options?: GraphProcessOptions,
): Promise<ProcessAudioBytesResult> {
  const startedAt = Date.now();
  const normalized = normalizeStylizedGraph(graph);
  const inputCopy = inputBytes.slice();
  const result = buildStylizedGraph(normalized);

  if (result.mode === 'none') {
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
    console.warn(`${EXTENSION_LOG_PREFIX} Voice graph skipped — invalid WebM input`);
    return {
      bytes: inputCopy,
      mimeType: 'video/webm',
      applied: false,
      fallback: true,
      stage: 'voice-invalid-input',
      elapsedMs: Date.now() - startedAt,
    };
  }

  const stage = result.stages[result.stages.length - 1] ?? 'voice-graph';
  const auxPaths = result.auxInputs.map((_, index) => AUX_PATH(index));
  const timeout = result.mode === 'complex' ? GRAPH_COMPLEX_TIMEOUT_MS : VOICE_PROCESS_TIMEOUT_MS;

  // Heavy parallel graphs (stacked resamplers, convolution, multi-stage amix) are
  // sensitive to accumulated ffmpeg.wasm heap state across runs — an intermittent
  // exit-1/OOM that doesn't recur on a fresh instance. Start complex graphs clean.
  if (result.mode === 'complex') disposeFfmpeg();

  onProgress?.(0.05, 'voice-loading-wasm');

  try {
    const ffmpeg = await loadFfmpeg(onProgress);
    await safeDeleteFile(ffmpeg, INPUT_PATH);
    await safeDeleteFile(ffmpeg, OUTPUT_PATH);
    for (const auxPath of auxPaths) await safeDeleteFile(ffmpeg, auxPath);

    // BUG FIX: ArrayBuffer detached on Worker postMessage
    // Fix: ffmpeg.writeFile() transfers the backing buffer; pass a fresh slice per write.
    // Sync: same rule as processAudioBytes() input write above.
    await ffmpeg.writeFile(INPUT_PATH, inputCopy.slice());
    for (let i = 0; i < result.auxInputs.length; i++) {
      await ffmpeg.writeFile(auxPaths[i], result.auxInputs[i].bytes.slice());
    }

    onProgress?.(0.2, stage);

    const exitCode = await execWithTimeout(
      ffmpeg,
      buildGraphProcessArgs(result, auxPaths, options?.maxDurationSeconds),
      timeout,
    );
    if (exitCode !== 0) {
      throw new Error(`Voice graph FFmpeg exited with code ${exitCode}`);
    }

    const output = (await ffmpeg.readFile(OUTPUT_PATH)) as Uint8Array;
    if (!output?.byteLength) {
      throw new Error('Voice graph FFmpeg produced empty output.');
    }

    await safeDeleteFile(ffmpeg, INPUT_PATH);
    await safeDeleteFile(ffmpeg, OUTPUT_PATH);
    for (const auxPath of auxPaths) await safeDeleteFile(ffmpeg, auxPath);

    onProgress?.(1, 'voice-done');

    return {
      bytes: output.slice(),
      mimeType: 'audio/mp4',
      applied: true,
      fallback: false,
      stage,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    disposeFfmpeg();
    await wasmSettle();
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`${EXTENSION_LOG_PREFIX} Voice graph process failed — returning raw audio`, detail);

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

/** Blob convenience wrapper around {@link processAudioBytesWithGraph}. */
export async function processAudioWithGraph(
  input: Blob,
  graph: StylizedGraph,
  onProgress?: FfmpegProgressCallback,
  options?: GraphProcessOptions,
): Promise<ProcessAudioResult> {
  const inputBytes = new Uint8Array(await input.arrayBuffer());
  const result = await processAudioBytesWithGraph(inputBytes, graph, onProgress, options);

  return {
    blob: new Blob([Uint8Array.from(result.bytes)], { type: result.mimeType }),
    applied: result.applied,
    fallback: result.fallback,
    stage: result.stage,
    elapsedMs: result.elapsedMs,
  };
}