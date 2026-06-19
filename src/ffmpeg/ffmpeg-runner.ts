import { FFmpeg } from '@ffmpeg/ffmpeg';
import { EXTENSION_LOG_PREFIX } from '@/src/utils/constants';

export type FfmpegProgressCallback = (ratio: number, stage: string) => void;

const WEBM_EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3] as const;
const MIN_WEBM_BYTES = 256;

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

function extensionAsset(path: string): string {
  return browser.runtime.getURL(path as never);
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
    const lower = line.toLowerCase();
    return (
      lower.includes('error') ||
      lower.includes('invalid') ||
      lower.includes('unknown encoder') ||
      lower.includes('codec') ||
      lower.includes('failed') ||
      lower.includes('not found')
    );
  });
  const tail = (interesting.length > 0 ? interesting : lines).slice(-6);
  return tail.join(' | ');
}

async function loadFfmpeg(onProgress?: FfmpegProgressCallback): Promise<FFmpeg> {
  if (ffmpegInstance?.loaded) {
    onProgress?.(0.2, 'ready');
    return ffmpegInstance;
  }

  if (loadPromise) return loadPromise;

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

  return loadPromise;
}

/** Ordered fallback strategies — official ffmpeg.wasm usage first, then explicit H.264/AAC for Reddit. */
const TRANSCODE_STRATEGIES = [
  {
    name: 'official-default',
    args: ['-i', 'input.webm', 'output.mp4'],
  },
  {
    name: 'faststart',
    args: ['-i', 'input.webm', '-movflags', '+faststart', 'output.mp4'],
  },
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
    name: 'h264-aac-experimental',
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
      '-strict',
      '-2',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      'output.mp4',
    ],
  },
  {
    name: 'h264-aac-scaled',
    args: [
      '-i',
      'input.webm',
      '-vf',
      'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-c:a',
      'aac',
      '-strict',
      '-2',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      'output.mp4',
    ],
  },
] as const;

async function safeDeleteFile(ffmpeg: FFmpeg, path: string): Promise<void> {
  try {
    await ffmpeg.deleteFile(path);
  } catch {
    // Output may not exist after a failed attempt.
  }
}

async function transcodeWithStrategies(
  ffmpeg: FFmpeg,
  onProgress?: FfmpegProgressCallback,
): Promise<Uint8Array> {
  const attempts: string[] = [];

  for (const strategy of TRANSCODE_STRATEGIES) {
    await safeDeleteFile(ffmpeg, 'output.mp4');
    onProgress?.(0.2, `transcoding-${strategy.name}`);

    const { lines, detach } = attachLogCollector(ffmpeg);
    let exitCode = 1;

    try {
      exitCode = await ffmpeg.exec([...strategy.args]);
    } finally {
      detach();
    }

    if (exitCode === 0) {
      console.log(`${EXTENSION_LOG_PREFIX} Transcode succeeded (${strategy.name})`);
      return (await ffmpeg.readFile('output.mp4')) as Uint8Array;
    }

    const summary = summarizeFfmpegLogs(lines);
    attempts.push(`${strategy.name}: exit ${exitCode}${summary ? ` — ${summary}` : ''}`);
    console.warn(`${EXTENSION_LOG_PREFIX} Transcode attempt failed (${strategy.name})`, summary);
  }

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

  const inputBytes = webm instanceof Uint8Array ? webm : new Uint8Array(webm);
  if (!isValidWebm(inputBytes)) {
    throw new Error(
      `Recording is not a valid WebM file (${inputBytes.byteLength} bytes). Try recording again.`,
    );
  }

  const ffmpeg = await loadFfmpeg((ratio, stage) => {
    report(ratio, stage === 'loaded' ? 'loading-wasm' : stage);
  });

  const progressHandler = ({ progress }: { progress: number }) => {
    report(Math.min(1, Math.max(0, progress)), 'transcoding');
  };

  ffmpeg.on('progress', progressHandler);

  try {
    onProgress?.(0.18, 'writing-input');
    await ffmpeg.writeFile('input.webm', inputBytes);

    onProgress?.(0.2, 'transcoding');
    const output = await transcodeWithStrategies(ffmpeg, onProgress);

    await ffmpeg.deleteFile('input.webm');
    await ffmpeg.deleteFile('output.mp4');

    onProgress?.(1, 'done');
    return output;
  } finally {
    ffmpeg.off('progress', progressHandler);
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