import type { AudioPreferences } from '@/src/settings/user-preferences';

/** Ideal targets when enhanced capture is enabled — negotiated down, never required exact. */
export const IDEAL_SAMPLE_RATE_HZ = 48_000;
export const IDEAL_CHANNEL_COUNT_STEREO = 2;
export const IDEAL_CHANNEL_COUNT_MONO = 1;

export interface AudioCaptureProfile {
  /** Browser WebRTC DSP (echo/noise/AGC). Default on for economy path. */
  browserProcessing: boolean;
  /** Request ideal sample rate + channels for headset/high-quality path. */
  preferHighQuality: boolean;
}

export function profileFromPrefs(audio: AudioPreferences): AudioCaptureProfile {
  return {
    browserProcessing: !(audio.rawMicCapture ?? false),
    preferHighQuality: audio.preferHighQualityCapture ?? false,
  };
}

/** Human-readable label for the settings shell info row. */
export function describeCaptureProfile(audio: AudioPreferences): string {
  const profile = profileFromPrefs(audio);
  if (!profile.browserProcessing && profile.preferHighQuality) {
    return 'Raw + enhanced (ideal 48 kHz)';
  }
  if (!profile.browserProcessing) {
    return 'Raw (browser DSP off)';
  }
  if (profile.preferHighQuality) {
    return 'Enhanced (ideal 48 kHz stereo)';
  }
  return 'Economy (browser defaults)';
}

function processingConstraints(browserProcessing: boolean): Pick<
  MediaTrackConstraints,
  'echoCancellation' | 'noiseSuppression' | 'autoGainControl'
> {
  return {
    echoCancellation: browserProcessing,
    noiseSuppression: browserProcessing,
    autoGainControl: browserProcessing,
  };
}

/**
 * Builds a degradation ladder: most ambitious constraints first, economy last.
 * CHANGED: central audio constraint builder for pretty-3 toggles.
 * WHY: ideal constraints + fallback keeps recording working on every device.
 */
export function buildMicConstraintAttempts(profile: AudioCaptureProfile): MediaTrackConstraints[] {
  if (profile.browserProcessing && !profile.preferHighQuality) {
    return [];
  }

  const processing = processingConstraints(profile.browserProcessing);
  const attempts: MediaTrackConstraints[] = [];

  if (profile.preferHighQuality) {
    attempts.push({
      ...processing,
      sampleRate: { ideal: IDEAL_SAMPLE_RATE_HZ },
      channelCount: { ideal: IDEAL_CHANNEL_COUNT_STEREO },
    });
    attempts.push({
      ...processing,
      sampleRate: { ideal: IDEAL_SAMPLE_RATE_HZ },
      channelCount: { ideal: IDEAL_CHANNEL_COUNT_MONO },
    });
    attempts.push({
      ...processing,
      sampleRate: { ideal: IDEAL_SAMPLE_RATE_HZ },
    });
  }

  attempts.push({ ...processing });

  return attempts;
}

function isOverconstrained(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'OverconstrainedError';
}

/**
 * Acquire mic stream using prefs-driven constraints with graceful fallback.
 * Default prefs resolve to `{ audio: true }` — identical to pre-pretty-3 behavior.
 */
export async function acquireMicStream(audio: AudioPreferences): Promise<MediaStream> {
  const profile = profileFromPrefs(audio);
  const attempts = buildMicConstraintAttempts(profile);

  if (attempts.length === 0) {
    return navigator.mediaDevices.getUserMedia({ audio: true });
  }

  let lastError: unknown;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: constraints });
    } catch (error) {
      if (isOverconstrained(error)) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    throw lastError ?? error;
  }
}