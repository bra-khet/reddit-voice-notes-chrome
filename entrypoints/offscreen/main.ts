import { disposeFfmpeg, runWebmToMp4 } from '@/src/ffmpeg/ffmpeg-runner';
import { enqueueTranscodeJob } from '@/src/ffmpeg/transcode-queue';
import { packBinary, unpackBinary } from '@/src/messaging/binary';
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
  void browser.runtime.sendMessage(message).catch((error) => {
    console.warn('[Reddit Voice Notes] Progress broadcast failed:', error);
  });
}

function broadcastProgress(jobId: string, progress: number, stage?: string): void {
  const progressMsg: TranscodeProgressMessage = {
    type: MSG_TRANSCODE_PROGRESS,
    jobId,
    progress: Math.min(100, Math.max(0, Math.round(progress * 100))),
    stage,
  };
  broadcast(progressMsg);
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
  broadcastProgress(request.jobId, 0.01, 'queued');

  void enqueueTranscodeJob(async () => {
    const startedAt = Date.now();
    try {
      const webmBytes = unpackBinary(request.webmBase64, request.webmByteLength);
      console.log('[Reddit Voice Notes] Transcode job started', request.jobId, {
        webmBytes: webmBytes.byteLength,
        base64Chars: request.webmBase64.length,
      });
      const mp4 = await runWebmToMp4(webmBytes, (ratio, stage) => {
        broadcastProgress(request.jobId, ratio, stage);
      });

      const mp4Packed = packBinary(mp4.slice());

      broadcastProgress(request.jobId, 1, 'done');

      const completeMsg: TranscodeCompleteMessage = {
        type: MSG_TRANSCODE_COMPLETE,
        jobId: request.jobId,
        ok: true,
        mp4Base64: mp4Packed.dataBase64,
        mp4ByteLength: mp4Packed.byteLength,
      };
      broadcast(completeMsg);
      console.log('[Reddit Voice Notes] Transcode job finished', request.jobId, {
        mp4Bytes: mp4Packed.byteLength,
        elapsedMs: Date.now() - startedAt,
      });
    } catch (error) {
      disposeFfmpeg();
      console.error('[Reddit Voice Notes] Transcode failed:', request.jobId, error);
      const completeMsg: TranscodeCompleteMessage = {
        type: MSG_TRANSCODE_COMPLETE,
        jobId: request.jobId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
      broadcast(completeMsg);
    }
  });

  return;
});

console.log('[Reddit Voice Notes] Offscreen FFmpeg worker ready');