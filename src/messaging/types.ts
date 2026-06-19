export const MSG_TRANSCODE = 'rvn/transcode' as const;
export const MSG_TRANSCODE_OFFSCREEN = 'rvn/transcode-offscreen' as const;

export interface TranscodeRequest {
  type: typeof MSG_TRANSCODE;
  webm: ArrayBuffer;
}

export interface TranscodeOffscreenRequest {
  type: typeof MSG_TRANSCODE_OFFSCREEN;
  target: 'offscreen';
  webm: ArrayBuffer;
}

export interface TranscodeResponse {
  ok: boolean;
  mp4?: ArrayBuffer;
  error?: string;
}