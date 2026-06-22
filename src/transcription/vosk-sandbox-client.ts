import { normalizeAbsoluteExtensionUrl, VOSK_SANDBOX_PATH } from './constants';
import type { TranscriptResult } from './types';
import {
  isVoskSandboxClientMessage,
  VOSK_SANDBOX_DISPOSE,
  VOSK_SANDBOX_PROGRESS,
  VOSK_SANDBOX_READY,
  VOSK_SANDBOX_RESULT,
  VOSK_SANDBOX_TRANSCRIBE,
} from './vosk-sandbox-protocol';

const SANDBOX_READY_TIMEOUT_MS = 60_000;

let iframe: HTMLIFrameElement | null = null;
let readyPromise: Promise<void> | null = null;

function sandboxUrl(): string {
  return browser.runtime.getURL(VOSK_SANDBOX_PATH as never);
}

function ensureIframe(): HTMLIFrameElement {
  if (iframe) return iframe;

  iframe = document.createElement('iframe');
  iframe.src = sandboxUrl();
  iframe.hidden = true;
  document.body.appendChild(iframe);
  return iframe;
}

function isFromSandboxFrame(event: MessageEvent, frame: HTMLIFrameElement): boolean {
  return event.source === frame.contentWindow;
}

function waitForSandboxReady(frame: HTMLIFrameElement): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(
        new Error(
          'Vosk sandbox failed to become ready. Run npm run build:vosk-sandbox and reload the extension.',
        ),
      );
    }, SANDBOX_READY_TIMEOUT_MS);

    const onMessage = (event: MessageEvent): void => {
      if (!isFromSandboxFrame(event, frame)) return;
      if (!isVoskSandboxClientMessage(event.data)) return;
      if (event.data.type !== VOSK_SANDBOX_READY) return;

      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve();
    };

    window.addEventListener('message', onMessage);
  });
}

export async function ensureVoskSandbox(): Promise<void> {
  const frame = ensureIframe();
  if (!readyPromise) {
    readyPromise = waitForSandboxReady(frame);
  }
  await readyPromise;
}

export async function transcribePcmInSandbox(
  samples: Float32Array,
  sampleRate: number,
  modelUrl: string,
  language: string | undefined,
  onProgress?: (ratio: number, stage: string) => void,
): Promise<TranscriptResult> {
  await ensureVoskSandbox();
  const frame = ensureIframe();
  const target = frame.contentWindow;
  if (!target) throw new Error('Vosk sandbox frame is not accessible');

  const id = crypto.randomUUID();
  const outbound = new Float32Array(samples);
  const absoluteModelUrl = normalizeAbsoluteExtensionUrl(modelUrl);

  return new Promise<TranscriptResult>((resolve, reject) => {
    const onMessage = (event: MessageEvent): void => {
      if (!isFromSandboxFrame(event, frame)) return;
      if (!isVoskSandboxClientMessage(event.data)) return;
      if ('id' in event.data && event.data.id !== id) return;

      if (event.data.type === VOSK_SANDBOX_PROGRESS) {
        onProgress?.(event.data.ratio, event.data.stage);
        return;
      }

      if (event.data.type === VOSK_SANDBOX_RESULT) {
        window.removeEventListener('message', onMessage);
        if (event.data.ok && event.data.result) {
          resolve(event.data.result);
          return;
        }
        reject(new Error(event.data.error || 'Vosk sandbox transcription failed'));
      }
    };

    window.addEventListener('message', onMessage);

    // BUG FIX: manifest sandbox iframe has opaque/null origin — cannot use location.origin as targetOrigin.
    // Fix: postMessage with '*' + validate event.source === iframe.contentWindow.
    target.postMessage(
      {
        type: VOSK_SANDBOX_TRANSCRIBE,
        id,
        modelUrl: absoluteModelUrl,
        samples: outbound,
        sampleRate,
        language,
      },
      '*',
      [outbound.buffer],
    );
  });
}

export async function disposeVoskSandbox(): Promise<void> {
  if (iframe?.contentWindow) {
    iframe.contentWindow.postMessage({ type: VOSK_SANDBOX_DISPOSE }, '*');
  }

  readyPromise = null;
  iframe?.remove();
  iframe = null;
}