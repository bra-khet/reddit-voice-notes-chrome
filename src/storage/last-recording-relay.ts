import { packBinary } from '@/src/messaging/binary';
import {
  MSG_SAVE_LAST_RECORDING,
  type SaveLastRecordingRequest,
} from '@/src/messaging/types';

/**
 * Content scripts run on reddit.com — IndexedDB is page-origin, not extension-origin.
 * Relay through the service worker so Design Studio can load the same blob (dulcet-2 fix).
 */
export async function relaySaveLastRecording(
  blob: Blob,
  durationSeconds: number,
): Promise<void> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const packed = packBinary(bytes);

  const request: SaveLastRecordingRequest = {
    type: MSG_SAVE_LAST_RECORDING,
    webmBase64: packed.dataBase64,
    webmByteLength: packed.byteLength,
    durationSeconds,
  };

  try {
    await browser.runtime.sendMessage(request);
  } catch (error) {
    console.warn('[Reddit Voice Notes] Last recording relay failed', error);
  }
}