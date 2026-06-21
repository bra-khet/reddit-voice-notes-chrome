import { DEFAULT_THEME_ID, getThemeById } from '@/src/theme/presets';
import type { WaveformTheme } from '@/src/theme/types';
import { RVN_COLORS } from '@/src/ui/tokens';

export interface ThemeChrome {
  accent: string;
  accentHover: string;
  accentText: string;
  focusRing: string;
  panelBorder: string;
  toastInfoAccent: string;
}

function parseHexColor(color: string): { r: number; g: number; b: number } | null {
  if (!color.startsWith('#')) return null;
  const hex = color.length === 4
    ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
    : color;
  if (hex.length !== 7) return null;
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function relativeLuminance(r: number, g: number, b: number): number {
  const toLinear = (channel: number): number => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function accentTextOn(accent: string): string {
  const rgb = parseHexColor(accent);
  if (!rgb) return '#ffffff';
  return relativeLuminance(rgb.r, rgb.g, rgb.b) > 0.62 ? '#1a1a1b' : '#ffffff';
}

function withAlpha(color: string, alpha: number): string {
  const rgb = parseHexColor(color);
  if (!rgb) return color;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

/** Maps clip theme bar/glow colors to recorder panel + toast accents (pretty-5). */
export function deriveChromeFromTheme(theme: WaveformTheme): ThemeChrome {
  const accent = theme.colors.bar;
  const glow = theme.colors.glow;
  const accentHover = glow.startsWith('#') ? glow : accent;

  return {
    accent,
    accentHover,
    accentText: accentTextOn(accent),
    focusRing: accent,
    panelBorder: withAlpha(accent, 0.28),
    toastInfoAccent: accent,
  };
}

export function defaultThemeChrome(): ThemeChrome {
  return deriveChromeFromTheme(getThemeById(DEFAULT_THEME_ID));
}

export const FALLBACK_CHROME: ThemeChrome = {
  accent: RVN_COLORS.redditOrange,
  accentHover: RVN_COLORS.redditOrangeHover,
  accentText: '#ffffff',
  focusRing: RVN_COLORS.redditBlue,
  panelBorder: RVN_COLORS.panelBorder,
  toastInfoAccent: RVN_COLORS.redditBlue,
};