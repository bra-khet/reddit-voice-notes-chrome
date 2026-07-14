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

/**
 * Seven fixed samples across the perceptually uniform Cividis ramp.
 * CHANGED: v6 shares one color-blind-safe visualizer/control ramp across Studio tracks.
 * WHY: spectrum intensity, performance cost, and background tools need identical semantics.
 */
export const CIVIDIS = [
  '#00204d',
  '#223d6c',
  '#565c6c',
  '#7b7b78',
  '#a69c75',
  '#d3c065',
  '#ffea46',
] as const;

/** CSS custom-property names mirrored in design-studio/studio-palette.css. */
export const CIVIDIS_CSS_VARIABLES = [
  '--rvn-cividis-0',
  '--rvn-cividis-16',
  '--rvn-cividis-33',
  '--rvn-cividis-50',
  '--rvn-cividis-67',
  '--rvn-cividis-84',
  '--rvn-cividis-100',
] as const;

/** Seconds before max recording when timer enters warning state. */
export const RECORDING_WARNING_SECONDS = 30;

/** Seconds before max when timer enters critical state. */
export const RECORDING_CRITICAL_SECONDS = 10;
