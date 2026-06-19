/** Maximum recording length enforced by the MVP (3 minutes). */
export const MAX_RECORDING_SECONDS = 180;

/** Target canvas dimensions for the waveform video track. */
export const CANVAS_WIDTH = 640;
export const CANVAS_HEIGHT = 360;

/** Waveform drawing throttle target (fps). */
export const WAVEFORM_TARGET_FPS = 24;

/** AnalyserNode fftSize — keep small for performance. */
export const ANALYSER_FFT_SIZE = 64;

export const EXTENSION_LOG_PREFIX = '[Reddit Voice Notes]';