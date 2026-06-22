/**
 * Vosk inference host — bundled to public/vosk-sandbox.js (manifest sandbox page only).
 * Worker stays vosk-browser blob worker (sandbox null-origin); IDBFS sync patched non-fatal at build (BUG-013).
 */
import { Model } from 'vosk-browser';
import { TRANSCRIBE_CHUNK_SAMPLES } from './constants';
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
      if (message.result) {
        resolve(model);
        return;
      }
      reject(new Error('Vosk model failed to load'));
    });
    model.on('error', (message) => {
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
  // BUG FIX: vosk-browser createModel broken under esbuild + rejects after resolve upstream.
  // Fix: construct Model directly after UMD→ESM unwrap in build-vosk-sandbox.mjs (BUG-012).
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
  // BUG FIX: sandbox page opaque origin cannot target extension origin reliably.
  // Fix: use '*' — parent validates event.source === iframe.contentWindow.
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
      postToParent({ type: VOSK_SANDBOX_PROGRESS, id: jobId, ratio: 0.15, stage: 'inference' });

      const total = samples.length;
      for (let offset = 0; offset < total; offset += TRANSCRIBE_CHUNK_SAMPLES) {
        const chunk = samples.subarray(offset, Math.min(offset + TRANSCRIBE_CHUNK_SAMPLES, total));
        recognizer.acceptWaveformFloat(chunk, sampleRate);
        const ratio = 0.15 + (offset / Math.max(total, 1)) * 0.75;
        postToParent({ type: VOSK_SANDBOX_PROGRESS, id: jobId, ratio, stage: 'inference' });
      }

      recognizer.retrieveFinalResult();
      postToParent({ type: VOSK_SANDBOX_PROGRESS, id: jobId, ratio: 0.95, stage: 'finalizing' });

      window.setTimeout(() => {
        const text = segments.map((segment) => segment.text).join(' ').trim();
        finish({ text, segments, language, source: 'vosk' });
      }, 300);
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
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
  const { id, modelUrl, samples, sampleRate, language } = message;

  try {
    postToParent({ type: VOSK_SANDBOX_PROGRESS, id, ratio: 0.12, stage: 'loading-model' });
    const model = await loadModel(modelUrl);
    postToParent({ type: VOSK_SANDBOX_PROGRESS, id, ratio: 0.14, stage: 'model-ready' });

    const result = await runVoskOnPcm(model, samples, sampleRate, language, id);
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