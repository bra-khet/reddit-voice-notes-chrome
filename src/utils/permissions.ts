import { EXTENSION_LOG_PREFIX } from './constants';

export type MicrophonePermissionState = PermissionState | 'unknown';

export interface MicrophonePermissionResult {
  state: MicrophonePermissionState;
  error?: string;
}

/**
 * Query current microphone permission without prompting.
 * Requires a secure context (reddit.com qualifies).
 */
export async function queryMicrophonePermission(): Promise<MicrophonePermissionResult> {
  if (!navigator.permissions?.query) {
    return { state: 'unknown' };
  }

  try {
    const status = await navigator.permissions.query({
      name: 'microphone' as PermissionName,
    });
    return { state: status.state };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`${EXTENSION_LOG_PREFIX} Could not query microphone permission:`, message);
    return { state: 'unknown', error: message };
  }
}

/**
 * Request microphone access via a user-gesture call to getUserMedia.
 * Immediately releases the stream — Phase 2 will hold it for recording.
 */
export async function requestMicrophonePermission(): Promise<MicrophonePermissionResult> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      state: 'denied',
      error: 'Microphone recording is not supported in this browser.',
    };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) {
      track.stop();
    }
    return { state: 'granted' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const denied =
      error instanceof DOMException &&
      (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError');

    return {
      state: denied ? 'denied' : 'unknown',
      error: message,
    };
  }
}