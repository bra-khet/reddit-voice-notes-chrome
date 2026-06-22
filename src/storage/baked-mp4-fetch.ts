import { decodeBase64 } from '@/src/messaging/binary';
import {
  BAKED_MP4_CHUNK_BYTES,
  MSG_GET_BAKED_MP4_CHUNK,
  MSG_GET_BAKED_MP4_META,
  type BakedMp4ChunkPayload,
  type BakedMp4MetaPayload,
  type GetBakedMp4ChunkRequest,
  type GetBakedMp4MetaRequest,
} from '@/src/messaging/baked-mp4-blob';

/**
 * Fetch the latest baked MP4 from extension IDB via chunked background relay (eloquent-4).
 */
export async function fetchBakedMp4FromExtension(): Promise<Blob | null> {
  const metaRequest: GetBakedMp4MetaRequest = { type: MSG_GET_BAKED_MP4_META };
  const meta = (await browser.runtime.sendMessage(metaRequest)) as BakedMp4MetaPayload;

  if (!meta?.ok || !meta.totalByteLength || !meta.chunkCount) {
    return null;
  }

  const parts: Uint8Array[] = [];
  for (let chunkIndex = 0; chunkIndex < meta.chunkCount; chunkIndex += 1) {
    const chunkRequest: GetBakedMp4ChunkRequest = {
      type: MSG_GET_BAKED_MP4_CHUNK,
      chunkIndex,
    };
    const chunk = (await browser.runtime.sendMessage(chunkRequest)) as BakedMp4ChunkPayload;
    if (!chunk?.ok || !chunk.dataBase64 || !chunk.byteLength) {
      return null;
    }
    parts.push(decodeBase64(chunk.dataBase64, chunk.byteLength));
  }

  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  if (total !== meta.totalByteLength) return null;

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.byteLength;
  }

  return new Blob([merged], { type: meta.mimeType ?? 'video/mp4' });
}

export { BAKED_MP4_CHUNK_BYTES };