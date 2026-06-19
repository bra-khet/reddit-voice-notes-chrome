import { FFmpeg } from '@ffmpeg/ffmpeg';
import { EXTENSION_LOG_PREFIX } from '@/src/utils/constants';

export type FfmpegProgressCallback = (ratio: number, stage: string) => void;

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

    const logHandler = ({ message }: { message: string }) => {
      console.log(`${EXTENSION_LOG_PREFIX} [ffmpeg]`, message);
    };
    ffmpeg.on('log', logHandler);

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
      ffmpeg.off('log', logHandler);
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

const TRANSCODE_ARGS = [
  '-i',
  'input.webm',
  '-c:v',
  'libx264',
  '-preset',
  'ultrafast',
  '-profile:v',
  'baseline',
  '-pix_fmt',
  'yuv420p',
  '-c:a',
  'aac',
  '-b:a',
  '128k',
  '-movflags',
  '+faststart',
  'output.mp4',
] as const;

function mapProgress(ratio: number, stage: string): number {
  if (stage === 'loading-wasm') return 0.05 + ratio * 0.15;
  if (stage === 'transcoding') return 0.2 + ratio * 0.75;
  return ratio;
}

export async function runWebmToMp4(
  webm: ArrayBuffer,
  onProgress?: FfmpegProgressCallback,
): Promise<Uint8Array> {
  const report = (ratio: number, stage: string) => {
    onProgress?.(mapProgress(ratio, stage), stage);
  };

  report(0, 'starting');

  const ffmpeg = await loadFfmpeg((ratio, stage) => {
    report(ratio, stage === 'loaded' ? 'loading-wasm' : stage);
  });

  const progressHandler = ({ progress }: { progress: number }) => {
    report(Math.min(1, Math.max(0, progress)), 'transcoding');
  };

  ffmpeg.on('progress', progressHandler);

  try {
    onProgress?.(0.18, 'writing-input');
    await ffmpeg.writeFile('input.webm', new Uint8Array(webm));

    onProgress?.(0.2, 'transcoding');
    const exitCode = await ffmpeg.exec([...TRANSCODE_ARGS]);

    if (exitCode !== 0) {
      throw new Error(`FFmpeg exited with code ${exitCode}.`);
    }

    onProgress?.(0.97, 'reading-output');
    const output = await ffmpeg.readFile('output.mp4');

    await ffmpeg.deleteFile('input.webm');
    await ffmpeg.deleteFile('output.mp4');

    onProgress?.(1, 'done');
    return output as Uint8Array;
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