import { disposeFfmpeg, runWebmToMp4 } from '@/src/ffmpeg/ffmpeg-runner';
import { enqueueTranscodeJob } from '@/src/ffmpeg/transcode-queue';
import { packBinary, unpackBinary } from '@/src/messaging/binary';
import {
  assertMp4Bytes,
  assertWebmBytes,
  verifyMp4PackedBinary,
} from '@/src/messaging/binary-verify';
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

const HEARTBEAT_INTERVAL_MS = 8_000;
const JOB_RETRY_DELAY_MS = 400;

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function runTranscodeAttempt(
  jobId: string,
  webmBytes: Uint8Array,
  attempt: number,
): Promise<Uint8Array> {
  let lastRatio = 0.01;
  let lastStage = attempt === 1 ? 'queued' : 'retry';

  const heartbeat = window.setInterval(() => {
    broadcastProgress(jobId, lastRatio, `${lastStage}-heartbeat`);
  }, HEARTBEAT_INTERVAL_MS);

  try {
    return await runWebmToMp4(webmBytes, (ratio, stage) => {
      lastRatio = Math.max(lastRatio, ratio);
      lastStage = stage;
      broadcastProgress(jobId, ratio, stage);
    });
  } finally {
    window.clearInterval(heartbeat);
  }
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
      if (!request.webmBase64 || request.webmByteLength <= 0) {
        throw new Error(
          `WebM payload missing in offscreen worker (bytes=${request.webmByteLength}).`,
        );
      }

      const webmBytes = unpackBinary(request.webmBase64, request.webmByteLength).slice();
      assertWebmBytes(webmBytes, 'Offscreen unpack');
      console.log('[Reddit Voice Notes] Transcode job started', request.jobId, {
        webmBytes: webmBytes.byteLength,
        base64Chars: request.webmBase64.length,
      });

      let mp4: Uint8Array;
      try {
        mp4 = await runTranscodeAttempt(request.jobId, webmBytes, 1);
      } catch (firstError) {
        console.warn('[Reddit Voice Notes] Transcode retry after failure', request.jobId, firstError);
        disposeFfmpeg();
        await delay(JOB_RETRY_DELAY_MS);
        broadcastProgress(request.jobId, 0.05, 'retry');
        mp4 = await runTranscodeAttempt(request.jobId, webmBytes, 2);
      }

      assertMp4Bytes(mp4, 'FFmpeg output');
      const mp4Packed = packBinary(mp4.slice());
      verifyMp4PackedBinary(mp4Packed);

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