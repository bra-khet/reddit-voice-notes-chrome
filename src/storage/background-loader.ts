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
  normalizeBackgroundAssetId,
} from './image-db';

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
    chunks[chunkIndex] = await requestBackgroundBlobChunk(id, chunkIndex);
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
            fail(message.error ?? 'chunk failed', { chunkIndex: message.chunkIndex });
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

  const blob = new Blob([payload.bytes], { type: payload.mimeType });
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

export function evictBackgroundImageElementCache(id: string): void {
  const normalized = normalizeBackgroundAssetId(id);
  if (normalized) evictDecodedBackgroundImage(normalized);
}