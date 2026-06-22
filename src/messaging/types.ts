import type { SubtitleStyleConfig, TranscriptSegment } from '@/src/transcription/types';
import type { VoiceEffectConfig } from '@/src/voice/types';

export const MSG_TRANSCODE_START = 'rvn/transcode-start' as const;
export const MSG_TRANSCODE_ACK = 'rvn/transcode-ack' as const;
export const MSG_TRANSCODE_OFFSCREEN = 'rvn/transcode-offscreen' as const;
export const MSG_TRANSCODE_PROGRESS = 'rvn/transcode-progress' as const;
export const MSG_TRANSCODE_COMPLETE = 'rvn/transcode-complete' as const;
export const MSG_TRANSCODE_CANCEL = 'rvn/transcode-cancel' as const;
export const MSG_OFFSCREEN_PING = 'rvn/offscreen-ping' as const;
export const MSG_OFFSCREEN_PONG = 'rvn/offscreen-pong' as const;
export const MSG_OPEN_RECORDER = 'rvn/open-recorder' as const;
export const MSG_SAVE_LAST_RECORDING = 'rvn/save-last-recording' as const;

/** eloquent-1 — parallel transcription fork message contracts. */
export const MSG_TRANSCRIBE_START = 'rvn/transcribe-start' as const;
export const MSG_TRANSCRIBE_ACK = 'rvn/transcribe-ack' as const;
export const MSG_TRANSCRIBE_OFFSCREEN = 'rvn/transcribe-offscreen' as const;
export const MSG_TRANSCRIBE_PROGRESS = 'rvn/transcribe-progress' as const;
export const MSG_TRANSCRIBE_COMPLETE = 'rvn/transcribe-complete' as const;
export const MSG_TRANSCRIBE_CANCEL = 'rvn/transcribe-cancel' as const;

/** eloquent-3 — second FFmpeg pass: burn subtitles onto base.mp4. */
export const MSG_BURNIN_START = 'rvn/burnin-start' as const;
export const MSG_BURNIN_ACK = 'rvn/burnin-ack' as const;
export const MSG_BURNIN_OFFSCREEN = 'rvn/burnin-offscreen' as const;
export const MSG_BURNIN_PROGRESS = 'rvn/burnin-progress' as const;
export const MSG_BURNIN_COMPLETE = 'rvn/burnin-complete' as const;
export const MSG_BURNIN_CANCEL = 'rvn/burnin-cancel' as const;

/** @deprecated Use MSG_TRANSCODE_START — kept for grep compatibility */
export const MSG_TRANSCODE = MSG_TRANSCODE_START;

export interface TranscodeStartRequest {
  type: typeof MSG_TRANSCODE_START;
  jobId: string;
  /** Base64 WebM — survives extension message relay (see src/messaging/binary.ts). */
  webmBase64: string;
  webmByteLength: number;
  /** dulcet-3: optional voice filter graph applied during AAC encode. */
  voiceEffect?: VoiceEffectConfig;
}

export interface TranscodeAckResponse {
  type: typeof MSG_TRANSCODE_ACK;
  jobId: string;
  ok: boolean;
  error?: string;
}

export interface TranscodeOffscreenRequest {
  type: typeof MSG_TRANSCODE_OFFSCREEN;
  target: 'offscreen';
  jobId: string;
  webmBase64: string;
  webmByteLength: number;
  voiceEffect?: VoiceEffectConfig;
}

export interface TranscodeCancelRequest {
  type: typeof MSG_TRANSCODE_CANCEL;
  jobId: string;
  /** Set when background relays to the offscreen worker. */
  target?: 'offscreen';
}

export interface TranscodeProgressMessage {
  type: typeof MSG_TRANSCODE_PROGRESS;
  jobId: string;
  progress: number;
  stage?: string;
}

export interface TranscodeCompleteMessage {
  type: typeof MSG_TRANSCODE_COMPLETE;
  jobId: string;
  ok: boolean;
  mp4Base64?: string;
  mp4ByteLength?: number;
  error?: string;
  /** dulcet-3: voice -af failed; MP4 uses raw captured audio. */
  voiceEffectFallback?: boolean;
}

export interface OffscreenPingRequest {
  type: typeof MSG_OFFSCREEN_PING;
  target: 'offscreen';
}

