import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import {
  BURNIN_FONT_ASSET,
  BURNIN_FONT_FS_PATH,
  BURNIN_INPUT_MP4,
  BURNIN_OUTPUT_MP4,
  burnInLogIndicatesFailure,
  buildBurnInStrategies,
  type SubtitleBurnInInput,
} from '@/src/ffmpeg/subtitle-burnin';
import { EXTENSION_LOG_PREFIX, WAVEFORM_TARGET_FPS } from '@/src/utils/constants';
import { buildFfmpegAudioFilter } from '@/src/voice/filter-graphs';
import { voiceEffectIsActive } from '@/src/voice/resolve-config';
import {
  DEFAULT_VOICE_EFFECT_CONFIG,
  normalizeVoiceEffectConfig,
  type VoiceEffectConfig,
} from '@/src/voice/types';

export type FfmpegProgressCallback = (ratio: number, stage: string) => void;

const WEBM_EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3] as const;
const MIN_WEBM_BYTES = 256;

/** Flat per-strategy exec ceiling — size scaling caused false stalls on healthy jobs. */
const STRATEGY_EXEC_TIMEOUT_MS = 75_000;
const LOAD_FFMPEG_TIMEOUT_MS = 30_000;
const WASM_SETTLE_MS = 200;
const OUTPUT_FRAME_RATE = String(WAVEFORM_TARGET_FPS);
/** BUG-007: abort encode when FFmpeg duplicates frames to a bogus high-fps timeline. */
const DUP_STORM_MIN_DUP = 100;
const DUP_STORM_FRAME_RATIO = 0.5;
const DUP_STORM_POLL_MS = 200;

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

function extensionAsset(path: string): string {
  return browser.runtime.getURL(path as never);
}

function wasmSettle(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, WASM_SETTLE_MS);
  });
}

