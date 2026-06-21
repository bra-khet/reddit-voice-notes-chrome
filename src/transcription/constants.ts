/** Vosk small English model — 16 kHz mono recommended. */
export const VOSK_TARGET_SAMPLE_RATE = 16_000;

export const VOSK_MODEL_PATH = 'vosk/model.tar.gz';

export const TRANSCRIBE_CHUNK_SAMPLES = 4096;

/** Model load + 2:00 inference — generous for eloquent-0 spike. */
export const TRANSCRIBE_TIMEOUT_MS = 120_000;

export function resolveVoskModelUrl(): string {
  return browser.runtime.getURL(VOSK_MODEL_PATH as never);
}