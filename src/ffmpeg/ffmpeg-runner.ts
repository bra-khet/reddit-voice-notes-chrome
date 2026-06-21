import { FFmpeg } from '@ffmpeg/ffmpeg';
import { EXTENSION_LOG_PREFIX } from '@/src/utils/constants';

export type FfmpegProgressCallback = (ratio: number, stage: string) => void;

const WEBM_EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3] as const;
const MIN_WEBM_BYTES = 256;

/** Flat per-strategy exec ceiling — size scaling caused false stalls on healthy jobs. */
const STRATEGY_EXEC_TIMEOUT_MS = 75_000;
const LOAD_FFMPEG_TIMEOUT_MS = 30_000;
const WASM_SETTLE_MS = 200;

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

function attachLogCollector(ffmpeg: FFmpeg): { lines: string[]; detach: () => void } {
  const lines: string[] = [];
  const handler = ({ message }: { message: string }) => {
    lines.push(message);
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

async function loadFfmpeg(onProgress?: FfmpegProgressCallback): Promise<FFmpeg> {
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

/** Reddit-ready encode first; remux-only fallback second. Fewer strategies = fewer stall windows. */
const TRANSCODE_STRATEGIES = [
  {
    name: 'h264-aac',
    args: [
      '-i',
      'input.webm',
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

type ExecResult = { exitCode: number; timedOut: boolean };

async function execWithTimeout(
  ffmpeg: FFmpeg,
  args: string[],
  timeoutMs: number,
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn(
        `${EXTENSION_LOG_PREFIX} FFmpeg strategy timed out after ${Math.round(timeoutMs / 1000)}s — terminating worker`,
      );
      disposeFfmpeg();
      resolve({ exitCode: -1, timedOut: true });
    }, timeoutMs);

    void ffmpeg
      .exec(args)
      .then((exitCode) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve({ exitCode, timedOut: false });
      })
      .catch((error: unknown) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

async function transcodeWithStrategies(
  inputBytes: Uint8Array,
  onProgress?: FfmpegProgressCallback,
  onFfmpegRatio?: (ratio: number) => void,
): Promise<Uint8Array> {
  const attempts: string[] = [];

  for (const strategy of TRANSCODE_STRATEGIES) {
    const ffmpeg = await loadFfmpeg(onProgress);
    await writeInputWebm(ffmpeg, inputBytes);
    await safeDeleteFile(ffmpeg, 'output.mp4');
    onProgress?.(0.2, `transcoding-${strategy.name}`);

    const { lines, detach } = attachLogCollector(ffmpeg);
    let result: ExecResult = { exitCode: 1, timedOut: false };

    const progressHandler = onFfmpegRatio
      ? ({ progress }: { progress: number }) => onFfmpegRatio(progress)
      : null;
    if (progressHandler) ffmpeg.on('progress', progressHandler);

    try {
      result = await execWithTimeout(ffmpeg, [...strategy.args], STRATEGY_EXEC_TIMEOUT_MS);
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
): Promise<Uint8Array> {
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

  try {
    onProgress?.(0.18, 'writing-input');
    const output = await transcodeWithStrategies(
      inputBytes,
      (ratio, stage) => {
        if (stage === 'loaded' || stage === 'loading-wasm' || stage === 'checking-assets') {
          report(ratio, stage === 'loaded' ? 'loading-wasm' : stage);
          return;
        }
        report(ratio, stage);
      },
      (ratio) => report(Math.min(1, Math.max(0, ratio)), 'transcoding'),
    );

    onProgress?.(1, 'done');
    return output;
  } catch (error) {
    // BUG FIX: Poisoned FFmpeg singleton after hung/failed transcode
    // Fix: Terminate WASM worker so the next job starts from a clean virtual FS.
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