export interface OffscreenPongResponse {
  type: typeof MSG_OFFSCREEN_PONG;
  ready: boolean;
}

export interface OpenRecorderMessage {
  type: typeof MSG_OPEN_RECORDER;
}

export interface SaveLastRecordingRequest {
  type: typeof MSG_SAVE_LAST_RECORDING;
  webmBase64: string;
  webmByteLength: number;
  durationSeconds: number;
}

export interface SaveLastRecordingResponse {
  ok: boolean;
  error?: string;
}

/** eloquent-2 — relay STT result from Reddit tab to extension IDB for Design Studio. */
export const MSG_SAVE_SESSION_TRANSCRIPT = 'rvn/save-session-transcript' as const;

export interface SaveSessionTranscriptRequest {
  type: typeof MSG_SAVE_SESSION_TRANSCRIPT;
  transcriptJson: string;
  jobId?: string;
}

export interface SaveSessionTranscriptResponse {
  ok: boolean;
  error?: string;
}

export type TranscodeBroadcast =
  | TranscodeAckResponse
  | TranscodeProgressMessage
  | TranscodeCompleteMessage;

/** eloquent-1 — parallel transcription fork payload (raw WebM clone). */
export interface TranscribeStartRequest {
  type: typeof MSG_TRANSCRIBE_START;
  jobId: string;
  webmBase64: string;
  webmByteLength: number;
  language?: string;
}

export interface TranscribeAckResponse {
  type: typeof MSG_TRANSCRIBE_ACK;
  jobId: string;
  ok: boolean;
  error?: string;
}

export interface TranscribeOffscreenRequest {
  type: typeof MSG_TRANSCRIBE_OFFSCREEN;
  target: 'offscreen';
  jobId: string;
  webmBase64: string;
  webmByteLength: number;
  language?: string;
}

export interface TranscribeCancelRequest {
  type: typeof MSG_TRANSCRIBE_CANCEL;
  jobId: string;
  target?: 'offscreen';
}

export interface TranscribeProgressMessage {
  type: typeof MSG_TRANSCRIBE_PROGRESS;
  jobId: string;
  progress: number;
  stage?: string;
}

export interface TranscribeCompleteMessage {
  type: typeof MSG_TRANSCRIBE_COMPLETE;
  jobId: string;
  ok: boolean;
  /** JSON-serialized TranscriptResult when ok. */
  transcriptJson?: string;
  error?: string;
}

export type TranscribeBroadcast =
  | TranscribeAckResponse
  | TranscribeProgressMessage
  | TranscribeCompleteMessage;

export interface BurnInStartRequest {
  type: typeof MSG_BURNIN_START;
  jobId: string;
  mp4Base64: string;
  mp4ByteLength: number;
  segmentsJson: string;
  styleJson: string;
}

export interface BurnInAckResponse {
  type: typeof MSG_BURNIN_ACK;
  jobId: string;
  ok: boolean;
  error?: string;
}

export interface BurnInOffscreenRequest {
  type: typeof MSG_BURNIN_OFFSCREEN;
  target: 'offscreen';
  jobId: string;
  mp4Base64: string;
  mp4ByteLength: number;
  segmentsJson: string;
  styleJson: string;
}

export interface BurnInCancelRequest {
  type: typeof MSG_BURNIN_CANCEL;
  jobId: string;
  target?: 'offscreen';
}

export interface BurnInProgressMessage {
  type: typeof MSG_BURNIN_PROGRESS;
  jobId: string;
  progress: number;
  stage?: string;
}

export interface BurnInCompleteMessage {
  type: typeof MSG_BURNIN_COMPLETE;
  jobId: string;
  ok: boolean;
  mp4Base64?: string;
  mp4ByteLength?: number;
  error?: string;
}

export type BurnInBroadcast = BurnInAckResponse | BurnInProgressMessage | BurnInCompleteMessage;

export function parseBurnInSegmentsJson(json: string): TranscriptSegment[] {
  const parsed = JSON.parse(json) as TranscriptSegment[];
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (segment) =>
      typeof segment?.text === 'string' &&
      typeof segment?.start === 'number' &&
      typeof segment?.end === 'number',
  );
}

export function parseBurnInStyleJson(json: string): SubtitleStyleConfig {
  return JSON.parse(json) as SubtitleStyleConfig;
}