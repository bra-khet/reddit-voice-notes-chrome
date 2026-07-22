import { packBinary } from '@/src/messaging/binary';
import {
  MSG_SAVE_LAST_BASE_MP4,
  type SaveLastBaseMp4Request,
  type SaveLastBaseMp4Response,
} from '@/src/messaging/types';
import { commitLastBaseMp4 } from '@/src/storage/artifact-commit';
import { isOwnStorageOrigin } from '@/src/utils/host-origin';

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

  let relayError: unknown;
  try {
    const response = (await browser.runtime.sendMessage(request)) as
      | SaveLastBaseMp4Response
      | undefined;
    if (response?.ok) return;
    relayError = response?.error ?? 'No background relay answered.';
  } catch (error) {
    relayError = error;
  }

  // BUG FIX: hosted Studio silently lost every base MP4 export
  // Fix: see last-recording-relay.ts for the full reasoning — same bug, same
  //      shape. Without the base MP4 stamp the take never leaves "MP4 export not
  //      found yet" and Download MP4 has nothing to hand over.
  // Sync: last-recording-relay.ts; src/storage/artifact-commit.ts owns the
  //       persist → stamp sequence for both callers.
  if (isOwnStorageOrigin()) {
    await commitLastBaseMp4(blob, durationSeconds);
    return;
  }

  console.warn('[Reddit Voice Notes] Last base MP4 relay failed', relayError);
}
