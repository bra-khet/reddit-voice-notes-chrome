/**
 * Transcription barrel — harness + offscreen clients only (eloquent-0).
 * Popup/settings must import leaf files (e.g. types.ts) — not this barrel.
 * Vosk WASM loads only inside vosk.sandbox.html (manifest sandbox CSP).
 */

export {
  DEFAULT_SUBTITLE_STYLE,
  DEFAULT_TRANSCRIPT_CONFIG,
  normalizeSubtitleStyle,
  normalizeTranscriptConfig,
  transcriptResultsEqual,
  transcriptSegmentsEqual,
  type SubtitleStyleConfig,
  type TranscribeAudioOptions,
  type TranscribeAudioResult,
  type TranscribeProgressCallback,
  type TranscriptConfig,
  type TranscriptResult,
  type TranscriptSegment,
  type TranscriptSource,
} from './types';

export {
  normalizeAbsoluteExtensionUrl,
  resolveVoskModelUrl,
  VOSK_MODEL_PATH,
  VOSK_SANDBOX_PATH,
  VOSK_TARGET_SAMPLE_RATE,
} from './constants';
export { buildSrtFromSegments } from './srt-builder';
export { enqueueTranscribeJob } from './transcribe-queue';
export { resetVoskForHarness, transcribeWebmBlob } from './transcribe-audio';
export { disposeVoskSandbox, ensureVoskSandbox, transcribePcmInSandbox } from './vosk-sandbox-client';