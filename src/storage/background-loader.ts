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

const decodedImageCache = new Map<string, HTMLImageElement>();
const RELAY_TIMEOUT_MS = 45_000;

function evictDecodedBackgroundImage(id: string): void {
  decodedImageCache.delete(id);
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

async function decodeBlobToImage(blob: Blob, cacheKey: string): Promise<HTMLImageElement | null> {
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error ?? new Error('FileReader failed.'));
      reader.readAsDataURL(blob);
    });
    return loadImageFromUrl(dataUrl, cacheKey);
  } catch (error) {
    console.warn('[Reddit Voice Notes] Could not decode personal background blob:', error);
    return null;
  }
}

async function loadBackgroundImageElementLocal(id: string): Promise<HTMLImageElement | null> {
  const cached = decodedImageCache.get(id);
  if (cached?.complete && cached.naturalWidth > 0) return cached;

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

// BUG FIX: Personal background missing on recorded video
// Fix: Content scripts cannot read extension ImageDB; relay bytes via background port + data-URL decode.
// Sync: entrypoints/background.ts BACKGROUND_BLOB_PORT handler
async function loadBackgroundImageElementViaRelay(id: string): Promise<HTMLImageElement | null> {
  const cached = decodedImageCache.get(id);
  if (cached?.complete && cached.naturalWidth > 0) return cached;

  const payload =
    (await requestBackgroundBlobViaPort(id)) ?? (await requestBackgroundBlobViaMessage(id));
  if (!payload) return null;

  const blob = new Blob([payload.buffer], { type: payload.mimeType });
  const image = await decodeBlobToImage(blob, id);
  if (!image) {
    console.warn('[Reddit Voice Notes] Personal background image decode returned null for', id);
  }
  return image;
}

/** Decode ImageDB record to `HTMLImageElement` for canvas draw — works in popup and content script. */
export async function loadBackgroundImageElement(id: string): Promise<HTMLImageElement | null> {
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