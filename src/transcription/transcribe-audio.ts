import { EXTENSION_LOG_PREFIX } from '@/src/utils/constants';
import { TRANSCRIBE_CHUNK_SAMPLES, TRANSCRIBE_TIMEOUT_MS } from './constants';
import { decodeWebmToMonoPcm } from './decode-webm-audio';
import type { TranscribeAudioOptions, TranscribeAudioResult, TranscriptResult, TranscriptSegment } from './types';
import { enqueueTranscribeJob } from './transcribe-queue';
import { disposeVoskModel, loadVoskModel } from './vosk-loader';
import type { Model } from 'vosk-browser';

interface VoskWordToken {
  word: string;
  start: number;
  end: number;
  conf: number;
}

function segmentFromVoskWords(text: string, words: VoskWordToken[]): TranscriptSegment {
  const trimmed = text.trim();
  if (words.length === 0) {
    return { start: 0, end: 0, text: trimmed };
  }
  return {
    start: words[0].start,
    end: words[words.length - 1].end,
    text: trimmed,
  };
}

async function runVoskOnPcm(
  model: Model,
  samples: Float32Array,
  sampleRate: number,
  language: string | undefined,
  onProgress?: (ratio: number, stage: string) => void,
): Promise<TranscriptResult> {
  const recognizer = new model.KaldiRecognizer(sampleRate);
  const segments: TranscriptSegment[] = [];

  return new Promise<TranscriptResult>((resolve, reject) => {
    let settled = false;

    const finish = (result: TranscriptResult): void => {
      if (settled) return;
      settled = true;
      recognizer.remove();
      resolve(result);
    };

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      recognizer.remove();
      reject(error);
    };

    recognizer.on('result', (message) => {
      if (message.event !== 'result') return;
      const text = message.result.text ?? '';
      const words = (message.result.result ?? []) as VoskWordToken[];
      if (!text.trim()) return;
      segments.push(segmentFromVoskWords(text, words));
    });

    recognizer.on('error', (message) => {
      if (message.event !== 'error') return;
      fail(new Error(message.error || 'Vosk recognizer error'));
    });

    try {
      recognizer.setWords(true);
      onProgress?.(0.15, 'inference');

      const total = samples.length;
      for (let offset = 0; offset < total; offset += TRANSCRIBE_CHUNK_SAMPLES) {
        const chunk = samples.subarray(offset, Math.min(offset + TRANSCRIBE_CHUNK_SAMPLES, total));
        recognizer.acceptWaveformFloat(chunk, sampleRate);
        const ratio = 0.15 + (offset / Math.max(total, 1)) * 0.75;
        onProgress?.(ratio, 'inference');
      }

      recognizer.retrieveFinalResult();
      onProgress?.(0.95, 'finalizing');

      window.setTimeout(() => {
        const text = segments.map((segment) => segment.text).join(' ').trim();
        finish({
          text,
          segments,
          language,
          source: 'vosk',
        });
      }, 300);
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

async function transcribeWebmBlobInner(
  blob: Blob,
  options: TranscribeAudioOptions,
): Promise<TranscribeAudioResult> {
  const started = performance.now();
  const onProgress = options.onProgress;

  onProgress?.(0.02, 'decode-audio');
  const { samples, sampleRate } = await decodeWebmToMonoPcm(blob);
  onProgress?.(0.1, 'decode-done');

  const model = await loadVoskModel(options.modelUrl, (stage) => {
    onProgress?.(0.12, stage);
  });

  const result = await runVoskOnPcm(model, samples, sampleRate, options.language, onProgress);
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
 * Returns empty fallback result on failure — never throws to callers in production paths.
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

/** Test helper — unload model between harness runs. */
export async function resetVoskForHarness(): Promise<void> {
  await disposeVoskModel();
}