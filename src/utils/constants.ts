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

/** AnalyserNode fftSize — keep small for performance. */
export const ANALYSER_FFT_SIZE = 64;

export const EXTENSION_LOG_PREFIX = '[Reddit Voice Notes]';