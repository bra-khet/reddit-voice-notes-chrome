import { enqueueTranscodeJob } from '@/src/ffmpeg/transcode-queue';
import type { FfmpegProgressCallback } from '@/src/ffmpeg/ffmpeg-runner';
import { processAudio, processAudioBytes, type ProcessAudioResult } from './process-audio';
import type { VoiceEffectConfig } from './types';

/**
 * Serializes voice jobs on the same offscreen FFmpeg queue as transcode (shared WASM FS).
 */
export function enqueueProcessAudio(
  input: Blob,
  config: VoiceEffectConfig,
  onProgress?: FfmpegProgressCallback,
): Promise<ProcessAudioResult> {
  return enqueueTranscodeJob(() => processAudio(input, config, onProgress));
}

export function enqueueProcessAudioBytes(
  inputBytes: Uint8Array,
  config: VoiceEffectConfig,
  onProgress?: FfmpegProgressCallback,
) {
  return enqueueTranscodeJob(() => processAudioBytes(inputBytes, config, onProgress));
}