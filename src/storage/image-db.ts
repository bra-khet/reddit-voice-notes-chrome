import {
  BACKGROUND_ID_PREFIX,
  BACKGROUND_IMPORT_ENABLED_KINDS,
  BACKGROUND_MIME_TYPES,
  DISPLAY_NAME_MAX_LENGTH,
  IMAGE_DB_NAME,
  IMAGE_DB_STORE_BACKGROUNDS,
  IMAGE_DB_VERSION,
  MAX_BACKGROUND_ASSET_COUNT,
  MAX_SINGLE_IMAGE_BACKGROUND_BYTES,
  MAX_SINGLE_VIDEO_BACKGROUND_BYTES,
  MAX_TOTAL_BACKGROUND_BYTES,
  type BackgroundAssetMeta,
  type BackgroundAssetRecord,
  type BackgroundImportErrorCode,
  type BackgroundMediaKind,
} from './image-db-types';

export {
  BACKGROUND_ID_PREFIX,
  BACKGROUND_IMPORT_ENABLED_KINDS,
  MAX_BACKGROUND_ASSET_COUNT,
  MAX_SINGLE_IMAGE_BACKGROUND_BYTES,
  MAX_SINGLE_VIDEO_BACKGROUND_BYTES,
  MAX_TOTAL_BACKGROUND_BYTES,
} from './image-db-types';
export type {
  BackgroundAssetMeta,
  BackgroundAssetRecord,
  BackgroundImportErrorCode,
  BackgroundMediaKind,
} from './image-db-types';

export class BackgroundImportError extends Error {
  readonly code: BackgroundImportErrorCode;

  constructor(message: string, code: BackgroundImportErrorCode) {
    super(message);
    this.name = 'BackgroundImportError';
    this.code = code;
  }
}

const objectUrlCache = new Map<string, string>();
const decodedImageCache = new Map<string, HTMLImageElement>();

let dbPromise: Promise<IDBDatabase> | null = null;

function requireIndexedDb(): IDBFactory {
  if (typeof indexedDB === 'undefined') {
    throw new BackgroundImportError('IndexedDB is unavailable in this context.', 'storage_failed');
  }
  return indexedDB;
}

function openImageDatabase(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = requireIndexedDb().open(IMAGE_DB_NAME, IMAGE_DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(IMAGE_DB_STORE_BACKGROUNDS)) {
          const store = db.createObjectStore(IMAGE_DB_STORE_BACKGROUNDS, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt', { unique: false });
          store.createIndex('mediaKind', 'mediaKind', { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbPromise = null;
        reject(
          new BackgroundImportError(
            request.error?.message ?? 'Failed to open ImageDB.',
            'storage_failed',
          ),
        );
      };
    });
  }

  return dbPromise;
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>,
): Promise<T> {
  return openImageDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(IMAGE_DB_STORE_BACKGROUNDS, mode);
        const store = tx.objectStore(IMAGE_DB_STORE_BACKGROUNDS);

        const outcome = run(store);
        const finalize = (value: T) => resolve(value);
        const fail = (error: unknown) => reject(error);

        if (outcome instanceof Promise) {
          outcome.then(finalize).catch(fail);
        } else {
          outcome.onsuccess = () => finalize(outcome.result as T);
          outcome.onerror = () =>
            fail(
              new BackgroundImportError(
                outcome.error?.message ?? 'ImageDB transaction failed.',
                'storage_failed',
              ),
            );
        }

        tx.onerror = () =>
          fail(
            new BackgroundImportError(
              tx.error?.message ?? 'ImageDB transaction aborted.',
              'storage_failed',
            ),
          );
      }),
  );
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        new BackgroundImportError(
          request.error?.message ?? 'ImageDB read failed.',
          'storage_failed',
        ),
      );
  });
}

function recordToMeta(record: BackgroundAssetRecord): BackgroundAssetMeta {
  const { blob: _blob, ...meta } = record;
  return meta;
}

export function createBackgroundAssetId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${BACKGROUND_ID_PREFIX}${crypto.randomUUID()}`;
  }
  return `${BACKGROUND_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function isBackgroundAssetId(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.startsWith(BACKGROUND_ID_PREFIX) && value.length > BACKGROUND_ID_PREFIX.length;
}

export function normalizeBackgroundAssetId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return isBackgroundAssetId(trimmed) ? trimmed : null;
}

