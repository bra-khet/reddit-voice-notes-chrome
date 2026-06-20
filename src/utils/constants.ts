/**
 * Nominal max shown in UI (2 minutes).
 * CHANGED: lowered from 3:00 — see docs/bug-archive.md BUG-001.
 * WHY: ~15 MB cap WebM + base64 relay + canvas video bitrate exceeds stable pipeline limits;
 * 2:20 manual-stop recordings (~14.7 MB) transcode reliably; ~3:00 cap-stop does not.
 */
export const DISPLAY_MAX_RECORDING_SECONDS = 120;

/**
 * Enforced recording stop — 2s under nominal cap.
 * UI displays DISPLAY_MAX_RECORDING_SECONDS as the max (e.g. "2:00 max").
 */
export const MAX_RECORDING_SECONDS = DISPLAY_MAX_RECORDING_SECONDS - 2;

/** UI timer label, e.g. "2:00". */
export function formatRecordingCapClock(): string {
  const mins = Math.floor(DISPLAY_MAX_RECORDING_SECONDS / 60);
  const secs = DISPLAY_MAX_RECORDING_SECONDS % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/** Prose label for toasts/status, e.g. "2-minute". */
export function formatRecordingCapProse(): string {
  const secs = DISPLAY_MAX_RECORDING_SECONDS % 60;
  const mins = Math.floor(DISPLAY_MAX_RECORDING_SECONDS / 60);
  if (secs === 0) return `${mins}-minute`;
  return formatRecordingCapClock();
}

/** Target canvas dimensions for the waveform video track. */
export const CANVAS_WIDTH = 640;
export const CANVAS_HEIGHT = 360;

/** Waveform drawing throttle target (fps). */
export const WAVEFORM_TARGET_FPS = 24;

/** AnalyserNode fftSize.
 * Increased for usable frequency resolution in the 32-bar spectrum (was 64 → coarse 750 Hz bins).
 * 2048 is still very cheap at 24 fps and gives ~23 Hz bin width at 48 kHz.
 */
export const ANALYSER_FFT_SIZE = 2048;

/** Voice-focused frequency range for the 32-bar spectrum visualization.
 * Lows below ~80 Hz and highs above ~16 kHz are de-emphasized for normal speech.
 * CHANGED: previously used full linear bins from tiny FFT; now voice-centric.
 *
 * IMPORTANT (revisit before merge to main):
 * This range (80 Hz – 16 kHz) is intentionally voice-focused.
 * Before merging the pretty branch, revisit this. The user wants a future UI toggle
 * (similar to themes) so that full-spectrum / music input can be represented without
 * the voice roll-off. See also pretty-branch.md and claude-progress.md notes on
 * "Future audio pipeline & settings".
 */
export const VOICE_FREQ_MIN_HZ = 80;
export const VOICE_FREQ_MAX_HZ = 16000;

export const EXTENSION_LOG_PREFIX = '[Reddit Voice Notes]';