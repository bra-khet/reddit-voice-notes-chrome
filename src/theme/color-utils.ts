export interface HsvColor {
  h: number;
  s: number;
  v: number;
}

const HEX6_RE = /^#?([0-9a-f]{6})$/i;

export function normalizeHexColor(input: string): string | null {
  const trimmed = input.trim();
  const match = trimmed.match(HEX6_RE);
  if (!match) return null;
  return `#${match[1].toLowerCase()}`;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return null;
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
  const toHex = (value: number) => clamp(value).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function hexToHsv(hex: string): HsvColor | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;

  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  const s = max === 0 ? 0 : (delta / max) * 100;
  const v = max * 100;

  return { h, s, v };
}

export function hsvToHex(h: number, s: number, v: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const val = Math.max(0, Math.min(100, v)) / 100;

  const c = val * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = val - c;

  let r = 0;
  let g = 0;
  let b = 0;

  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/** Complementary glow accent — mirrors Neon Glow cyan ↔ magenta pairing. */
export function deriveGlowColor(barColor: string, alphaHex = 'aa'): string {
  const hsv = hexToHsv(barColor);
  if (!hsv) return `${barColor}${alphaHex}`;
  return `${hsvToHex((hsv.h + 180) % 360, Math.min(100, hsv.s * 1.05), Math.min(100, hsv.v * 1.02))}${alphaHex}`;
}

/** Dark backdrop tint derived from the bar hue. */
export function deriveBackgroundColor(barColor: string): string {
  const hsv = hexToHsv(barColor);
  if (!hsv) return '#060812';
  return hsvToHex(hsv.h, Math.min(55, hsv.s * 0.45), Math.max(4, hsv.v * 0.08));
}