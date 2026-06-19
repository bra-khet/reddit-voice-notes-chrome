export const MSG_TRANSCODE_START = 'rvn/transcode-start' as const;
export const MSG_TRANSCODE_ACK = 'rvn/transcode-ack' as const;
export const MSG_TRANSCODE_OFFSCREEN = 'rvn/transcode-offscreen' as const;
export const MSG_TRANSCODE_PROGRESS = 'rvn/transcode-progress' as const;
export const MSG_TRANSCODE_COMPLETE = 'rvn/transcode-complete' as const;
export const MSG_OFFSCREEN_PING = 'rvn/offscreen-ping' as const;
export const MSG_OFFSCREEN_PONG = 'rvn/offscreen-pong' as const;

/** @deprecated Use MSG_TRANSCODE_START — kept for grep compatibility */
export const MSG_TRANSCODE = MSG_TRANSCODE_START;

export interface TranscodeStartRequest {
  type: typeof MSG_TRANSCODE_START;
  jobId: string;
  webm: ArrayBuffer;
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
  webm: ArrayBuffer;
}

export interface TranscodeProgressMessage {
  type: typeof MSG_TRANSCODE_PROGRESS;
  jobId: string;
  progress: number;
}

export interface TranscodeCompleteMessage {
  type: typeof MSG_TRANSCODE_COMPLETE;
  jobId: string;
  ok: boolean;
  mp4?: ArrayBuffer;
  error?: string;
}

export interface OffscreenPingRequest {
  type: typeof MSG_OFFSCREEN_PING;
  target: 'offscreen';
}

export interface OffscreenPongResponse {
  type: typeof MSG_OFFSCREEN_PONG;
  ready: boolean;
}

export type TranscodeBroadcast =
  | TranscodeAckResponse
  | TranscodeProgressMessage
  | TranscodeCompleteMessage;