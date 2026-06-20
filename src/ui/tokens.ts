/** Shared visual tokens for injected UI (panel, toast, waveform). */
export const RVN_COLORS = {
  redditOrange: '#d93900',
  redditOrangeHover: '#ff4500',
  redditBlue: '#0079d3',
  panelBg: '#1a1a1b',
  panelBorder: '#343536',
  surfaceDark: '#0f1115',
  surfaceRaised: '#272729',
  textPrimary: '#d7dadc',
  textMuted: '#818384',
  error: '#ff4500',
  success: '#46d160',
  warning: '#ffb000',
} as const;

/** Seconds before max recording when timer enters warning state. */
export const RECORDING_WARNING_SECONDS = 30;

/** Seconds before max when timer enters critical state. */
export const RECORDING_CRITICAL_SECONDS = 10;