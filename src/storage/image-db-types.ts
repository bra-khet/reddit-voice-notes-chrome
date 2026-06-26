/** IndexedDB store for user background blobs — too large for `chrome.storage.local`. */

export const IMAGE_DB_NAME = 'rvnImageDb' as const;
export const IMAGE_DB_VERSION = 1 as const;
export const IMAGE_DB_STORE_BACKGROUNDS = 'backgrounds' as const;

export const BACKGROUND_ID_PREFIX = 'bg-' as const;

/** Static images (pretty-7) + animated GIF loops (animated branch); video reserved. */
export type BackgroundMediaKind = 'image' | 'video' | 'animated';

export type BackgroundImportErrorCode =
  | 'unsupported_type'
  | 'import_disabled'
  | 'file_too_large'
  | 'quota_exceeded'
  | 'decode_failed'
  | 'storage_failed'
  | 'not_found';

export interface BackgroundAssetMeta {
  id: string;
  mimeType: string;
  mediaKind: BackgroundMediaKind;
  byteSize: number;
  width: number | null;
  height: number | null;
  displayName: string;
  createdAt: number;
  updatedAt: number;
}

export interface BackgroundAssetRecord extends BackgroundAssetMeta {
  blob: Blob;
}

/** MIME types we may persist (video gated until a video background path ships). */
export const BACKGROUND_MIME_TYPES: Readonly<Record<BackgroundMediaKind, readonly string[]>> = {
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  animated: ['image/gif'],
  video: ['video/mp4', 'video/webm'],
};

// CHANGED: enable 'animated' GIF imports alongside static images.
// WHY: animated branch Phase 1 — GIF loops are rendered on the canvas (see
//      docs/gif-animation-design-implementation.md). Video stays gated.
/** Import surface — static images + animated GIFs; video stored later behind a flag. */
export const BACKGROUND_IMPORT_ENABLED_KINDS: readonly BackgroundMediaKind[] = ['image', 'animated'];

/** Per-file cap for static images (pretty-7). */
export const MAX_SINGLE_IMAGE_BACKGROUND_BYTES = 8 * 1024 * 1024;

/** Reserved cap for future lightweight video/loop backgrounds (not importable in 7a). */
export const MAX_SINGLE_VIDEO_BACKGROUND_BYTES = 15 * 1024 * 1024;

export const MAX_BACKGROUND_ASSET_COUNT = 24;
export const MAX_TOTAL_BACKGROUND_BYTES = 64 * 1024 * 1024;

export const DISPLAY_NAME_MAX_LENGTH = 48;

/** Default dim over personal photo backgrounds so bars stay readable (pretty-7b). */
export const USER_BACKGROUND_DIM_OVERLAY = 0.35;