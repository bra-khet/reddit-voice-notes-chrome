/*
 * Studio-side warm-cache read for the FFmpeg core WASM (Track D §3.5).
 *
 * The hosted hub's chronos gate (demo/src/hub/chronos-gate.ts) downloads the 31 MB
 * ffmpeg-core.wasm once and stores it in Cache Storage under FFMPEG_WARM_CACHE,
 * keyed by the SAME absolute URL the studio's ffmpeg-runner later requests. The HTTP
 * disk cache declines or evicts single entries that large, and that eviction is
 * invisible until a user reports a slow (or watchdog-tripping) second bake. Cache
 * Storage is quota-backed and explicitly managed, so reading the wasm from it first
 * makes a warmed bake survive HTTP-cache eviction.
 *
 * HOST-NEUTRAL BY CONSTRUCTION. On the extension the wasm is a packaged resource
 * that never evicts, and nothing writes FFMPEG_WARM_CACHE there — so the lookup is a
 * clean miss and the caller falls through to the packaged URL, byte-identically.
 * Two facts make that a true no-op rather than a behaviour change:
 *   - CacheStorage.match() with an explicit `cacheName` does NOT create the cache on
 *     a miss (unlike caches.open()), so the extension's Cache Storage is untouched.
 *   - The wasm URL is resolved by the caller via getURL(); on the extension it is a
 *     chrome-extension:// URL that could never be a key the demo gate wrote.
 * There is deliberately no scheme test and no location.protocol here — the miss IS
 * the gate (host-neutrality rule 1).
 */

// Sync: demo/src/hub/chronos-gate.ts imports this constant — the writer and the
// reader MUST name the same cache, or the studio silently never finds the warm copy.
export const FFMPEG_WARM_CACHE = 'rvn-ffmpeg-warm-v1';

export interface WarmWasm {
  /** Blob URL for the cached wasm — pass as ffmpeg.load({ wasmURL }). */
  url: string;
  /** Release the blob URL once load() has resolved (the worker has fetched it). */
  revoke(): void;
}

/**
 * Return a blob URL backed by the warm-cached wasm at `wasmUrl`, or null when it is
 * not in the warm cache (or Cache Storage is unavailable / unreadable). Never throws:
 * a warm read is a best-effort optimisation and its failure must degrade to the
 * packaged URL, never fail the bake.
 */
export async function openWarmWasm(wasmUrl: string): Promise<WarmWasm | null> {
  try {
    if (typeof caches === 'undefined') return null;
    // cacheName-scoped match: finds the entry if the demo gate wrote it, and does
    // NOT create the cache on a miss — the extension path stays side-effect-free.
    const response = await caches.match(wasmUrl, { cacheName: FFMPEG_WARM_CACHE });
    if (!response) return null;

    // Preserve application/wasm so the core can instantiateStreaming() the blob URL;
    // the gate stores it with that content-type, but re-tag defensively.
    const cached = await response.blob();
    const blob =
      cached.type === 'application/wasm' ? cached : new Blob([cached], { type: 'application/wasm' });
    const url = URL.createObjectURL(blob);
    return { url, revoke: () => URL.revokeObjectURL(url) };
  } catch {
    return null;
  }
}
