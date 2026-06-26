import { unpackBinary } from '@/src/messaging/binary';
import {
  BACKGROUND_BLOB_PORT,
  MSG_GET_BACKGROUND_BLOB_CHUNK,
  MSG_GET_BACKGROUND_BLOB_META,
  type BackgroundBlobChunkPayload,
  type BackgroundBlobMetaPayload,
  type BackgroundBlobPortMessage,
  type BackgroundBlobPortRequest,
  type GetBackgroundBlobChunkRequest,
  type GetBackgroundBlobMetaRequest,
} from '@/src/messaging/background-blob';
import {
  createBackgroundObjectUrl,
  getBackgroundAsset,
  normalizeBackgroundAssetId,
} from './image-db';
import {
  AnimatedBackground,
  animatedDecodeSupported,
  decodeAnimatedBackground,
  isAnimatableMime,
} from './animated-background';

/** Canvas-drawable personal/bundled decode result — ImageBitmap bypasses page img-src CSP. */
export type DrawableBackgroundImage = HTMLImageElement | ImageBitmap;

const decodedImageCache = new Map<string, DrawableBackgroundImage>();
const objectUrlByCacheKey = new Map<string, string>();
const RELAY_TIMEOUT_MS = 45_000;

export function isDrawableBackgroundReady(image: DrawableBackgroundImage): boolean {
  if (image instanceof ImageBitmap) return image.width > 0 && image.height > 0;
  return image.complete && image.naturalWidth > 0;
}

export function getDrawableBackgroundSize(image: DrawableBackgroundImage): {
  width: number;
  height: number;
} {
  if (image instanceof ImageBitmap) {
    return { width: image.width, height: image.height };
  }
  return { width: image.naturalWidth, height: image.naturalHeight };
}

function evictDecodedBackgroundImage(id: string): void {
  const cached = decodedImageCache.get(id);
  if (cached instanceof ImageBitmap) cached.close();
  decodedImageCache.delete(id);
  const objectUrl = objectUrlByCacheKey.get(id);
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrlByCacheKey.delete(id);
  }
}

/** Extension pages + service worker share extension-origin IndexedDB. */
export function isExtensionPageContext(): boolean {
  try {
    return typeof location !== 'undefined' && location.protocol === 'chrome-extension:';
  } catch {
    return false;
  }
}

function loadImageFromUrl(url: string, cacheKey: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      decodedImageCache.set(cacheKey, img);
      resolve(img);
    };
    img.onerror = () => {
      evictDecodedBackgroundImage(cacheKey);
      resolve(null);
    };
    img.src = url;
  });
}

async function decodeBlobViaObjectUrl(blob: Blob, cacheKey: string): Promise<HTMLImageElement | null> {
  const objectUrl = URL.createObjectURL(blob);
  const image = await loadImageFromUrl(objectUrl, cacheKey);
  if (image) {
    objectUrlByCacheKey.set(cacheKey, objectUrl);
    return image;
  }
  URL.revokeObjectURL(objectUrl);
  return null;
}

async function decodeBlobViaImageBitmap(blob: Blob, cacheKey: string): Promise<ImageBitmap | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    decodedImageCache.set(cacheKey, bitmap);
    return bitmap;
  } catch (error) {
    console.warn('[Reddit Voice Notes] createImageBitmap failed for personal background:', error);
    return null;
  }
}

async function decodeBlobToDrawable(blob: Blob, cacheKey: string): Promise<DrawableBackgroundImage | null> {
  const fromObjectUrl = await decodeBlobViaObjectUrl(blob, cacheKey);
  if (fromObjectUrl) return fromObjectUrl;
  return decodeBlobViaImageBitmap(blob, cacheKey);
}

async function loadBackgroundImageElementLocal(id: string): Promise<DrawableBackgroundImage | null> {
  const cached = decodedImageCache.get(id);
  if (cached && isDrawableBackgroundReady(cached)) return cached;

  const url = await createBackgroundObjectUrl(id);
  if (!url) return null;
  return loadImageFromUrl(url, id);
}

function assembleBackgroundBytes(
  meta: BackgroundBlobMetaPayload,
  chunks: Array<Uint8Array | undefined>,
): Uint8Array | null {
  if (
    !meta.ok ||
    !meta.totalByteLength ||
    !meta.chunkCount ||
    chunks.length !== meta.chunkCount ||
    chunks.some((chunk) => !chunk)
  ) {
    return null;
  }

  const total = new Uint8Array(meta.totalByteLength);
  let offset = 0;
  for (const chunk of chunks) {
    total.set(chunk!, offset);
    offset += chunk!.length;
  }
  if (offset !== meta.totalByteLength) {
    console.warn('[Reddit Voice Notes] Personal background chunk assembly size mismatch:', {
      expected: meta.totalByteLength,
      assembled: offset,
    });
    return null;
  }
  return total;
}

