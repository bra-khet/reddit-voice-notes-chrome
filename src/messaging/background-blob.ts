export const MSG_GET_BACKGROUND_BLOB = 'rvn/get-background-blob' as const;
export const BACKGROUND_BLOB_PORT = 'rvn/background-blob' as const;

export interface GetBackgroundBlobRequest {
  type: typeof MSG_GET_BACKGROUND_BLOB;
  id: string;
}

/** Base64 transport — ArrayBuffer is unreliable across MV3 relay hops (see messaging/binary.ts). */
export interface GetBackgroundBlobResponse {
  ok: boolean;
  mimeType?: string;
  dataBase64?: string;
  byteLength?: number;
  error?: string;
}

export interface BackgroundBlobPortRequest {
  id: string;
}

export interface BackgroundBlobPortResponse {
  ok: boolean;
  mimeType?: string;
  dataBase64?: string;
  byteLength?: number;
  error?: string;
}