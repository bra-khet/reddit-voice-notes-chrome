import {
  MSG_GET_BACKGROUND_BLOB,
  type GetBackgroundBlobRequest,
  type GetBackgroundBlobResponse,
} from '@/src/messaging/background-blob';
import {
  createBackgroundObjectUrl,
  normalizeBackgroundAssetId,
} from './image-db';

const decodedImageCache = new Map<string, HTMLImageElement>();

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

async function loadBackgroundImageElementLocal(id: string): Promise<HTMLImageElement | null> {
  const cached = decodedImageCache.get(id);
  if (cached?.complete && cached.naturalWidth > 0) return cached;

  const url = await createBackgroundObjectUrl(id);
  if (!url) return null;
  return loadImageFromUrl(url, id);
}

// BUG FIX: Personal background missing on recorded video
// Fix: Content scripts use the page origin IndexedDB, not extension ImageDB; relay blob via background worker.
// Sync: entrypoints/background.ts MSG_GET_BACKGROUND_BLOB handler
/**
 * Content scripts run on reddit.com — IndexedDB there is not the extension ImageDB.
 * Relay blob bytes through the background service worker (pretty-7b fix).
 */
async function loadBackgroundImageElementViaRelay(id: string): Promise<HTMLImageElement | null> {
  const cached = decodedImageCache.get(id);
  if (cached?.complete && cached.naturalWidth > 0) return cached;

  const request: GetBackgroundBlobRequest = {
    type: MSG_GET_BACKGROUND_BLOB,
    id,
  };

  const response = (await browser.runtime.sendMessage(request)) as GetBackgroundBlobResponse | undefined;
  if (!response?.ok || !response.buffer) return null;

  const blob = new Blob([response.buffer], { type: response.mimeType ?? 'image/jpeg' });
  const objectUrl = URL.createObjectURL(blob);
  const img = await loadImageFromUrl(objectUrl, id);
  URL.revokeObjectURL(objectUrl);
  return img;
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