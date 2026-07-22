/**
 * Voice Lab — ffmpeg.wasm render path.
 *
 * The fidelity heart of the studio: it builds the FFmpeg command from the SAME
 * `buildStylizedGraph` result the extension's `process-audio.ts` builds, writes
 * the same input + procedural-IR aux WAVs to the FFmpeg FS, and runs the same
 * `-af` / `-filter_complex … -map` + `-c:a aac` pass. Same input + same args +
 * same core ⇒ byte-identical to the extension's bake.
 *
 * Self-hosts the SINGLE-THREADED core (no SharedArrayBuffer) so it runs on
 * GitHub Pages, which cannot set COOP/COEP headers. Lazy-imported by audition.ts
 * so the wasm glue stays out of the studio's initial bundle.
 */
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import { buildStylizedGraph, normalizeStylizedGraph, type StylizedGraph } from '@/src/voice/dsp';

export type RenderProgress = (ratio: number, stage: string) => void;

export interface RenderResult {
  blob: Blob;
  /** True when FFmpeg applied filters and produced new output. */
  applied: boolean;
  /** True when the render failed and the original blob came back unchanged. */
  fallback: boolean;
}

export interface RenderOptions {
  /** Cap rendered output duration (s) so long clips audition fast (mirrors the bake's preview cap). */
  maxDurationSeconds?: number;
}

const CORE_BASE = `${import.meta.env.BASE_URL}assets/ffmpeg/`;
const OUTPUT_PATH = 'voice-output.m4a';
const AUX_PATH = (i: number): string => `voice-aux-${i}.wav`;
const VOICE_TIMEOUT_MS = 45_000;
const COMPLEX_TIMEOUT_MS = 120_000;

let singleton: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;

/** Load (once) the self-hosted single-threaded ffmpeg core. ~30 MB on first call, then cached. */
export async function loadFfmpeg(onProgress?: RenderProgress): Promise<FFmpeg> {
  if (singleton) return singleton;
  if (!loading) {
    loading = (async () => {
      const ffmpeg = new FFmpeg();
      const [coreURL, wasmURL] = await Promise.all([
        toBlobURL(`${CORE_BASE}ffmpeg-core.js`, 'text/javascript'),
        toBlobURL(`${CORE_BASE}ffmpeg-core.wasm`, 'application/wasm'),
      ]);
      await ffmpeg.load({ coreURL, wasmURL });
      singleton = ffmpeg;
      return ffmpeg;
    })();
  }
  onProgress?.(0.05, 'loading');
  return loading;
}

/** Drop the loaded instance (heavy/complex graphs start clean to avoid heap carryover). */
export function disposeFfmpeg(): void {
  if (singleton) {
    try {
      singleton.terminate();
    } catch {
      /* already terminated */
    }
    singleton = null;
  }
  loading = null;
}

function inputExt(type: string): string {
  if (type.includes('webm')) return 'webm';
  if (type.includes('ogg')) return 'ogg';
  if (type.includes('wav')) return 'wav';
  if (type.includes('mp4') || type.includes('m4a') || type.includes('aac')) return 'm4a';
  if (type.includes('mpeg') || type.includes('mp3')) return 'mp3';
  return 'dat';
}

async function safeDelete(ffmpeg: FFmpeg, path: string): Promise<void> {
  try {
    await ffmpeg.deleteFile(path);
  } catch {
    /* may not exist */
  }
}

/**
 * Render a clip through a {@link StylizedGraph}. No-op / failed renders return the
 * original blob unchanged (non-destructive), exactly like the extension.
 */
export async function processAudioWithGraph(
  input: Blob,
  graph: StylizedGraph,
  onProgress?: RenderProgress,
  options?: RenderOptions,
): Promise<RenderResult> {
  const result = buildStylizedGraph(normalizeStylizedGraph(graph));
  if (result.mode === 'none') return { blob: input, applied: false, fallback: false };

  const inputPath = `voice-input.${inputExt(input.type)}`;
  const auxPaths = result.auxInputs.map((_, i) => AUX_PATH(i));
  const timeout = result.mode === 'complex' ? COMPLEX_TIMEOUT_MS : VOICE_TIMEOUT_MS;

  // Heavy parallel graphs are sensitive to accumulated wasm heap state — start clean.
  if (result.mode === 'complex') disposeFfmpeg();
  onProgress?.(0.05, 'loading');

  try {
    const ffmpeg = await loadFfmpeg(onProgress);
    await safeDelete(ffmpeg, inputPath);
    await safeDelete(ffmpeg, OUTPUT_PATH);
    for (const aux of auxPaths) await safeDelete(ffmpeg, aux);

    await ffmpeg.writeFile(inputPath, new Uint8Array(await input.arrayBuffer()));
    for (let i = 0; i < result.auxInputs.length; i++) {
      await ffmpeg.writeFile(auxPaths[i], result.auxInputs[i].bytes.slice());
    }
    onProgress?.(0.2, 'render');

    const args = ['-i', inputPath];
    for (const aux of auxPaths) args.push('-i', aux);
    if (result.mode === 'complex' && result.filterComplex && result.outputLabel) {
      args.push('-filter_complex', result.filterComplex, '-map', `[${result.outputLabel}]`);
    } else if (result.mode === 'af' && result.af) {
      args.push('-vn', '-af', result.af);
    } else {
      args.push('-vn');
    }
    if (options?.maxDurationSeconds && options.maxDurationSeconds > 0) {
      args.push('-t', String(options.maxDurationSeconds));
    }
    args.push('-c:a', 'aac', '-b:a', '128k', OUTPUT_PATH);

    const exitCode = await Promise.race<number>([
      ffmpeg.exec(args),
      new Promise<number>((resolve) => window.setTimeout(() => resolve(-1), timeout)),
    ]);
    if (exitCode !== 0) throw new Error(`FFmpeg exited with code ${exitCode}`);

    const output = (await ffmpeg.readFile(OUTPUT_PATH)) as Uint8Array;
    if (!output?.byteLength) throw new Error('FFmpeg produced empty output');

    await safeDelete(ffmpeg, inputPath);
    await safeDelete(ffmpeg, OUTPUT_PATH);
    for (const aux of auxPaths) await safeDelete(ffmpeg, aux);
    onProgress?.(1, 'done');

    return { blob: new Blob([output.slice()], { type: 'audio/mp4' }), applied: true, fallback: false };
  } catch (error) {
    console.warn('[static-studio] voice render failed — returning original audio', error);
    disposeFfmpeg();
    return { blob: input, applied: false, fallback: true };
  }
}
