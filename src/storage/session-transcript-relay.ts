import { MSG_SAVE_SESSION_TRANSCRIPT, type SaveSessionTranscriptRequest } from '@/src/messaging/types';
import type { TranscriptFailureReason, TranscriptResult } from '@/src/transcription/types';

/** Graceful-failure metadata for the scaffold persistence path (v5.3). */
export interface SessionTranscriptSaveMeta {
  error?: TranscriptFailureReason;
  isScaffolded?: boolean;
}

/**
 * Reddit content scripts cannot write extension-origin IDB — relay transcript JSON via background (eloquent-2).
 * `meta` carries failure/scaffold info on the graceful-failure path (v5.3).
 */
export async function relaySaveSessionTranscript(
  result: TranscriptResult,
  jobId?: string,
  meta?: SessionTranscriptSaveMeta,
): Promise<void> {
  const request: SaveSessionTranscriptRequest = {
    type: MSG_SAVE_SESSION_TRANSCRIPT,
    transcriptJson: JSON.stringify(result),
    jobId,
    errorJson: meta?.error ? JSON.stringify(meta.error) : undefined,
    isScaffolded: meta?.isScaffolded === true ? true : undefined,
  };

  try {
    await browser.runtime.sendMessage(request);
  } catch (error) {
    console.warn('[Reddit Voice Notes] Session transcript relay failed', error);
  }
}