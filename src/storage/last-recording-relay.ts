import { packBinary } from '@/src/messaging/binary';
import {
  MSG_SAVE_LAST_RECORDING,
  type SaveLastRecordingRequest,
  type SaveLastRecordingResponse,
} from '@/src/messaging/types';
import { commitLastRecording } from '@/src/storage/artifact-commit';
import { isOwnStorageOrigin } from '@/src/utils/host-origin';

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

  let relayError: unknown;
  try {
    const response = (await browser.runtime.sendMessage(request)) as
      | SaveLastRecordingResponse
      | undefined;
    if (response?.ok) return;
    relayError = response?.error ?? 'No background relay answered.';
  } catch (error) {
    relayError = error;
  }

  // BUG FIX: hosted Studio silently lost every recording
  // Fix: this relay always addressed a background service worker. On a host that
  //      has none, sendMessage RESOLVES (it does not reject), so the old
  //      catch-and-warn never fired: the WebM was dropped, no artifact was
  //      stamped, and the Studio sat on "MP4 export not found yet — it may still
  //      be relaying from the recorder", which was untrue. Fall back to the same
  //      commit the background performs, but ONLY when this context owns the
  //      target IndexedDB — a Reddit content script must still relay, because its
  //      IDB is page-origin. The fallback is reached only when the relay did not
  //      succeed, so in the extension (where the background always answers) this
  //      path never runs and behaviour is unchanged.
  // Sync: last-base-mp4-relay.ts (same shape); src/storage/artifact-commit.ts
  //       owns the persist → signal → stamp sequence for both callers.
  if (isOwnStorageOrigin()) {
    await commitLastRecording(blob, durationSeconds);
    return;
  }

  console.warn('[Reddit Voice Notes] Last recording relay failed', relayError);
}
