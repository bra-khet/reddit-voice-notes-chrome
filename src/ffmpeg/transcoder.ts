import {
  MSG_TRANSCODE,
  type TranscodeRequest,
  type TranscodeResponse,
} from '@/src/messaging/types';

export async function transcodeWebmToMp4(
  webm: Blob,
  onProgress?: (ratio: number) => void,
): Promise<Blob> {
  const webmBuffer = await webm.arrayBuffer();
  const request: TranscodeRequest = { type: MSG_TRANSCODE, webm: webmBuffer };

  const response = (await browser.runtime.sendMessage(request)) as TranscodeResponse | undefined;
  if (!response?.ok || !response.mp4) {
    throw new Error(response?.error ?? 'FFmpeg transcoding failed.');
  }

  if (onProgress) onProgress(1);
  return new Blob([response.mp4], { type: 'video/mp4' });
}