async function requestBackgroundBlobMeta(id: string): Promise<BackgroundBlobMetaPayload | null> {
  const request: GetBackgroundBlobMetaRequest = {
    type: MSG_GET_BACKGROUND_BLOB_META,
    id,
  };

  try {
    const response = (await browser.runtime.sendMessage(request)) as BackgroundBlobMetaPayload | undefined;
    if (response?.ok && response.totalByteLength && response.chunkCount) return response;
    console.warn(
      '[Reddit Voice Notes] Personal background meta relay failed:',
      response?.error ?? 'no response',
    );
  } catch (error) {
    console.warn('[Reddit Voice Notes] Personal background meta relay error:', error);
  }
  return null;
}

async function requestBackgroundBlobChunk(
  id: string,
  chunkIndex: number,
): Promise<Uint8Array | null> {
  const request: GetBackgroundBlobChunkRequest = {
    type: MSG_GET_BACKGROUND_BLOB_CHUNK,
    id,
    chunkIndex,
  };

  try {
    const response = (await browser.runtime.sendMessage(request)) as BackgroundBlobChunkPayload | undefined;
    if (response?.ok && response.dataBase64 && response.byteLength !== undefined) {
      return unpackBinary(response.dataBase64, response.byteLength);
    }
    console.warn(
      '[Reddit Voice Notes] Personal background chunk relay failed:',
      chunkIndex,
      response?.error ?? 'no response',
    );
  } catch (error) {
    console.warn('[Reddit Voice Notes] Personal background chunk relay error:', chunkIndex, error);
  }
  return null;
}

async function requestBackgroundBlobViaMessage(
  id: string,
): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  const meta = await requestBackgroundBlobMeta(id);
  if (!meta?.mimeType) return null;

  const chunks: Array<Uint8Array | undefined> = new Array(meta.chunkCount);
  for (let chunkIndex = 0; chunkIndex < meta.chunkCount!; chunkIndex += 1) {
    // BUG FIX: tsc TS2322 "'Uint8Array | null' not assignable to 'Uint8Array | undefined'"
    // Fix: coerce the relay's null miss to undefined to match the chunks array element type.
    chunks[chunkIndex] = (await requestBackgroundBlobChunk(id, chunkIndex)) ?? undefined;
    if (!chunks[chunkIndex]) return null;
  }

  const bytes = assembleBackgroundBytes(meta, chunks);
  if (!bytes) return null;
  return { bytes, mimeType: meta.mimeType };
}

async function requestBackgroundBlobViaPort(
  id: string,
): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  return new Promise((resolve) => {
    let settled = false;
    let meta: BackgroundBlobMetaPayload | null = null;
    const chunks: Array<Uint8Array | undefined> = [];

    const finish = (value: { bytes: Uint8Array; mimeType: string } | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const fail = (error: string, detail?: unknown) => {
      console.warn('[Reddit Voice Notes] Personal background port relay failed:', error, detail);
      finish(null);
    };

    try {
      const port = browser.runtime.connect({ name: BACKGROUND_BLOB_PORT });
      const timeout = setTimeout(() => {
        port.disconnect();
        fail('timed out');
      }, RELAY_TIMEOUT_MS);

      port.onMessage.addListener((message: BackgroundBlobPortMessage) => {
        if (message.phase === 'meta') {
          if (!message.ok) {
            clearTimeout(timeout);
            port.disconnect();
            fail(message.error ?? 'meta failed');
            return;
          }
          meta = {
            ok: true,
            mimeType: message.mimeType,
            totalByteLength: message.totalByteLength,
            chunkCount: message.chunkCount,
          };
          chunks.length = message.chunkCount;
          return;
        }

        if (message.phase === 'chunk') {
          if (!message.ok || !message.dataBase64 || message.byteLength === undefined) {
            clearTimeout(timeout);
            port.disconnect();
            // BUG FIX: tsc TS2339 "Property 'error' does not exist" on the chunk success arm
            // Fix: narrow on the `ok` discriminant before reading `.error` (only the ok:false arm carries it).
            const reason = !message.ok ? message.error : undefined;
            fail(reason ?? 'chunk failed', { chunkIndex: message.chunkIndex });
            return;
          }
          try {
            chunks[message.chunkIndex] = unpackBinary(message.dataBase64, message.byteLength);
          } catch (error) {
            clearTimeout(timeout);
            port.disconnect();
            fail('chunk unpack failed', error);
          }
          return;
        }

        if (message.phase === 'done') {
          clearTimeout(timeout);
          port.disconnect();
          if (!meta?.mimeType) {
            fail('missing meta before done');
            return;
          }
          const bytes = assembleBackgroundBytes(meta, chunks);
          if (!bytes) {
            fail('chunk assembly failed');
            return;
          }
          finish({ bytes, mimeType: meta.mimeType });
          return;
        }

        if (message.phase === 'error') {
          clearTimeout(timeout);
          port.disconnect();
          fail(message.error ?? 'unknown error');
        }
      });

      port.onDisconnect.addListener(() => {
        clearTimeout(timeout);
        if (!settled) fail('port disconnected early');
      });

      const request: BackgroundBlobPortRequest = { id };
      port.postMessage(request);
    } catch (error) {
      fail('port connect failed', error);
    }
  });
}

