import { packBinary } from '@/src/messaging/binary';
import { MSG_SAVE_LAST_BASE_MP4, type SaveLastBaseMp4Request } from '@/src/messaging/types';

/**
 * Reddit content scripts cannot write extension-origin IDB — relay base MP4 via background (eloquent-4).
 */
export async function relaySaveLastBaseMp4(
  blob: Blob,
  durationSeconds: number,
): Promise<void> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const packed = packBinary(bytes);

  const request: SaveLastBaseMp4Request = {
    type: MSG_SAVE_LAST_BASE_MP4,
    mp4Base64: packed.dataBase64,
    mp4ByteLength: packed.byteLength,
    durationSeconds,
  };

  try {
    await browser.runtime.sendMessage(request);
  } catch (error) {
    console.warn('[Reddit Voice Notes] Last base MP4 relay failed', error);
  }
}