import { disposeFfmpeg, runWebmToMp4, type RunWebmToMp4Result } from '@/src/ffmpeg/ffmpeg-runner';
import { normalizeVoiceEffectConfig, type VoiceEffectConfig } from '@/src/voice/types';
import { enqueueProcessAudio } from '@/src/voice/offscreen-queue';
import { VOICE_EFFECT_PRESETS, voiceConfigFromPreset } from '@/src/voice/presets';
import {
  assertTranscodeNotCancelled,
  clearTranscodeCancelled,
  isTranscodeCancelled,
  markTranscodeCancelled,
  setRunningTranscodeJob,
} from '@/src/ffmpeg/transcode-cancel';
import { enqueueTranscodeJob, whenTranscodeQueueIdle } from '@/src/ffmpeg/transcode-queue';
import { packBinary, unpackBinary } from '@/src/messaging/binary';
import {
  assertMp4Bytes,
  assertWebmBytes,
  verifyMp4PackedBinary,
} from '@/src/messaging/binary-verify';
import {
  MSG_OFFSCREEN_PING,
  MSG_OFFSCREEN_PONG,
  MSG_TRANSCODE_CANCEL,
  MSG_TRANSCODE_COMPLETE,
  MSG_TRANSCODE_OFFSCREEN,
  MSG_TRANSCODE_PROGRESS,
  MSG_TRANSCRIBE_CANCEL,
  MSG_TRANSCRIBE_COMPLETE,
  MSG_TRANSCRIBE_OFFSCREEN,
  MSG_TRANSCRIBE_PROGRESS,
  type OffscreenPingRequest,
  type OffscreenPongResponse,
  type TranscodeCancelRequest,
  type TranscodeCompleteMessage,
  type TranscodeOffscreenRequest,
  type TranscodeProgressMessage,
  type TranscribeCancelRequest,
  type TranscribeCompleteMessage,
  type TranscribeOffscreenRequest,
  type TranscribeProgressMessage,
} from '@/src/messaging/types';
import { runTranscribeWebmBlob } from '@/src/transcription/transcribe-audio';
import {
  assertTranscribeNotCancelled,
  clearTranscribeCancelled,
  isTranscribeCancelled,
  markTranscribeCancelled,
  setRunningTranscribeJob,
} from '@/src/transcription/transcribe-cancel';
import { enqueueTranscribeJob } from '@/src/transcription/transcribe-queue';
import { resolveVoskModelUrl } from '@/src/transcription/constants';

const HEARTBEAT_INTERVAL_MS = 8_000;
const JOB_RETRY_DELAY_MS = 400;
/** Wall-clock ceiling per job attempt — independent of heartbeat traffic. */
const JOB_WALL_CLOCK_MS = 90_000;

function broadcast(message: TranscodeProgressMessage | TranscodeCompleteMessage): void {
  void browser.runtime.sendMessage(message).catch((error) => {
    console.warn('[Reddit Voice Notes] Progress broadcast failed:', error);
  });
}

function broadcastTranscribe(message: TranscribeProgressMessage | TranscribeCompleteMessage): void {
  void browser.runtime.sendMessage(message).catch((error) => {
    console.warn('[Reddit Voice Notes] Transcribe broadcast failed:', error);
  });
}

function broadcastTranscribeProgress(jobId: string, progress: number, stage?: string): void {
  const progressMsg: TranscribeProgressMessage = {
    type: MSG_TRANSCRIBE_PROGRESS,
    jobId,
    progress: Math.min(100, Math.max(0, Math.round(progress * 100))),
    stage,
  };
  broadcastTranscribe(progressMsg);
}

function broadcastTranscribeCancelled(jobId: string): void {
  const completeMsg: TranscribeCompleteMessage = {
    type: MSG_TRANSCRIBE_COMPLETE,
    jobId,
    ok: false,
    error: 'Transcription cancelled.',
  };
  broadcastTranscribe(completeMsg);
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

function broadcastCancelled(jobId: string): void {
  const completeMsg: TranscodeCompleteMessage = {
    type: MSG_TRANSCODE_COMPLETE,
    jobId,
    ok: false,
    error: 'Transcode cancelled.',
  };
  broadcast(completeMsg);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function withJobWallClock<T>(jobId: string, work: () => Promise<T>): Promise<T> {
  let timer: number | null = null;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = window.setTimeout(() => {
      markTranscodeCancelled(jobId);
      disposeFfmpeg();
      reject(
        new Error(`Transcode timed out after ${Math.round(JOB_WALL_CLOCK_MS / 1000)}s. Reload the extension and try again.`),
      );
    }, JOB_WALL_CLOCK_MS);
  });

  try {
    return await Promise.race([work(), timeout]);
  } finally {
    if (timer !== null) window.clearTimeout(timer);
  }
}

