import { buildScaffoldTranscriptResult } from './transcript-editing';
import { classifyTranscribeFailure } from './transcribe-failure';
import type { TranscriptFailureReason, TranscriptResult } from './types';

export { classifyTranscribeFailure } from './transcribe-failure';

export interface TranscribeCompletionLike {
  ok: boolean;
  transcriptJson?: string;
  error?: string;
}

export interface PersistableTranscribeCompletion {
  result: TranscriptResult;
  meta?: {
    error?: TranscriptFailureReason;
    isScaffolded?: boolean;
  };
}

function parseTranscriptResult(json: string | undefined, language?: string): TranscriptResult {
  if (!json) return { text: '', segments: [], source: 'vosk', language };

  const parsed = JSON.parse(json) as TranscriptResult;
  if (typeof parsed.text !== 'string' || !Array.isArray(parsed.segments)) {
    throw new Error('Transcribe completion contains invalid transcript JSON.');
  }

  return {
    text: parsed.text,
    segments: parsed.segments,
    language: parsed.language ?? language,
    source: parsed.source === 'manual' ? 'manual' : 'vosk',
    duration: parsed.duration,
  };
}

/**
 * Convert an offscreen terminal event into the single snapshot the background
 * persists. Cancellation belongs to a discarded/superseded job and must not
 * overwrite the transcript for a newer take.
 */
export function prepareTranscribeCompletionForPersistence(
  completion: TranscribeCompletionLike,
  clipDurationSeconds: number,
  language?: string,
): PersistableTranscribeCompletion | null {
  // BUG FIX: tab-close transcript completion was owned by a disposable page (BUG-038)
  // Fix: normalize success and graceful-failure snapshots in a context-neutral helper
  //      so the background can persist terminal state after the initiating tab is gone.
  // Sync: entrypoints/background.ts; src/recorder/voice-recorder.ts.
  if (!completion.ok && completion.error?.trim().toLowerCase() === 'cancelled') {
    return null;
  }

  const result = parseTranscriptResult(completion.transcriptJson, language);
  if (completion.ok) return { result };

  const failure = classifyTranscribeFailure({
    applied: false,
    fallback: true,
    stage: completion.error ?? 'transcribe-failed',
    result,
  });
  if (!failure) return { result };

  const scaffold = buildScaffoldTranscriptResult(clipDurationSeconds, {
    language: result.language ?? language,
  });
  return {
    result: scaffold,
    meta: { error: failure, isScaffolded: true },
  };
}
