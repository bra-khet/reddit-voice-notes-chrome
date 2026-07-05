export const MSG_GET_BAKED_MP4_META = 'rvn/get-baked-mp4-meta' as const;
export const MSG_GET_BAKED_MP4_CHUNK = 'rvn/get-baked-mp4-chunk' as const;

/** Raw bytes per relay chunk — same budget as personal background relay. */
export const BAKED_MP4_CHUNK_BYTES = 256 * 1024;

/**
 * v5.4.0 Phase 3: the relay serves both single-slot MP4 stores — 'baked'
 * (rvnLastBakedMp4, captioned) and 'base' (rvnLastBaseMp4, plain transcode) —
 * so "Attach current Studio take" works for never-baked takes too.
 * Omitted = 'baked' (backward compatible).
 */
export type TakeMp4Store = 'baked' | 'base';

export interface GetBakedMp4MetaRequest {
  type: typeof MSG_GET_BAKED_MP4_META;
  store?: TakeMp4Store;
}

export interface GetBakedMp4ChunkRequest {
  type: typeof MSG_GET_BAKED_MP4_CHUNK;
  chunkIndex: number;
  store?: TakeMp4Store;
}

export interface BakedMp4MetaPayload {
  ok: boolean;
  mimeType?: string;
  totalByteLength?: number;
  chunkCount?: number;
  savedAt?: number;
  error?: string;
}

export interface BakedMp4ChunkPayload {
  ok: boolean;
  chunkIndex?: number;
  dataBase64?: string;
  byteLength?: number;
  error?: string;
}