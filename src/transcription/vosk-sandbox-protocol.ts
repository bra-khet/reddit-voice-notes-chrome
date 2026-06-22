import type { TranscriptResult } from './types';

export const VOSK_SANDBOX_READY = 'rvn/vosk-sandbox-ready' as const;
export const VOSK_SANDBOX_TRANSCRIBE = 'rvn/vosk-sandbox-transcribe' as const;
export const VOSK_SANDBOX_PROGRESS = 'rvn/vosk-sandbox-progress' as const;
export const VOSK_SANDBOX_RESULT = 'rvn/vosk-sandbox-result' as const;
export const VOSK_SANDBOX_DISPOSE = 'rvn/vosk-sandbox-dispose' as const;

export interface VoskSandboxReadyMessage {
  type: typeof VOSK_SANDBOX_READY;
}

export interface VoskSandboxTranscribeMessage {
  type: typeof VOSK_SANDBOX_TRANSCRIBE;
  id: string;
  modelUrl: string;
  samples: Float32Array;
  sampleRate: number;
  language?: string;
}

export interface VoskSandboxProgressMessage {
  type: typeof VOSK_SANDBOX_PROGRESS;
  id: string;
  ratio: number;
  stage: string;
}

export interface VoskSandboxResultMessage {
  type: typeof VOSK_SANDBOX_RESULT;
  id: string;
  ok: boolean;
  result?: TranscriptResult;
  error?: string;
}

export interface VoskSandboxDisposeMessage {
  type: typeof VOSK_SANDBOX_DISPOSE;
}

export type VoskSandboxHostMessage = VoskSandboxTranscribeMessage | VoskSandboxDisposeMessage;

export type VoskSandboxClientMessage =
  | VoskSandboxReadyMessage
  | VoskSandboxProgressMessage
  | VoskSandboxResultMessage;

export function isVoskSandboxClientMessage(data: unknown): data is VoskSandboxClientMessage {
  if (typeof data !== 'object' || data === null) return false;
  const type = (data as { type?: string }).type;
  return (
    type === VOSK_SANDBOX_READY ||
    type === VOSK_SANDBOX_PROGRESS ||
    type === VOSK_SANDBOX_RESULT
  );
}