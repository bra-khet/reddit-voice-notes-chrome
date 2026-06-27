/**
 * Vosk inference host — bundled to public/vosk-sandbox.js (manifest sandbox page only).
 * Worker stays vosk-browser blob worker (sandbox null-origin); IDBFS sync patched non-fatal at build (BUG-013).
 */
import { Model } from 'vosk-browser';
import { TRANSCRIBE_CHUNK_SAMPLES, VOSK_NO_SPEECH_ERROR_MARKER } from './constants';
import { assertPcmUsable, coerceFloat32Samples, formatPcmStats } from './pcm-stats';
import type { TranscriptResult, TranscriptSegment } from './types';
import {
  VOSK_SANDBOX_DISPOSE,
  VOSK_SANDBOX_PROGRESS,
  VOSK_SANDBOX_READY,
  VOSK_SANDBOX_RESULT,
  VOSK_SANDBOX_TRANSCRIBE,
  type VoskSandboxHostMessage,
} from './vosk-sandbox-protocol';

interface VoskWordToken {
  word: string;
  start: number;
  end: number;
  conf: number;
}

let modelPromise: Promise<Model> | null = null;
let loadedModelUrl: string | null = null;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
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

function waitForVoskModel(model: Model): Promise<Model> {
  return new Promise((resolve, reject) => {
    model.on('load', (message) => {
      // BUG FIX: ModelMessage discriminated union accessed without narrowing (TS2339)
      // Fix: guard on message.event before accessing .result or .error; mirrors recognizer.on() pattern in runVoskOnPcm
      if (message.event === 'error') {
        reject(new Error(message.error || 'Vosk model load error'));
        return;
      }
      // Narrowed to ServerMessageLoadResult; result is boolean (true = loaded)
      if (message.result) {
        resolve(model);
      } else {
        reject(new Error('Vosk model failed to load'));
      }
    });
    model.on('error', (message) => {
      // BUG FIX: ModelMessage discriminated union accessed without narrowing (TS2339)
      // Fix: guard before accessing .error; mirrors recognizer.on('error') pattern
      if (message.event !== 'error') return;
      reject(new Error(message.error || 'Vosk model error'));
    });
  });
}

async function loadModel(modelUrl: string): Promise<Model> {
  if (modelPromise && loadedModelUrl === modelUrl) {
    return modelPromise;
  }

  if (modelPromise) {
    const prior = await modelPromise.catch(() => null);
    prior?.terminate();
    modelPromise = null;
    loadedModelUrl = null;
  }

  loadedModelUrl = modelUrl;
  const model = new Model(modelUrl);
  modelPromise = waitForVoskModel(model);
  return modelPromise;
}

async function disposeModel(): Promise<void> {
  if (!modelPromise) return;
  const model = await modelPromise.catch(() => null);
  model?.terminate();
  modelPromise = null;
  loadedModelUrl = null;
}

function postToParent(message: Record<string, unknown>): void {
  window.parent.postMessage(message, '*');
}

function isFromParent(event: MessageEvent): boolean {
  return event.source === window.parent;
}