async function assertAssetReachable(label: string, url: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${label} not reachable (${response.status}): ${url}`);
  }
}

function isValidWebm(bytes: Uint8Array): boolean {
  if (bytes.byteLength < MIN_WEBM_BYTES) return false;
  return WEBM_EBML_MAGIC.every((value, index) => bytes[index] === value);
}

function isFfmpegVersionBanner(line: string): boolean {
  const trimmed = line.trim();
  return (
    /libavcodec\s+\d/.test(trimmed) ||
    /libavformat\s+\d/.test(trimmed) ||
    /libavutil\s+\d/.test(trimmed) ||
    trimmed.startsWith('ffmpeg version')
  );
}

function parseFfmpegProgressLine(line: string): { frame: number; dup: number } | null {
  const match = line.match(/frame=\s*(\d+).*?\bdup=(\d+)/);
  if (!match) return null;
  return { frame: Number.parseInt(match[1], 10), dup: Number.parseInt(match[2], 10) };
}

function isDupStormProgress(frame: number, dup: number): boolean {
  if (dup >= DUP_STORM_MIN_DUP) return true;
  return frame > 0 && dup / frame >= DUP_STORM_FRAME_RATIO;
}

/** Detect FFmpeg CFR sync runaway on WebM with broken PTS (BUG-007). */
function shouldAbortDupStorm(line: string): boolean {
  if (/more than \d+ frames duplicated/i.test(line)) return true;
  const progress = parseFfmpegProgressLine(line);
  return progress !== null && isDupStormProgress(progress.frame, progress.dup);
}

function attachLogCollector(
  ffmpeg: FFmpeg,
  onLine?: (line: string) => void,
): { lines: string[]; detach: () => void } {
  const lines: string[] = [];
  const handler = ({ message }: { message: string }) => {
    lines.push(message);
    onLine?.(message);
    console.log(`${EXTENSION_LOG_PREFIX} [ffmpeg]`, message);
  };
  ffmpeg.on('log', handler);
  return {
    lines,
    detach: () => ffmpeg.off('log', handler),
  };
}

function summarizeFfmpegLogs(lines: string[]): string {
  const interesting = lines.filter((line) => {
    if (isFfmpegVersionBanner(line)) return false;
    const lower = line.toLowerCase();
    return (
      lower.includes('error') ||
      lower.includes('invalid') ||
      lower.includes('unknown encoder') ||
      lower.includes('failed') ||
      lower.includes('not found') ||
      lower.includes('cannot') ||
      lower.includes('no such')
    );
  });
  const fallback = lines.filter((line) => !isFfmpegVersionBanner(line));
  const tail = (interesting.length > 0 ? interesting : fallback).slice(-6);
  return tail.join(' | ');
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

export async function loadFfmpeg(onProgress?: FfmpegProgressCallback): Promise<FFmpeg> {
  if (ffmpegInstance?.loaded) {
    onProgress?.(0.2, 'ready');
    return ffmpegInstance;
  }

  if (loadPromise) return withTimeout(loadPromise, LOAD_FFMPEG_TIMEOUT_MS, 'FFmpeg load');

  loadPromise = (async () => {
    onProgress?.(0.05, 'checking-assets');

    const workerUrl = extensionAsset('ffmpeg/esm/worker.js');
    const coreJsUrl = extensionAsset('ffmpeg/ffmpeg-core.js');
    const coreWasmUrl = extensionAsset('ffmpeg/ffmpeg-core.wasm');

    await assertAssetReachable('FFmpeg worker', workerUrl);
    await assertAssetReachable('FFmpeg core JS', coreJsUrl);
    await assertAssetReachable('FFmpeg core WASM', coreWasmUrl);

    onProgress?.(0.08, 'loading-wasm');

    const ffmpeg = new FFmpeg();
    const { detach } = attachLogCollector(ffmpeg);

    try {
      // BUG FIX: FFmpeg worker hung at 0% / failed to load
      // Fix: Worker is an ES module importing ./const.js etc.; load from extension URL (not blob).
      // Sync: wxt.config.ts web_accessible_resources must include ffmpeg/* and ffmpeg/esm/*
      // BUG FIX: dynamic import blob:chrome-extension://… failed in module worker
      // Fix: Pass chrome-extension:// URLs for core + wasm; module workers cannot import() blob URLs.
      await ffmpeg.load({
        classWorkerURL: workerUrl,
        coreURL: coreJsUrl,
        wasmURL: coreWasmUrl,
      });
    } finally {
      detach();
    }

    if (!ffmpeg.loaded) {
      throw new Error('FFmpeg reported load complete but loaded=false.');
    }

    console.log(`${EXTENSION_LOG_PREFIX} FFmpeg WASM loaded`);
    onProgress?.(0.2, 'loaded');
    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })().catch((error) => {
    loadPromise = null;
    ffmpegInstance = null;
    throw error;
  });

  return withTimeout(loadPromise, LOAD_FFMPEG_TIMEOUT_MS, 'FFmpeg load');
}

// BUG FIX: FFmpeg frame duplication storm on bad WebM timestamps (BUG-007)
// Fix: passthrough + output -r on primary encode; fps filter fallback; early dup-storm abort + retry.
// Sync: docs/bug-archive.md BUG-007, pretty-branch.md § pretty-9
/**
 * Reddit-ready encode first; timestamp-repair fallbacks before remux-only.
 */
const TRANSCODE_STRATEGIES = [
  {
    name: 'h264-aac',
    args: [
      '-fflags',
      '+genpts+igndts',
      '-i',
      'input.webm',
      '-fps_mode',
      'passthrough',
      '-r',
      OUTPUT_FRAME_RATE,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      'output.mp4',
    ],
  },
  {
    name: 'h264-aac-fps',
    args: [
      '-fflags',
      '+genpts+igndts',
      '-i',
      'input.webm',
      '-vf',
      `fps=${OUTPUT_FRAME_RATE}`,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      'output.mp4',
    ],
  },
  {
    name: 'faststart',
    args: ['-i', 'input.webm', '-movflags', '+faststart', 'output.mp4'],
  },
] as const;

export interface RunWebmToMp4Result {
  bytes: Uint8Array;
  /** True when voice -af failed and export used raw audio (dulcet-3). */
  voiceEffectFallback?: boolean;
}

function injectAudioFilter(args: readonly string[], audioFilter: string | null): string[] {
  if (!audioFilter) return [...args];
  const result = [...args];
  const audioCodecIndex = result.indexOf('-c:a');
  if (audioCodecIndex === -1) return result;
  result.splice(audioCodecIndex, 0, '-af', audioFilter);
  return result;
}

function strategyArgs(
  strategy: (typeof TRANSCODE_STRATEGIES)[number],
  audioFilter: string | null,
): string[] {
  if (strategy.name === 'faststart') return [...strategy.args];
  return injectAudioFilter(strategy.args, audioFilter);
}

async function safeDeleteFile(ffmpeg: FFmpeg, path: string): Promise<void> {
  try {
    await ffmpeg.deleteFile(path);
  } catch {
    // Output may not exist after a failed attempt.
  }
}

async function writeInputWebm(ffmpeg: FFmpeg, inputBytes: Uint8Array): Promise<void> {
  await safeDeleteFile(ffmpeg, 'input.webm');
  // BUG FIX: ArrayBuffer detached on Worker postMessage
  // Fix: ffmpeg.writeFile() transfers the backing buffer to the worker; each strategy needs a fresh copy.
  await ffmpeg.writeFile('input.webm', inputBytes.slice());
}

type ExecResult = { exitCode: number; timedOut: boolean; dupStorm?: boolean };

async function execWithTimeout(
  ffmpeg: FFmpeg,
  args: string[],
  timeoutMs: number,
  abortRef?: { dupStorm: boolean },
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (result: ExecResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.clearInterval(dupPoll);
      resolve(result);
    };

    const timer = window.setTimeout(() => {
      finish({
        exitCode: -1,
        timedOut: true,
      });
      console.warn(
        `${EXTENSION_LOG_PREFIX} FFmpeg strategy timed out after ${Math.round(timeoutMs / 1000)}s — terminating worker`,
      );
      disposeFfmpeg();
    }, timeoutMs);

    const dupPoll = window.setInterval(() => {
      if (!abortRef?.dupStorm || settled) return;
      console.warn(
        `${EXTENSION_LOG_PREFIX} FFmpeg dup storm detected — aborting strategy early (BUG-007)`,
      );
      disposeFfmpeg();
      finish({ exitCode: -2, timedOut: false, dupStorm: true });
    }, DUP_STORM_POLL_MS);

    void ffmpeg
      .exec(args)
      .then((exitCode) => {
        finish({ exitCode, timedOut: false });
      })
      .catch((error: unknown) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        window.clearInterval(dupPoll);
        reject(error);
      });
  });
}

async function transcodeWithStrategies(
  inputBytes: Uint8Array,
  onProgress?: FfmpegProgressCallback,
  onFfmpegRatio?: (ratio: number) => void,
  audioFilter: string | null = null,
): Promise<Uint8Array> {
  const attempts: string[] = [];

  for (const strategy of TRANSCODE_STRATEGIES) {
    const ffmpeg = await loadFfmpeg(onProgress);
    await writeInputWebm(ffmpeg, inputBytes);
    await safeDeleteFile(ffmpeg, 'output.mp4');
    const stageName = audioFilter
      ? `transcoding-${strategy.name}-voice-af`
      : `transcoding-${strategy.name}`;
    onProgress?.(0.2, stageName);

    const abortRef = { dupStorm: false };
    const { lines, detach } = attachLogCollector(ffmpeg, (line) => {
      if (shouldAbortDupStorm(line)) {
        abortRef.dupStorm = true;
      }
    });
    let result: ExecResult = { exitCode: 1, timedOut: false };

    const progressHandler = onFfmpegRatio
      ? ({ progress }: { progress: number }) => onFfmpegRatio(progress)
      : null;
    if (progressHandler) ffmpeg.on('progress', progressHandler);

    try {
      result = await execWithTimeout(
        ffmpeg,
        strategyArgs(strategy, audioFilter),
        STRATEGY_EXEC_TIMEOUT_MS,
        abortRef,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      attempts.push(`${strategy.name}: ${detail}`);
      console.warn(`${EXTENSION_LOG_PREFIX} Transcode attempt threw (${strategy.name})`, detail);
      disposeFfmpeg();
      await wasmSettle();
    } finally {
      if (progressHandler) ffmpeg.off('progress', progressHandler);
      detach();
    }

    if (result.timedOut) {
      attempts.push(
        `${strategy.name}: timed out after ${Math.round(STRATEGY_EXEC_TIMEOUT_MS / 1000)}s`,
      );
      await wasmSettle();
      continue;
    }

    if (result.dupStorm) {
      attempts.push(`${strategy.name}: dup storm — retrying with next strategy`);
      await wasmSettle();
      continue;
    }

    if (result.exitCode === 0) {
      console.log(`${EXTENSION_LOG_PREFIX} Transcode succeeded (${strategy.name})`);
      const output = (await ffmpeg.readFile('output.mp4')) as Uint8Array;
      await safeDeleteFile(ffmpeg, 'input.webm');
      await safeDeleteFile(ffmpeg, 'output.mp4');
      return output;
    }

    const summary = summarizeFfmpegLogs(lines);
    attempts.push(`${strategy.name}: exit ${result.exitCode}${summary ? ` — ${summary}` : ''}`);
    console.warn(`${EXTENSION_LOG_PREFIX} Transcode attempt failed (${strategy.name})`, summary);
  }

  disposeFfmpeg();
  throw new Error(
    `FFmpeg transcoding failed after ${TRANSCODE_STRATEGIES.length} attempts. ${attempts.join(' || ')}`,
  );
}

function mapProgress(ratio: number, stage: string): number {
  if (stage === 'loading-wasm') return 0.05 + ratio * 0.15;
  if (stage.startsWith('transcoding')) return 0.2 + ratio * 0.75;
  return ratio;
}

export async function runWebmToMp4(
  webm: Uint8Array | ArrayBuffer,
  onProgress?: FfmpegProgressCallback,
  voiceEffect?: VoiceEffectConfig,
): Promise<RunWebmToMp4Result> {
  const report = (ratio: number, stage: string) => {
    onProgress?.(mapProgress(ratio, stage), stage);
  };

  report(0, 'starting');

  const raw = webm instanceof Uint8Array ? webm : new Uint8Array(webm);
  const inputBytes = raw.slice();
  if (!isValidWebm(inputBytes)) {
    throw new Error(
      `Recording is not a valid WebM file (${inputBytes.byteLength} bytes). Try recording again.`,
    );
  }

  const normalizedVoice = normalizeVoiceEffectConfig(voiceEffect ?? DEFAULT_VOICE_EFFECT_CONFIG);
  const { filter: voiceFilter } = buildFfmpegAudioFilter(normalizedVoice);
  const audioFilter =
    voiceFilter && voiceEffectIsActive(normalizedVoice) ? voiceFilter : null;

  const runEncode = async (filter: string | null): Promise<Uint8Array> =>
    transcodeWithStrategies(
      inputBytes,
      (ratio, stage) => {
        if (stage === 'loaded' || stage === 'loading-wasm' || stage === 'checking-assets') {
          report(ratio, stage === 'loaded' ? 'loading-wasm' : stage);
          return;
        }
        report(ratio, stage);
      },
      (ratio) => report(Math.min(1, Math.max(0, ratio)), 'transcoding'),
      filter,
    );

  try {
    onProgress?.(0.18, 'writing-input');

    if (audioFilter) {
      try {
        const output = await runEncode(audioFilter);
        onProgress?.(1, 'done');
        return { bytes: output };
      } catch (voiceError) {
        const detail = voiceError instanceof Error ? voiceError.message : String(voiceError);
        console.warn(
          `${EXTENSION_LOG_PREFIX} Voice -af transcode failed — falling back to raw audio`,
          detail,
        );
        disposeFfmpeg();
        onProgress?.(0.2, 'voice-fallback');
        const output = await runEncode(null);
        onProgress?.(1, 'done');
        return { bytes: output, voiceEffectFallback: true };
      }
    }

    const output = await runEncode(null);
    onProgress?.(1, 'done');
    return { bytes: output };
  } catch (error) {
    // BUG FIX: Poisoned FFmpeg singleton after hung/failed transcode
    // Fix: Terminate WASM worker so the next job starts from a clean virtual FS.
    disposeFfmpeg();
    throw error;
  }
}

// BUG FIX: drawtext font not rendering in WASM offscreen context
// Fix: Use fetchFile (@ffmpeg/util pattern) + absolute FS path + read-back verification.
// Sync: BURNIN_FONT_FS_PATH in subtitle-burnin.ts (must be absolute to avoid CWD ambiguity in FreeType)
async function writeBurnInFont(ffmpeg: FFmpeg, fontAsset: string = BURNIN_FONT_ASSET): Promise<void> {
  await safeDeleteFile(ffmpeg, BURNIN_FONT_FS_PATH);
  const url = extensionAsset(fontAsset);
  console.log(`${EXTENSION_LOG_PREFIX} Burn-in font: fetching ${url}`);
  const bytes = await fetchFile(url);
  console.log(`${EXTENSION_LOG_PREFIX} Burn-in font: ${bytes.byteLength} bytes loaded`);
  if (bytes.byteLength === 0) {
    throw new Error(`Burn-in font fetched 0 bytes — asset missing or unreachable: ${url}`);
  }
  await ffmpeg.writeFile(BURNIN_FONT_FS_PATH, bytes.slice());
  const verify = (await ffmpeg.readFile(BURNIN_FONT_FS_PATH)) as Uint8Array;
  console.log(`${EXTENSION_LOG_PREFIX} Burn-in font: ${verify.byteLength} bytes in WASM FS at ${BURNIN_FONT_FS_PATH}`);
  if (verify.byteLength === 0) {
    throw new Error(`Burn-in font write failed — 0 bytes at ${BURNIN_FONT_FS_PATH} after writeFile`);
  }
}

async function writeBurnInExtras(
  ffmpeg: FFmpeg,
  extraFiles: Record<string, string | Uint8Array> | undefined,
): Promise<void> {
  if (!extraFiles) return;
  for (const [path, contents] of Object.entries(extraFiles)) {
    await safeDeleteFile(ffmpeg, path);
    if (typeof contents === 'string') {
      await ffmpeg.writeFile(path, new TextEncoder().encode(contents));
      continue;
    }
    await ffmpeg.writeFile(path, contents);
  }
}

async function burnInWithStrategies(
  inputBytes: Uint8Array,
  burnIn: SubtitleBurnInInput,
  onProgress?: FfmpegProgressCallback,
): Promise<Uint8Array> {
  const strategies = buildBurnInStrategies(burnIn);
  const attempts: string[] = [];

  for (const strategy of strategies) {
    const ffmpeg = await loadFfmpeg(onProgress);
    await safeDeleteFile(ffmpeg, BURNIN_INPUT_MP4);
    await safeDeleteFile(ffmpeg, BURNIN_OUTPUT_MP4);
    await ffmpeg.writeFile(BURNIN_INPUT_MP4, inputBytes.slice());
    if (strategy.requiresFont) {
      await writeBurnInFont(ffmpeg, strategy.fontAsset);
    }
    await writeBurnInExtras(ffmpeg, strategy.extraFiles);

    const stageName = `burnin-${strategy.name}`;
    onProgress?.(0.2, stageName);

    const { lines, detach } = attachLogCollector(ffmpeg);
    let result: ExecResult = { exitCode: 1, timedOut: false };

    const progressHandler = ({ progress }: { progress: number }) => {
      onProgress?.(0.2 + progress * 0.75, stageName);
    };
    ffmpeg.on('progress', progressHandler);

    try {
      result = await execWithTimeout(ffmpeg, strategy.args, STRATEGY_EXEC_TIMEOUT_MS);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      attempts.push(`${strategy.name}: ${detail}`);
      disposeFfmpeg();
      await wasmSettle();
    } finally {
      ffmpeg.off('progress', progressHandler);
      detach();
    }

    if (result.timedOut) {
      attempts.push(`${strategy.name}: timed out`);
      await wasmSettle();
      continue;
    }

    if (result.exitCode === 0) {
      const logFailure = burnInLogIndicatesFailure(lines);
      if (logFailure) {
        attempts.push(`${strategy.name}: ffmpeg log indicates failure (${logFailure})`);
        console.warn(
          `${EXTENSION_LOG_PREFIX} Burn-in attempt rejected from logs (${strategy.name})`,
          logFailure,
        );
        disposeFfmpeg();
        await wasmSettle();
        continue;
      }

      const output = (await ffmpeg.readFile(BURNIN_OUTPUT_MP4)) as Uint8Array;
      if (!output || output.byteLength < 256) {
        attempts.push(`${strategy.name}: empty output`);
        disposeFfmpeg();
        await wasmSettle();
        continue;
      }

      console.log(`${EXTENSION_LOG_PREFIX} Subtitle burn-in succeeded (${strategy.name})`, {
        inputBytes: inputBytes.byteLength,
        outputBytes: output.byteLength,
      });
      await safeDeleteFile(ffmpeg, BURNIN_INPUT_MP4);
      await safeDeleteFile(ffmpeg, BURNIN_OUTPUT_MP4);
      await safeDeleteFile(ffmpeg, BURNIN_FONT_FS_PATH);
      if (strategy.extraFiles) {
        for (const path of Object.keys(strategy.extraFiles)) {
          await safeDeleteFile(ffmpeg, path);
        }
      }
      return output;
    }

    const summary = summarizeFfmpegLogs(lines);
    attempts.push(`${strategy.name}: exit ${result.exitCode}${summary ? ` — ${summary}` : ''}`);
    console.warn(`${EXTENSION_LOG_PREFIX} Burn-in attempt failed (${strategy.name})`, summary);
    disposeFfmpeg();
    await wasmSettle();
  }

  disposeFfmpeg();
  throw new Error(
    `Subtitle burn-in failed after ${strategies.length} attempts. ${attempts.join(' || ')}`,
  );
}

/** Second FFmpeg pass: hard-burn subtitles onto base.mp4 (eloquent-3). */
export async function runSubtitleBurnIn(
  mp4: Uint8Array | ArrayBuffer,
  burnIn: SubtitleBurnInInput,
  onProgress?: FfmpegProgressCallback,
): Promise<Uint8Array> {
  const raw = mp4 instanceof Uint8Array ? mp4 : new Uint8Array(mp4);
  const inputBytes = raw.slice();
  if (inputBytes.byteLength < 256) {
    throw new Error('Base MP4 is empty or too small for subtitle burn-in.');
  }

  try {
    onProgress?.(0.05, 'burnin-start');
    const output = await burnInWithStrategies(inputBytes, burnIn, onProgress);
    onProgress?.(1, 'burnin-done');
    return output;
  } catch (error) {
    disposeFfmpeg();
    throw error;
  }
}

export function disposeFfmpeg(): void {
  if (ffmpegInstance) {
    try {
      ffmpegInstance.terminate();
    } catch {
      // ignore
    }
  }
  ffmpegInstance = null;
  loadPromise = null;
}