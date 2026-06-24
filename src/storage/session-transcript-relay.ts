import { MSG_SAVE_SESSION_TRANSCRIPT, type SaveSessionTranscriptRequest } from '@/src/messaging/types';
import type { TranscriptResult } from '@/src/transcription/types';

/**
 * Reddit content scripts cannot write extension-origin IDB — relay transcript JSON via background (eloquent-2).
 */
export async function relaySaveSessionTranscript(
  result: TranscriptResult,
  jobId?: string,
): Promise<void> {
  const request: SaveSessionTranscriptRequest = {
    type: MSG_SAVE_SESSION_TRANSCRIPT,
    transcriptJson: JSON.stringify(result),
    jobId,
  };

  try {
    await browser.runtime.sendMessage(request);
  } catch (error) {
    console.warn('[Reddit Voice Notes] Session transcript relay failed', error);
  }
}