function runVoskOnPcm(
  model: Model,
  samples: Float32Array,
  sampleRate: number,
  language: string | undefined,
  jobId: string,
  pcmSummary: string,
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

    void (async () => {
      try {
        recognizer.setWords(true);
        const total = samples.length;
        const audioMs = (total / sampleRate) * 1000;

        postToParent({
          type: VOSK_SANDBOX_PROGRESS,
          id: jobId,
          ratio: 0.15,
          stage: `inference:${pcmSummary}`,
        });

        // BUG FIX: acceptWaveformFloat posts async to worker — tight loop + immediate retrieveFinalResult races (BUG-015).
        // Fix: yield between chunks; drain worker before final; wait for result events after retrieveFinalResult.
        for (let offset = 0; offset < total; offset += TRANSCRIBE_CHUNK_SAMPLES) {
          const chunk = samples.subarray(offset, Math.min(offset + TRANSCRIBE_CHUNK_SAMPLES, total));
          recognizer.acceptWaveformFloat(chunk, sampleRate);
          const ratio = 0.15 + (offset / Math.max(total, 1)) * 0.55;
          postToParent({ type: VOSK_SANDBOX_PROGRESS, id: jobId, ratio, stage: 'inference' });
          await delay(0);
        }

        const drainMs = Math.min(Math.max(300, audioMs * 0.35), 45_000);
        postToParent({
          type: VOSK_SANDBOX_PROGRESS,
          id: jobId,
          ratio: 0.78,
          stage: `inference-drain:${Math.round(drainMs)}ms`,
        });
        await delay(drainMs);

        const segmentsBeforeFinal = segments.length;
        postToParent({ type: VOSK_SANDBOX_PROGRESS, id: jobId, ratio: 0.88, stage: 'finalizing' });
        recognizer.retrieveFinalResult();

        const finalWaitMs = Math.max(2_000, audioMs * 0.6 + 1_500);
        const deadline = performance.now() + finalWaitMs;
        while (performance.now() < deadline && segments.length === segmentsBeforeFinal) {
          await delay(50);
        }
        await delay(150);

        const text = segments.map((segment) => segment.text).join(' ').trim();
        if (!text) {
          // Sync: VOSK_NO_SPEECH_ERROR_MARKER must stay a substring of this message —
          // transcribe-failure.ts classifies no-speech by matching it (v5.3).
          fail(
            new Error(
              `Vosk returned ${VOSK_NO_SPEECH_ERROR_MARKER} after ${Math.round(audioMs)}ms audio (${pcmSummary}). Check PCM decode and worker pacing.`,
            ),
          );
          return;
        }

        finish({ text, segments, language, source: 'vosk' });
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    })();
  });
}

function isHostMessage(data: unknown): data is VoskSandboxHostMessage {
  if (typeof data !== 'object' || data === null) return false;
  const type = (data as { type?: string }).type;
  return type === VOSK_SANDBOX_TRANSCRIBE || type === VOSK_SANDBOX_DISPOSE;
}

async function handleTranscribe(
  message: VoskSandboxHostMessage & { type: typeof VOSK_SANDBOX_TRANSCRIBE },
): Promise<void> {
  const { id, modelUrl, samples: rawSamples, sampleRate, language } = message;

  try {
    const samples = coerceFloat32Samples(rawSamples);
    const pcmStats = assertPcmUsable(samples, sampleRate);
    const pcmSummary = formatPcmStats(pcmStats);

    postToParent({ type: VOSK_SANDBOX_PROGRESS, id, ratio: 0.11, stage: `pcm-received:${pcmSummary}` });

    postToParent({ type: VOSK_SANDBOX_PROGRESS, id, ratio: 0.12, stage: 'loading-model' });
    const model = await loadModel(modelUrl);
    postToParent({ type: VOSK_SANDBOX_PROGRESS, id, ratio: 0.14, stage: 'model-ready' });

    // NOTE: the cold-start "inference-error" was NOT in-sandbox flakiness — it was a
    // background offscreen dispatch race (BUG-034) where the first recording's transcribe
    // never reached this worker. A prior cold-retry here was removed as misdirected; the
    // fix lives in entrypoints/background.ts (dispatch mutex + ping guard + prewarm).
    const result = await runVoskOnPcm(model, samples, sampleRate, language, id, pcmSummary);
    postToParent({ type: VOSK_SANDBOX_RESULT, id, ok: true, result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    postToParent({ type: VOSK_SANDBOX_RESULT, id, ok: false, error: detail });
  }
}

export function startVoskSandboxHost(): void {
  window.addEventListener('message', (event) => {
    if (!isFromParent(event)) return;
    if (!isHostMessage(event.data)) return;

    if (event.data.type === VOSK_SANDBOX_DISPOSE) {
      void disposeModel();
      return;
    }

    void handleTranscribe(event.data);
  });

  postToParent({ type: VOSK_SANDBOX_READY });
}