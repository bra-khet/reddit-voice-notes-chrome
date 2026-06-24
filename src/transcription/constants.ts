/** Vosk small English model — 16 kHz mono recommended. */
export const VOSK_TARGET_SAMPLE_RATE = 16_000;

export const VOSK_MODEL_PATH = 'vosk/model.tar.gz';

/** Manifest sandbox page (public/vosk-sandbox.html + esbuild bundle). */
export const VOSK_SANDBOX_PATH = 'vosk-sandbox.html';



export const TRANSCRIBE_CHUNK_SAMPLES = 4096;

/** Model load + 2:00 inference — generous for eloquent-0 spike. */
export const TRANSCRIBE_TIMEOUT_MS = 120_000;

export function resolveVoskModelUrl(): string {
  return normalizeAbsoluteExtensionUrl(browser.runtime.getURL(VOSK_MODEL_PATH as never));
}

/**
 * Sandbox / blob workers cannot resolve relative URLs — parent must pass absolute chrome-extension:// URLs.
 */
export function normalizeAbsoluteExtensionUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error('Vosk model URL is empty');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Vosk model URL must be absolute — got "${trimmed}"`);
  }

  if (parsed.protocol !== 'chrome-extension:') {
    throw new Error(`Vosk model URL must be chrome-extension:// — got "${parsed.href}"`);
  }

  return parsed.href;
}