async function runTranscodeAttempt(
  jobId: string,
  webmBytes: Uint8Array,
  attempt: number,
  voiceEffect?: VoiceEffectConfig,
): Promise<RunWebmToMp4Result> {
  let lastRatio = 0.01;
  let lastStage = attempt === 1 ? 'queued' : 'retry';

  // Syntactic liveness only — must not reset client stall timers (see docs/engineering-principles.md).
  const heartbeat = window.setInterval(() => {
    if (isTranscodeCancelled(jobId)) return;
    broadcastProgress(jobId, lastRatio, `${lastStage}-heartbeat`);
  }, HEARTBEAT_INTERVAL_MS);

  try {
    return await runWebmToMp4(
      webmBytes,
      (ratio, stage) => {
        assertTranscodeNotCancelled(jobId);
        lastRatio = Math.max(lastRatio, ratio);
        lastStage = stage;
        broadcastProgress(jobId, ratio, stage);
      },
      voiceEffect ? normalizeVoiceEffectConfig(voiceEffect) : undefined,
    );
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

  const cancel = message as TranscodeCancelRequest;
  if (cancel.type === MSG_TRANSCODE_CANCEL && cancel.target === 'offscreen') {
    markTranscodeCancelled(cancel.jobId);
    sendResponse({ ok: true, jobId: cancel.jobId });
    return;
  }

  const transcribeCancel = message as TranscribeCancelRequest;
  if (transcribeCancel.type === MSG_TRANSCRIBE_CANCEL && transcribeCancel.target === 'offscreen') {
    markTranscribeCancelled(transcribeCancel.jobId);
    sendResponse({ ok: true, jobId: transcribeCancel.jobId });
    return;
  }

  const transcribeRequest = message as TranscribeOffscreenRequest;
  if (transcribeRequest.type === MSG_TRANSCRIBE_OFFSCREEN && transcribeRequest.target === 'offscreen') {
    sendResponse({ ok: true, jobId: transcribeRequest.jobId });
    broadcastTranscribeProgress(transcribeRequest.jobId, 0.01, 'queued');

    void enqueueTranscribeJob(async () => {
      const startedAt = Date.now();
      setRunningTranscribeJob(transcribeRequest.jobId);

      try {
        if (isTranscribeCancelled(transcribeRequest.jobId)) {
          broadcastTranscribeCancelled(transcribeRequest.jobId);
          return;
        }

        // CHANGED: defer Vosk until FFmpeg queue is idle.
        // WHY: eloquent-1 parallel dispatch must not stack ~32 MB FFmpeg heap + ~40 MB Vosk model.
        broadcastTranscribeProgress(transcribeRequest.jobId, 0.02, 'waiting-for-transcode');
        await whenTranscodeQueueIdle();
        assertTranscribeNotCancelled(transcribeRequest.jobId);

        if (!transcribeRequest.webmBase64 || transcribeRequest.webmByteLength <= 0) {
          throw new Error(
            `WebM payload missing in offscreen transcribe worker (bytes=${transcribeRequest.webmByteLength}).`,
          );
        }

        const webmBytes = unpackBinary(transcribeRequest.webmBase64, transcribeRequest.webmByteLength).slice();
        assertWebmBytes(webmBytes, 'Offscreen transcribe unpack');
        const webmBlob = new Blob([webmBytes], { type: 'video/webm' });

        console.log('[Reddit Voice Notes] Transcribe job started', transcribeRequest.jobId, {
          webmBytes: webmBytes.byteLength,
          base64Chars: transcribeRequest.webmBase64.length,
        });

        // BUG FIX: transcribe queue deadlock (BUG-018)
        // Fix: offscreen already serializes via enqueueTranscribeJob — call runTranscribeWebmBlob (no inner queue).
        const outcome = await runTranscribeWebmBlob(webmBlob, {
          modelUrl: resolveVoskModelUrl(),
          language: transcribeRequest.language,
          onProgress: (ratio, stage) => {
            assertTranscribeNotCancelled(transcribeRequest.jobId);
            broadcastTranscribeProgress(transcribeRequest.jobId, ratio, stage);
          },
        });

        assertTranscribeNotCancelled(transcribeRequest.jobId);
        broadcastTranscribeProgress(transcribeRequest.jobId, 1, 'done');

        const completeMsg: TranscribeCompleteMessage = {
          type: MSG_TRANSCRIBE_COMPLETE,
          jobId: transcribeRequest.jobId,
          ok: outcome.applied,
          transcriptJson: JSON.stringify(outcome.result),
          error: outcome.fallback ? outcome.stage : undefined,
        };
        broadcastTranscribe(completeMsg);
        console.log('[Reddit Voice Notes] Transcribe job finished', transcribeRequest.jobId, {
          segments: outcome.result.segments.length,
          chars: outcome.result.text.length,
          elapsedMs: Date.now() - startedAt,
        });
      } catch (error) {
        if (isTranscribeCancelled(transcribeRequest.jobId)) {
          broadcastTranscribeCancelled(transcribeRequest.jobId);
          return;
        }
        console.error('[Reddit Voice Notes] Transcribe failed:', transcribeRequest.jobId, error);
        const completeMsg: TranscribeCompleteMessage = {
          type: MSG_TRANSCRIBE_COMPLETE,
          jobId: transcribeRequest.jobId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
        broadcastTranscribe(completeMsg);
      } finally {
        setRunningTranscribeJob(null);
        clearTranscribeCancelled(transcribeRequest.jobId);
      }
    });

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
    setRunningTranscodeJob(request.jobId);

    try {
      if (isTranscodeCancelled(request.jobId)) {
        broadcastCancelled(request.jobId);
        return;
      }

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

      let encodeResult: RunWebmToMp4Result;
      try {
        encodeResult = await withJobWallClock(request.jobId, () =>
          runTranscodeAttempt(request.jobId, webmBytes, 1, request.voiceEffect),
        );
      } catch (firstError) {
        if (isTranscodeCancelled(request.jobId)) {
          broadcastCancelled(request.jobId);
          return;
        }
        console.warn('[Reddit Voice Notes] Transcode retry after failure', request.jobId, firstError);
        disposeFfmpeg();
        await delay(JOB_RETRY_DELAY_MS);
        broadcastProgress(request.jobId, 0.05, 'retry');
        encodeResult = await withJobWallClock(request.jobId, () =>
          runTranscodeAttempt(request.jobId, webmBytes, 2, request.voiceEffect),
        );
      }

      assertTranscodeNotCancelled(request.jobId);
      assertMp4Bytes(encodeResult.bytes, 'FFmpeg output');
      const mp4Packed = packBinary(encodeResult.bytes.slice());
      verifyMp4PackedBinary(mp4Packed);

      broadcastProgress(request.jobId, 1, 'done');

      const completeMsg: TranscodeCompleteMessage = {
        type: MSG_TRANSCODE_COMPLETE,
        jobId: request.jobId,
        ok: true,
        mp4Base64: mp4Packed.dataBase64,
        mp4ByteLength: mp4Packed.byteLength,
        voiceEffectFallback: encodeResult.voiceEffectFallback,
      };
      broadcast(completeMsg);
      console.log('[Reddit Voice Notes] Transcode job finished', request.jobId, {
        mp4Bytes: mp4Packed.byteLength,
        elapsedMs: Date.now() - startedAt,
      });
    } catch (error) {
      if (isTranscodeCancelled(request.jobId)) {
        broadcastCancelled(request.jobId);
        return;
      }
      disposeFfmpeg();
      console.error('[Reddit Voice Notes] Transcode failed:', request.jobId, error);
      const completeMsg: TranscodeCompleteMessage = {
        type: MSG_TRANSCODE_COMPLETE,
        jobId: request.jobId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
      broadcast(completeMsg);
    } finally {
      setRunningTranscodeJob(null);
      clearTranscodeCancelled(request.jobId);
    }
  });

  return;
});

/** dulcet-1 manual harness — DevTools on this offscreen document (serialized via transcode queue). */
(globalThis as Record<string, unknown>).__rvnVoiceHarness = {
  enqueueProcessAudio,
  presets: VOICE_EFFECT_PRESETS,
  voiceConfigFromPreset,
};

/** eloquent-1 — offscreen transcription via MSG_TRANSCRIBE_* + vosk-sandbox iframe. */
(globalThis as Record<string, unknown>).__rvnTranscribeHarness = {
  transcribeWebmBlob,
  resolveVoskModelUrl,
};

console.log('[Reddit Voice Notes] Offscreen FFmpeg worker ready');