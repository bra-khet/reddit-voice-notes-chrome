/**
 * v5.3 Subtitle QoL — graceful Vosk failure classification (design doc §7).
 *
 * Pure mapping from a completed transcribe outcome to a structured failure
 * reason, so the recorder can persist a scaffold snapshot instead of silently
 * dropping the result (the silent-pending-hang bug). Leaf module — imports types
 * only, safe for the content script (no Vosk/FFmpeg pull-in).
 */
import type { TranscribeAudioResult, TranscriptFailureReason } from './types';

/** The fields we need from a transcribe outcome (TranscribeAudioResult / client result). */
type TranscribeOutcomeLike = Pick<
  TranscribeAudioResult,
  'applied' | 'fallback' | 'stage' | 'result'
>;

/**
 * Classify a finished transcribe outcome into a failure reason — or `null` when
 * it actually succeeded (`applied`). Drives the scaffold path in voice-recorder.
 *
 * Mapping (from runTranscribeWebmBlob's result shapes):
 *  - applied                          → null (success; persisted normally)
 *  - stage mentions timeout           → 'timeout'      (120s race rejected)
 *  - fallback (core caught a throw)   → 'inference-error'
 *  - reached Vosk, no segments/text   → 'no-speech'
 *  - not applied but has content      → 'empty-result' (defensive)
 */
export function classifyTranscribeFailure(
  outcome: TranscribeOutcomeLike,
): TranscriptFailureReason | null {
  if (outcome.applied) return null;

  const stage = (outcome.stage ?? '').toLowerCase();
  if (stage.includes('timed out') || stage.includes('timeout')) {
    return { type: 'timeout', message: outcome.stage || 'Transcription timed out.' };
  }

  if (outcome.fallback) {
    return {
      type: 'inference-error',
      message: outcome.stage || 'Transcription failed before producing cues.',
    };
  }

  const segmentCount = outcome.result?.segments?.length ?? 0;
  const textLength = outcome.result?.text?.length ?? 0;
  if (segmentCount === 0 && textLength === 0) {
    return { type: 'no-speech', message: 'No speech detected in the recording.' };
  }

  return { type: 'empty-result', message: 'Transcription returned no usable cues.' };
}
