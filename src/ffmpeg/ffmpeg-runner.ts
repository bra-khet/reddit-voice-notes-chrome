import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

async function getFfmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const ffmpeg = new FFmpeg();

    const coreJs = browser.runtime.getURL('ffmpeg/ffmpeg-core.js' as never);
    const coreWasm = browser.runtime.getURL('ffmpeg/ffmpeg-core.wasm' as never);
    await ffmpeg.load({
      coreURL: await toBlobURL(coreJs, 'text/javascript'),
      wasmURL: await toBlobURL(coreWasm, 'application/wasm'),
    });

    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  return loadPromise;
}

export async function runWebmToMp4(
  webm: ArrayBuffer,
  onProgress?: (ratio: number) => void,
): Promise<Uint8Array> {
  const ffmpeg = await getFfmpeg();

  if (onProgress) {
    ffmpeg.on('progress', ({ progress }) => {
      onProgress(Math.min(1, Math.max(0, progress)));
    });
  }

  await ffmpeg.writeFile('input.webm', new Uint8Array(webm));
  await ffmpeg.exec([
    '-i',
    'input.webm',
    '-c:v',
    'libx264',
    '-profile:v',
    'baseline',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-movflags',
    '+faststart',
    'output.mp4',
  ]);

  const output = await ffmpeg.readFile('output.mp4');
  await ffmpeg.deleteFile('input.webm');
  await ffmpeg.deleteFile('output.mp4');

  return output as Uint8Array;
}

export function disposeFfmpeg(): void {
  ffmpegInstance = null;
  loadPromise = null;
}