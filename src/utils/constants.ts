/** Nominal max shown in UI (3 minutes). */
export const DISPLAY_MAX_RECORDING_SECONDS = 180;

/**
 * Enforced recording stop — 2s under nominal so output stays inside Reddit's limit.
 * UI continues to display "3:00 max".
 */
export const MAX_RECORDING_SECONDS = DISPLAY_MAX_RECORDING_SECONDS - 2;

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