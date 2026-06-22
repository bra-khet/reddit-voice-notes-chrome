import { EXTENSION_LOG_PREFIX } from '@/src/utils/constants';
import { TRANSCRIBE_TIMEOUT_MS } from './constants';
import { decodeWebmToMonoPcm } from './decode-webm-audio';
import { formatPcmStats, analyzePcm } from './pcm-stats';
import type { TranscribeAudioOptions, TranscribeAudioResult } from './types';
import { enqueueTranscribeJob } from './transcribe-queue';
import { disposeVoskSandbox, transcribePcmInSandbox } from './vosk-sandbox-client';

async function transcribeWebmBlobInner(
  blob: Blob,
  options: TranscribeAudioOptions,
): Promise<TranscribeAudioResult> {
  const started = performance.now();
  const onProgress = options.onProgress;

  onProgress?.(0.02, 'decode-audio');
  const { samples, sampleRate } = await decodeWebmToMonoPcm(blob);
  onProgress?.(0.1, `decode-done:${formatPcmStats(analyzePcm(samples, sampleRate))}`);

  const result = await transcribePcmInSandbox(
    samples,
    sampleRate,
    options.modelUrl,
    options.language,
    onProgress,
  );
  onProgress?.(1, 'done');

  return {
    result,
    applied: result.text.length > 0 || result.segments.length > 0,
    fallback: false,
    stage: 'vosk-complete',
    elapsedMs: Math.round(performance.now() - started),
  };
}

async function withTranscribeTimeout<T>(work: () => Promise<T>): Promise<T> {
  let timer: number | null = null;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = window.setTimeout(() => {
      reject(new Error(`Transcription timed out after ${Math.round(TRANSCRIBE_TIMEOUT_MS / 1000)}s`));
    }, TRANSCRIBE_TIMEOUT_MS);
  });

  try {
    return await Promise.race([work(), timeout]);
  } finally {
    if (timer !== null) window.clearTimeout(timer);
  }
}

/**
 * Transcribe a captured WebM blob with Vosk (eloquent-0 isolated API).
 * Inference runs in a manifest sandbox page (CSP allows Emscripten eval).
 */
export async function transcribeWebmBlob(blob: Blob, options: TranscribeAudioOptions): Promise<TranscribeAudioResult> {
  return enqueueTranscribeJob(async () => {
    const started = performance.now();

    try {
      return await withTranscribeTimeout(() => transcribeWebmBlobInner(blob, options));
    } catch (error) {
      console.warn(`${EXTENSION_LOG_PREFIX} Transcription failed:`, error);
      return {
        result: { text: '', segments: [], source: 'vosk', language: options.language },
        applied: false,
        fallback: true,
        stage: error instanceof Error ? error.message : 'transcribe-failed',
        elapsedMs: Math.round(performance.now() - started),
      };
    }
  });
}

/** Test helper — unload sandbox model between harness runs. */
export async function resetVoskForHarness(): Promise<void> {
  await disposeVoskSandbox();
}