// BUG FIX: Personal background missing on Reddit recorder canvas
// Fix: Chunked base64 relay — single MV3 port/message payloads exceed practical limits for multi-MB images.
// Sync: entrypoints/background.ts relayBackgroundBlobViaPort
async function loadBackgroundImageElementViaRelay(id: string): Promise<DrawableBackgroundImage | null> {
  const cached = decodedImageCache.get(id);
  if (cached && isDrawableBackgroundReady(cached)) return cached;

  const payload =
    (await requestBackgroundBlobViaPort(id)) ?? (await requestBackgroundBlobViaMessage(id));
  if (!payload) return null;

  // BUG FIX: tsc TS2322 "'Uint8Array<ArrayBufferLike>' not assignable to 'BlobPart'" (SharedArrayBuffer vs ArrayBuffer, TS 5.7)
  // Fix: copy into a fresh ArrayBuffer-backed Uint8Array so the Blob part is guaranteed non-shared.
  const blobBytes = new Uint8Array(payload.bytes.byteLength);
  blobBytes.set(payload.bytes);
  const blob = new Blob([blobBytes], { type: payload.mimeType });
  const image = await decodeBlobToDrawable(blob, id);
  if (!image) {
    console.warn('[Reddit Voice Notes] Personal background image decode returned null for', id);
  }
  return image;
}

/** Decode ImageDB record for canvas draw — works in popup and content script. */
export async function loadBackgroundImageElement(id: string): Promise<DrawableBackgroundImage | null> {
  const normalized = normalizeBackgroundAssetId(id);
  if (!normalized) return null;

  if (isExtensionPageContext()) {
    return loadBackgroundImageElementLocal(normalized);
  }
  return loadBackgroundImageElementViaRelay(normalized);
}

// ── Animated GIF backgrounds (animated branch, Phase 2) ──────────────────────
// Decode the GIF's frames once and cache a single active controller. Only one
// personal background is active at a time per context, so we keep at most one
// decoded controller live and dispose superseded ones after a grace delay — long
// enough that the recorder/Studio have swapped to the new frame source before the
// old ImageBitmaps close (drawing a closed bitmap would throw).

interface AnimatedCacheEntry {
  id: string;
  promise: Promise<AnimatedBackground | null>;
  anim: AnimatedBackground | null;
}

const ANIMATED_DISPOSE_GRACE_MS = 1500;
let animatedEntry: AnimatedCacheEntry | null = null;
const pendingAnimatedDisposal = new Set<AnimatedBackground>();
let animatedDisposeTimer: ReturnType<typeof setTimeout> | null = null;

function queueAnimatedDisposal(anim: AnimatedBackground | null): void {
  if (!anim) return;
  pendingAnimatedDisposal.add(anim);
  if (animatedDisposeTimer != null) return;
  animatedDisposeTimer = setTimeout(() => {
    animatedDisposeTimer = null;
    for (const entry of pendingAnimatedDisposal) entry.dispose();
    pendingAnimatedDisposal.clear();
  }, ANIMATED_DISPOSE_GRACE_MS);
}

/** `not-animatable`/`unavailable` distinguish a sticky "no GIF here" from a transient relay miss. */
type AnimatableBytes =
  | { kind: 'bytes'; bytes: Uint8Array; mimeType: string }
  | { kind: 'not-animatable' }
  | { kind: 'unavailable' };

