/** Vosk small English model — 16 kHz mono recommended. */
export const VOSK_TARGET_SAMPLE_RATE = 16_000;

export const VOSK_MODEL_PATH = 'vosk/model.tar.gz';

/** Manifest sandbox page (public/vosk-sandbox.html + esbuild bundle). */
export const VOSK_SANDBOX_PATH = 'vosk-sandbox.html';



export const TRANSCRIBE_CHUNK_SAMPLES = 4096;

/** Model load + 2:00 inference — generous for eloquent-0 spike. */
export const TRANSCRIBE_TIMEOUT_MS = 120_000;

/**
 * Stable marker embedded in the host's no-speech error (vosk-sandbox-host.ts) so
 * the content-script failure classifier (transcribe-failure.ts) can tell a
 * no-speech result apart from a real inference error WITHOUT importing the Vosk
 * host (which would pull WASM into the content-script bundle). v5.3 subtitle QoL.
 */
export const VOSK_NO_SPEECH_ERROR_MARKER = 'no speech';

export function resolveVoskModelUrl(): string {
  return normalizeAbsoluteExtensionUrl(browser.runtime.getURL(VOSK_MODEL_PATH as never));
}

/**
 * Sandbox / blob workers cannot resolve relative URLs — parent must pass an
 * absolute package-asset URL (same origin as `browser.runtime.getURL('')`).
 *
 * On the extension that is `chrome-extension://<id>/…`. On the hosted Design
 * Studio (Track D) the web shim's `getURL` returns the Pages / preview origin
 * under the site base — same helper, same trust rule: reject foreign origins.
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

  // BUG FIX: hosted Design Studio Vosk model URL rejected as non-chrome-extension
  // Fix: accept absolute URLs whose origin matches package root via getURL('')
  // (extension → chrome-extension://<id>; Pages/preview → http(s) site origin).
  // Sync: resolveVoskModelUrl + vosk-sandbox-client (sole callers of this helper)
  let packageOrigin: string;
  try {
    packageOrigin = new URL(browser.runtime.getURL('' as never)).origin;
  } catch {
    throw new Error(
      `Vosk model URL package origin could not be resolved — got "${parsed.href}"`,
    );
  }

  if (parsed.origin !== packageOrigin) {
    throw new Error(
      `Vosk model URL must be same-origin as the package root (${packageOrigin}) — got "${parsed.href}"`,
    );
  }

  return parsed.href;
}