export function resolveMediaKindForMime(mimeType: string): BackgroundMediaKind | null {
  const normalized = mimeType.toLowerCase();
  if (BACKGROUND_MIME_TYPES.image.includes(normalized)) {
    return normalized === 'image/gif' ? 'animated' : 'image';
  }
  if (BACKGROUND_MIME_TYPES.video.includes(normalized)) return 'video';
  return null;
}

function maxBytesForKind(kind: BackgroundMediaKind): number {
  return kind === 'video' ? MAX_SINGLE_VIDEO_BACKGROUND_BYTES : MAX_SINGLE_IMAGE_BACKGROUND_BYTES;
}

function sanitizeDisplayName(name: string): string {
  const trimmed = name.trim() || 'Background';
  return trimmed.slice(0, DISPLAY_NAME_MAX_LENGTH);
}

async function probeImageDimensions(
  blob: Blob,
  mimeType: string,
): Promise<{ width: number; height: number } | null> {
  if (!mimeType.startsWith('image/') || typeof createImageBitmap !== 'function') {
    return null;
  }

  try {
    const bitmap = await createImageBitmap(blob);
    const dims = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dims;
  } catch {
    return null;
  }
}

async function getStorageTotals(
  excludeId?: string,
): Promise<{ count: number; totalBytes: number }> {
  const records = await listBackgroundAssets();
  let count = 0;
  let totalBytes = 0;

  for (const record of records) {
    if (excludeId && record.id === excludeId) continue;
    count += 1;
    totalBytes += record.byteSize;
  }

  return { count, totalBytes };
}

function assertImportAllowed(file: File, mediaKind: BackgroundMediaKind): void {
  if (!BACKGROUND_IMPORT_ENABLED_KINDS.includes(mediaKind)) {
    throw new BackgroundImportError(
      mediaKind === 'video'
        ? 'Video backgrounds are not enabled yet.'
        : 'This background type is not importable yet.',
      'import_disabled',
    );
  }

  const maxBytes = maxBytesForKind(mediaKind);
  if (file.size > maxBytes) {
    const maxMb = Math.round(maxBytes / (1024 * 1024));
    throw new BackgroundImportError(
      `Background must be ${maxMb} MB or smaller.`,
      'file_too_large',
    );
  }
}

async function assertQuotaAllows(file: File, excludeId?: string): Promise<void> {
  const { count, totalBytes } = await getStorageTotals(excludeId);

  if (count >= MAX_BACKGROUND_ASSET_COUNT) {
    throw new BackgroundImportError(
      `You can store up to ${MAX_BACKGROUND_ASSET_COUNT} personal backgrounds.`,
      'quota_exceeded',
    );
  }

  if (totalBytes + file.size > MAX_TOTAL_BACKGROUND_BYTES) {
    throw new BackgroundImportError(
      'Personal background storage is full. Remove an existing background first.',
      'quota_exceeded',
    );
  }
}

export async function backgroundAssetExists(id: string): Promise<boolean> {
  const normalized = normalizeBackgroundAssetId(id);
  if (!normalized) return false;

  try {
    const record = await getBackgroundAsset(normalized);
    return record !== null;
  } catch {
    return false;
  }
}

export async function getBackgroundAsset(id: string): Promise<BackgroundAssetRecord | null> {
  const normalized = normalizeBackgroundAssetId(id);
  if (!normalized) return null;

  return runTransaction('readonly', (store) => store.get(normalized));
}

export async function getBackgroundAssetMeta(id: string): Promise<BackgroundAssetMeta | null> {
  const record = await getBackgroundAsset(id);
  return record ? recordToMeta(record) : null;
}