async function fetchAnimatableBytes(normalized: string): Promise<AnimatableBytes> {
  if (isExtensionPageContext()) {
    const record = await getBackgroundAsset(normalized);
    if (!record || !isAnimatableMime(record.mimeType)) return { kind: 'not-animatable' };
    const buffer = await record.blob.arrayBuffer();
    return { kind: 'bytes', bytes: new Uint8Array(buffer), mimeType: record.mimeType };
  }

  // Content script — probe MIME cheaply first; only relay full bytes for animatable kinds.
  // A null meta is an ambiguous relay miss (SW cold start), so treat it as retryable.
  const meta = await requestBackgroundBlobMeta(normalized);
  if (!meta?.mimeType) return { kind: 'unavailable' };
  if (!isAnimatableMime(meta.mimeType)) return { kind: 'not-animatable' };
  const payload =
    (await requestBackgroundBlobViaPort(normalized)) ?? (await requestBackgroundBlobViaMessage(normalized));
  if (!payload) return { kind: 'unavailable' };
  return { kind: 'bytes', bytes: payload.bytes, mimeType: payload.mimeType };
}

type AnimatedOutcome =
  | { status: 'animated'; anim: AnimatedBackground }
  | { status: 'static' } // sticky: non-GIF, single-frame, corrupt, or unsupported env
  | { status: 'retry' }; // transient relay miss — evict so the next resolve re-attempts

async function resolveAnimatedOutcome(normalized: string): Promise<AnimatedOutcome> {
  if (!animatedDecodeSupported()) return { status: 'static' };

  const fetched = await fetchAnimatableBytes(normalized);
  if (fetched.kind === 'unavailable') return { status: 'retry' };
  if (fetched.kind === 'not-animatable') return { status: 'static' };

  const anim = await decodeAnimatedBackground(fetched.bytes, fetched.mimeType);
  if (!anim) return { status: 'static' }; // bytes present but undecodable — static fallback, don't hammer
  if (!anim.isAnimated) {
    anim.dispose(); // single-frame GIF — let the static path draw it
    return { status: 'static' };
  }
  return { status: 'animated', anim };
}

/**
 * Resolve the active background as an *animated* controller, or `null` when it's
 * static / non-GIF / undecodable (callers fall back to a static first frame). Works
 * in both the extension page (local blob) and the recorder content script (relay).
 */
export function loadAnimatedBackground(
  id: string | null | undefined,
): Promise<AnimatedBackground | null> {
  const normalized = normalizeBackgroundAssetId(id);
  if (!normalized) return Promise.resolve(null);
  if (animatedEntry?.id === normalized) return animatedEntry.promise;

  const previous = animatedEntry;
  const outcome = resolveAnimatedOutcome(normalized);
  const entry: AnimatedCacheEntry = {
    id: normalized,
    anim: null,
    promise: outcome.then((result) => (result.status === 'animated' ? result.anim : null)),
  };
  outcome
    .then((result) => {
      if (animatedEntry !== entry) {
        if (result.status === 'animated') queueAnimatedDisposal(result.anim); // superseded mid-flight
        return;
      }
      if (result.status === 'animated') entry.anim = result.anim;
      else if (result.status === 'retry') animatedEntry = null; // evict — next resolve retries
      // 'static' → keep the sticky null entry (no retry, no per-frame re-probe)
    })
    .catch(() => {
      if (animatedEntry === entry) animatedEntry = null;
    });
  animatedEntry = entry;

  // Retire the controller we just replaced once its decode has settled.
  if (previous) {
    previous.promise.then((anim) => queueAnimatedDisposal(anim)).catch(() => {});
  }

  return entry.promise;
}

/** Sync check for the Studio preview RAF — true once an *animated* GIF is decoded & active. */
export function isAnimatedBackgroundCached(id: string | null | undefined): boolean {
  const normalized = normalizeBackgroundAssetId(id);
  return !!normalized && animatedEntry?.id === normalized && !!animatedEntry.anim?.isAnimated;
}

export function evictBackgroundImageElementCache(id: string): void {
  const normalized = normalizeBackgroundAssetId(id);
  if (!normalized) return;
  evictDecodedBackgroundImage(normalized);
  if (animatedEntry?.id === normalized) {
    const stale = animatedEntry;
    animatedEntry = null;
    stale.promise.then((anim) => queueAnimatedDisposal(anim)).catch(() => {});
  }
}