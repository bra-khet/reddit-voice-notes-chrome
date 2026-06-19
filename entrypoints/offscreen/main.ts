import { runWebmToMp4 } from '@/src/ffmpeg/ffmpeg-runner';
import {
  MSG_OFFSCREEN_PING,
  MSG_OFFSCREEN_PONG,
  MSG_TRANSCODE_COMPLETE,
  MSG_TRANSCODE_OFFSCREEN,
  MSG_TRANSCODE_PROGRESS,
  type OffscreenPingRequest,
  type OffscreenPongResponse,
  type TranscodeCompleteMessage,
  type TranscodeOffscreenRequest,
  type TranscodeProgressMessage,
} from '@/src/messaging/types';

function broadcast(message: TranscodeProgressMessage | TranscodeCompleteMessage): void {
  void browser.runtime.sendMessage(message);
}

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (typeof message !== 'object' || message === null) return;

  const ping = message as OffscreenPingRequest;
  if (ping.type === MSG_OFFSCREEN_PING && ping.target === 'offscreen') {
    const pong: OffscreenPongResponse = { type: MSG_OFFSCREEN_PONG, ready: true };
    sendResponse(pong);
    return;
  }

  const request = message as TranscodeOffscreenRequest;
  if (request.type !== MSG_TRANSCODE_OFFSCREEN || request.target !== 'offscreen') {
    return;
  }

  sendResponse({ ok: true, jobId: request.jobId });

  void (async () => {
    try {
      const mp4 = await runWebmToMp4(request.webm, (ratio) => {
        const progressMsg: TranscodeProgressMessage = {
          type: MSG_TRANSCODE_PROGRESS,
          jobId: request.jobId,
          progress: Math.round(ratio * 100),
        };
        broadcast(progressMsg);
      });

      const mp4Buffer = mp4.buffer.slice(
        mp4.byteOffset,
        mp4.byteOffset + mp4.byteLength,
      ) as ArrayBuffer;

      const completeMsg: TranscodeCompleteMessage = {
        type: MSG_TRANSCODE_COMPLETE,
        jobId: request.jobId,
        ok: true,
        mp4: mp4Buffer,
      };
      broadcast(completeMsg);
    } catch (error) {
      const completeMsg: TranscodeCompleteMessage = {
        type: MSG_TRANSCODE_COMPLETE,
        jobId: request.jobId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
      broadcast(completeMsg);
    }
  })();

  return;
});

console.log('[Reddit Voice Notes] Offscreen FFmpeg worker ready');