export async function listBackgroundAssets(): Promise<BackgroundAssetMeta[]> {
  const records = await runTransaction<BackgroundAssetRecord[]>('readonly', (store) => {
    const request = store.getAll();
    return requestToPromise(request);
  });

  return records
    .map(recordToMeta)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function importBackgroundAsset(
  file: File,
  options: { displayName?: string; replaceId?: string } = {},
): Promise<BackgroundAssetMeta> {
  const mimeType = (file.type || '').toLowerCase();
  const mediaKind = resolveMediaKindForMime(mimeType);

  if (!mediaKind) {
    throw new BackgroundImportError(
      'Use JPEG, PNG, WebP, or GIF for personal backgrounds.',
      'unsupported_type',
    );
  }

  assertImportAllowed(file, mediaKind);

  const replaceId = normalizeBackgroundAssetId(options.replaceId ?? null);
  if (options.replaceId && !replaceId) {
    throw new BackgroundImportError('Invalid background id for replace.', 'not_found');
  }

  if (replaceId) {
    const existing = await getBackgroundAsset(replaceId);
    if (!existing) {
      throw new BackgroundImportError('Background to replace was not found.', 'not_found');
    }
  }

  await assertQuotaAllows(file, replaceId ?? undefined);

  const dimensions = await probeImageDimensions(file, mimeType);
  if (mediaKind !== 'video' && !dimensions) {
    throw new BackgroundImportError(
      'Could not decode image. Try a different file.',
      'decode_failed',
    );
  }

  const now = Date.now();
  const id = replaceId ?? createBackgroundAssetId();
  const displayName = sanitizeDisplayName(options.displayName ?? file.name);

  const record: BackgroundAssetRecord = {
    id,
    mimeType,
    mediaKind,
    byteSize: file.size,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    displayName,
    createdAt: replaceId ? (await getBackgroundAssetMeta(replaceId))?.createdAt ?? now : now,
    updatedAt: now,
    blob: file,
  };

  await runTransaction('readwrite', (store) => store.put(record));
  revokeBackgroundObjectUrl(id);

  return recordToMeta(record);
}

export async function deleteBackgroundAsset(id: string): Promise<boolean> {
  const normalized = normalizeBackgroundAssetId(id);
  if (!normalized) return false;

  const existing = await getBackgroundAsset(normalized);
  if (!existing) return false;

  await runTransaction('readwrite', (store) => store.delete(normalized));
  revokeBackgroundObjectUrl(normalized);
  return true;
}

/** Object URL for canvas `Image` / future `HTMLVideoElement` loads (pretty-7b). */
export async function createBackgroundObjectUrl(id: string): Promise<string | null> {
  const normalized = normalizeBackgroundAssetId(id);
  if (!normalized) return null;

  const cached = objectUrlCache.get(normalized);
  if (cached) return cached;

  const record = await getBackgroundAsset(normalized);
  if (!record) return null;

  const url = URL.createObjectURL(record.blob);
  objectUrlCache.set(normalized, url);
  return url;
}

function evictDecodedBackgroundImage(id: string): void {
  const normalized = normalizeBackgroundAssetId(id);
  if (!normalized) return;
  decodedImageCache.delete(normalized);
}

export function revokeBackgroundObjectUrl(id: string): void {
  const normalized = normalizeBackgroundAssetId(id);
  if (!normalized) return;

  const cached = objectUrlCache.get(normalized);
  if (!cached) return;

  URL.revokeObjectURL(cached);
  objectUrlCache.delete(normalized);
  evictDecodedBackgroundImage(normalized);
}

/** Decode ImageDB blob to `HTMLImageElement` for canvas draw (pretty-7b). */
export async function loadBackgroundImageElement(id: string): Promise<HTMLImageElement | null> {
  const normalized = normalizeBackgroundAssetId(id);
  if (!normalized) return null;

  const cached = decodedImageCache.get(normalized);
  if (cached?.complete && cached.naturalWidth > 0) return cached;

  const url = await createBackgroundObjectUrl(normalized);
  if (!url) return null;

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      decodedImageCache.set(normalized, img);
      resolve(img);
    };
    img.onerror = () => {
      evictDecodedBackgroundImage(normalized);
      resolve(null);
    };
    img.src = url;
  });
}

export function revokeAllBackgroundObjectUrls(): void {
  for (const [id, url] of objectUrlCache.entries()) {
    URL.revokeObjectURL(url);
    objectUrlCache.delete(id);
  }
  decodedImageCache.clear();
}

export async function getBackgroundStorageSummary(): Promise<{
  count: number;
  totalBytes: number;
  maxCount: number;
  maxTotalBytes: number;
}> {
  const totals = await getStorageTotals();
  return {
    ...totals,
    maxCount: MAX_BACKGROUND_ASSET_COUNT,
    maxTotalBytes: MAX_TOTAL_BACKGROUND_BYTES,
  };
}