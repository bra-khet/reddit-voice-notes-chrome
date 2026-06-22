/**
 * Nominal max shown in UI (2 minutes).
 * CHANGED: lowered from 3:00 — see docs/bug-archive.md BUG-001.
 * WHY: ~15 MB cap WebM + base64 relay + canvas video bitrate exceeded stable pipeline limits
 * before BUG-007 dup-storm fix; 2:20 manual-stop (~14.7 MB) transcode reliably at 2:00 cap.
 * TENTATIVE: longer caps (e.g. 2:30–2:45) may be safe now that FFmpeg no longer dup-cascades
 * on large WebM — revisit only after sustained QA on full-length clips at higher bitrates.
 */
export const DISPLAY_MAX_RECORDING_SECONDS = 120;

/**
 * Enforced recording stop — matches display cap (true 2:00 / 2:00).
 * CHANGED: removed 2s underflow (was for Reddit's 3:00 upload limit, not needed at 2:00).
 */
export const MAX_RECORDING_SECONDS = DISPLAY_MAX_RECORDING_SECONDS;

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
 * Voice default: 80 Hz – 16 kHz. Full-spectrum mode (pretty-3 toggle) uses
 * FULL_SPECTRUM_FREQ_MIN_HZ through nyquist — see waveform.ts.
 */
export const VOICE_FREQ_MIN_HZ = 80;
export const VOICE_FREQ_MAX_HZ = 16000;

/** Full-spectrum viz maps bars across the audible range (pretty-3 toggle). */
export const FULL_SPECTRUM_FREQ_MIN_HZ = 20;

export const EXTENSION_LOG_PREFIX = '[Reddit Voice Notes]';

/** Offscreen pong stamp — bump when offscreen entry code changes (BUG-030). */
export const OFFSCREEN_WORKER_STAMP = 'offscreen-v2';

/** Burn-in pipeline stamp — bump when subtitle-burnin.ts changes; paired in offscreen pong. */
export const BURNIN_PIPELINE_STAMP = 'drawtext-only-v2';