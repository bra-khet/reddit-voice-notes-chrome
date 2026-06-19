import {
  MSG_TRANSCODE_ACK,
  MSG_TRANSCODE_COMPLETE,
  MSG_TRANSCODE_PROGRESS,
  MSG_TRANSCODE_START,
  type TranscodeAckResponse,
  type TranscodeBroadcast,
  type TranscodeCompleteMessage,
  type TranscodeProgressMessage,
  type TranscodeStartRequest,
} from '@/src/messaging/types';

const TRANSCODE_TIMEOUT_MS = 5 * 60 * 1000;

function isExtensionContextValid(): boolean {
  try {
    return Boolean(browser.runtime?.id);
  } catch {
    return false;
  }
}

export async function transcodeWebmToMp4(
  webm: Blob,
  onProgress?: (ratio: number) => void,
): Promise<Blob> {
  if (!isExtensionContextValid()) {
    throw new Error(
      'Extension context invalidated. Reload the extension, then refresh this Reddit tab.',
    );
  }

  const jobId = crypto.randomUUID();
  const webmBuffer = await webm.arrayBuffer();

  return new Promise<Blob>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      browser.runtime.onMessage.removeListener(onBroadcast);
      reject(new Error('FFmpeg transcoding timed out after 5 minutes.'));
    }, TRANSCODE_TIMEOUT_MS);

    const onBroadcast = (message: unknown) => {
      if (!message || typeof message !== 'object' || !('type' in message) || !('jobId' in message)) {
        return;
      }
      if ((message as { jobId: string }).jobId !== jobId) return;

      if ((message as { type: string }).type === MSG_TRANSCODE_PROGRESS) {
        const progressMsg = message as TranscodeProgressMessage;
        onProgress?.(progressMsg.progress / 100);
        return;
      }

      if ((message as { type: string }).type === MSG_TRANSCODE_COMPLETE) {
        const completeMsg = message as TranscodeCompleteMessage;
        window.clearTimeout(timeoutId);
        browser.runtime.onMessage.removeListener(onBroadcast);

        if (completeMsg.ok && completeMsg.mp4) {
          onProgress?.(1);
          resolve(new Blob([completeMsg.mp4], { type: 'video/mp4' }));
          return;
        }

        reject(new Error(completeMsg.error ?? 'FFmpeg transcoding failed.'));
      }
    };

    browser.runtime.onMessage.addListener(onBroadcast);

    const request: TranscodeStartRequest = {
      type: MSG_TRANSCODE_START,
      jobId,
      webm: webmBuffer,
    };

    browser.runtime
      .sendMessage(request)
      .then((ack) => {
        const response = ack as TranscodeAckResponse | undefined;
        if (!response?.ok) {
          window.clearTimeout(timeoutId);
          browser.runtime.onMessage.removeListener(onBroadcast);
          reject(new Error(response?.error ?? 'Failed to start FFmpeg transcoding.'));
        }
      })
      .catch((error) => {
        window.clearTimeout(timeoutId);
        browser.runtime.onMessage.removeListener(onBroadcast);
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('Extension context invalidated')) {
          reject(
            new Error(
              'Extension context invalidated. Reload the extension, then refresh this Reddit tab.',
            ),
          );
          return;
        }
        reject(new Error(message));
      });
  });
}