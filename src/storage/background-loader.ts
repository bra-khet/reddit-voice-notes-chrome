import {
  BACKGROUND_BLOB_PORT,
  MSG_GET_BACKGROUND_BLOB,
  type BackgroundBlobPortRequest,
  type BackgroundBlobPortResponse,
  type GetBackgroundBlobRequest,
  type GetBackgroundBlobResponse,
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
  // BUG FIX: Personal background missing on Reddit recorder canvas
  // Fix: data: URLs are blocked by Reddit img-src CSP; use blob: URL then createImageBitmap fallback.
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

async function requestBackgroundBlobViaPort(
  id: string,
): Promise<{ buffer: ArrayBuffer; mimeType: string } | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: { buffer: ArrayBuffer; mimeType: string } | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    try {
      const port = browser.runtime.connect({ name: BACKGROUND_BLOB_PORT });
      const timeout = setTimeout(() => {
        port.disconnect();
        finish(null);
      }, RELAY_TIMEOUT_MS);

      port.onMessage.addListener((message: BackgroundBlobPortResponse) => {
        clearTimeout(timeout);
        port.disconnect();
        if (message.ok && message.buffer) {
          finish({ buffer: message.buffer, mimeType: message.mimeType ?? 'image/jpeg' });
          return;
        }
        console.warn(
          '[Reddit Voice Notes] Personal background port relay failed:',
          message.error ?? 'unknown error',
        );
        finish(null);
      });

      port.onDisconnect.addListener(() => {
        clearTimeout(timeout);
        if (!settled) finish(null);
      });

      const request: BackgroundBlobPortRequest = { id };
      port.postMessage(request);
    } catch (error) {
      console.warn('[Reddit Voice Notes] Personal background port connect failed:', error);
      finish(null);
    }
  });
}

async function requestBackgroundBlobViaMessage(
  id: string,
): Promise<{ buffer: ArrayBuffer; mimeType: string } | null> {
  const request: GetBackgroundBlobRequest = {
    type: MSG_GET_BACKGROUND_BLOB,
    id,
  };

  try {
    const response = (await browser.runtime.sendMessage(request)) as GetBackgroundBlobResponse | undefined;
    if (response?.ok && response.buffer) {
      return { buffer: response.buffer, mimeType: response.mimeType ?? 'image/jpeg' };
    }
    console.warn(
      '[Reddit Voice Notes] Personal background message relay failed:',
      response?.error ?? 'no response',
    );
  } catch (error) {
    console.warn('[Reddit Voice Notes] Personal background message relay error:', error);
  }
  return null;
}

// Sync: entrypoints/background.ts BACKGROUND_BLOB_PORT handler
async function loadBackgroundImageElementViaRelay(id: string): Promise<DrawableBackgroundImage | null> {
  const cached = decodedImageCache.get(id);
  if (cached && isDrawableBackgroundReady(cached)) return cached;

  const payload =
    (await requestBackgroundBlobViaPort(id)) ?? (await requestBackgroundBlobViaMessage(id));
  if (!payload) return null;

  const blob = new Blob([payload.buffer], { type: payload.mimeType });
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