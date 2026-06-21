export const MSG_GET_BACKGROUND_BLOB = 'rvn/get-background-blob' as const;
export const MSG_GET_BACKGROUND_BLOB_META = 'rvn/get-background-blob-meta' as const;
export const MSG_GET_BACKGROUND_BLOB_CHUNK = 'rvn/get-background-blob-chunk' as const;
export const BACKGROUND_BLOB_PORT = 'rvn/background-blob' as const;

/** Raw bytes per relay chunk — keeps each MV3 hop under practical size limits. */
export const BACKGROUND_BLOB_CHUNK_BYTES = 256 * 1024;

export interface GetBackgroundBlobRequest {
  type: typeof MSG_GET_BACKGROUND_BLOB;
  id: string;
}

export interface GetBackgroundBlobMetaRequest {
  type: typeof MSG_GET_BACKGROUND_BLOB_META;
  id: string;
}

export interface GetBackgroundBlobChunkRequest {
  type: typeof MSG_GET_BACKGROUND_BLOB_CHUNK;
  id: string;
  chunkIndex: number;
}

export interface BackgroundBlobMetaPayload {
  ok: boolean;
  mimeType?: string;
  totalByteLength?: number;
  chunkCount?: number;
  error?: string;
}

export interface BackgroundBlobChunkPayload {
  ok: boolean;
  chunkIndex?: number;
  dataBase64?: string;
  byteLength?: number;
  error?: string;
}

/** @deprecated Single-shot blob relay — too large for MV3; use meta + chunk messages. */
export interface GetBackgroundBlobResponse extends BackgroundBlobMetaPayload {
  dataBase64?: string;
}

export interface BackgroundBlobPortRequest {
  id: string;
}

export type BackgroundBlobPortPhase = 'meta' | 'chunk' | 'done' | 'error';

export type BackgroundBlobPortMessage =
  | {
      phase: 'meta';
      ok: true;
      mimeType: string;
      totalByteLength: number;
      chunkCount: number;
    }
  | { phase: 'meta'; ok: false; error: string }
  | {
      phase: 'chunk';
      ok: true;
      chunkIndex: number;
      dataBase64: string;
      byteLength: number;
    }
  | { phase: 'chunk'; ok: false; chunkIndex: number; error: string }
  | { phase: 'done'; ok: true }
  | { phase: 'error'; ok: false; error: string };