/**
 * Transcription barrel — offscreen + harness only (eloquent-0).
 * Popup/settings must import leaf files (e.g. types.ts) — not this barrel — to avoid pulling Vosk WASM.
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

export { resolveVoskModelUrl, VOSK_MODEL_PATH, VOSK_TARGET_SAMPLE_RATE } from './constants';
export { buildSrtFromSegments } from './srt-builder';
export { enqueueTranscribeJob } from './transcribe-queue';
export { resetVoskForHarness, transcribeWebmBlob } from './transcribe-audio';
export { disposeVoskModel, loadVoskModel, voskModelIsLoaded } from './vosk-loader';