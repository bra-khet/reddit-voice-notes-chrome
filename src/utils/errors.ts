export type RecorderErrorCode =
  | 'mic-denied'
  | 'mic-unavailable'
  | 'mic-error'
  | 'empty-recording'
  | 'transcode-failed'
  | 'context-invalidated'
  | 'unknown';

export interface FriendlyError {
  code: RecorderErrorCode;
  message: string;
}

export function friendlyRecorderError(error: unknown): FriendlyError {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      return {
        code: 'mic-denied',
        message:
          'Microphone access was denied. Click the lock icon in the address bar, allow the microphone, then try again.',
      };
    }
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      return {
        code: 'mic-unavailable',
        message: 'No microphone was found. Connect a mic and try again.',
      };
    }
    if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
      return {
        code: 'mic-error',
        message: 'Your microphone is in use by another app. Close other apps using the mic and try again.',
      };
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes('extension context invalidated')) {
    return {
      code: 'context-invalidated',
      message: 'Extension was reloaded. Refresh this Reddit tab, then try again.',
    };
  }
  if (
    lower.includes('stalled') ||
    lower.includes('preflight') ||
    lower.includes('could not be verified') ||
    lower.includes('relay timeout')
  ) {
    return { code: 'transcode-failed', message };
  }
  if (lower.includes('mp4 conversion failed') || lower.includes('ffmpeg') || lower.includes('transcod')) {
    return {
      code: 'transcode-failed',
      message: message.startsWith('MP4 conversion failed:')
        ? message
        : `MP4 conversion failed: ${message}`,
    };
  }
  if (lower.includes('empty') || lower.includes('too short')) {
    return { code: 'empty-recording', message };
  }

  return { code: 'unknown', message: message || 'Something went wrong. Please try again.' };
}