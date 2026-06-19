import { runWebmToMp4 } from '@/src/ffmpeg/ffmpeg-runner';
import {
  MSG_TRANSCODE_OFFSCREEN,
  type TranscodeOffscreenRequest,
  type TranscodeResponse,
} from '@/src/messaging/types';

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const request = message as TranscodeOffscreenRequest;
  if (request?.type !== MSG_TRANSCODE_OFFSCREEN || request.target !== 'offscreen') {
    return;
  }

  (async () => {
    try {
      const mp4 = await runWebmToMp4(request.webm);
      const mp4Buffer = mp4.buffer.slice(
        mp4.byteOffset,
        mp4.byteOffset + mp4.byteLength,
      ) as ArrayBuffer;
      const response: TranscodeResponse = {
        ok: true,
        mp4: mp4Buffer,
      };
      sendResponse(response);
    } catch (error) {
      const response: TranscodeResponse = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
      sendResponse(response);
    }
  })();

  return true;
});

console.log('[Reddit Voice Notes] Offscreen FFmpeg worker ready');