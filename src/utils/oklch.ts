import { hexToRgb, normalizeHexColor, rgbToHex } from '@/src/theme/color-utils';

/** Oklch tuple — L and C in 0–1 perceptual units; h in degrees [0, 360). */
export interface OklchColor {
  l: number;
  c: number;
  h: number;
}

/**
 * Vibrant full-spectrum rainbow anchor (v5.3.8).
 * Tuned to approximate prior HSV(·, 82%, 92%) brightness across hues.
 */
export const RAINBOW_OKLCH_LIGHTNESS = 0.78;
export const RAINBOW_OKLCH_CHROMA = 0.19;

function srgbChannelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgbChannel(channel: number): number {
  const clamped = Math.max(0, Math.min(1, channel));
  return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

function linearRgbToOklab(
  r: number,
  g: number,
  b: number,
): { L: number; a: number; b: number } {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

function oklabToLinearRgb(
  L: number,
  a: number,
  b: number,
): { r: number; g: number; b: number } {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

function oklabToOklch(L: number, a: number, b: number): OklchColor {
  const c = Math.sqrt(a * a + b * b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h };
}

function oklchToOklab(l: number, c: number, h: number): { L: number; a: number; b: number } {
  const hRad = (h * Math.PI) / 180;
  return { L: l, a: c * Math.cos(hRad), b: c * Math.sin(hRad) };
}

export function hexToOklch(hex: string): OklchColor | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;

  const r = srgbChannelToLinear(rgb.r);
  const g = srgbChannelToLinear(rgb.g);
  const b = srgbChannelToLinear(rgb.b);
  const lab = linearRgbToOklab(r, g, b);
  return oklabToOklch(lab.L, lab.a, lab.b);
}

export function oklchToHex(l: number, c: number, h: number): string {
  const hue = ((h % 360) + 360) % 360;
  const lab = oklchToOklab(l, Math.max(0, c), hue);
  const linear = oklabToLinearRgb(lab.L, lab.a, lab.b);
  return rgbToHex(
    linearToSrgbChannel(linear.r) * 255,
    linearToSrgbChannel(linear.g) * 255,
    linearToSrgbChannel(linear.b) * 255,
  );
}

/** Perceptually uniform hue rotation — keeps lightness and chroma stable. */
export function oklchRotateHue(hex: string, hueDeltaDegrees: number): string | null {
  const oklch = hexToOklch(hex);
  if (!oklch) return null;
  return oklchToHex(oklch.l, oklch.c, oklch.h + hueDeltaDegrees);
}

/** Full-spectrum rainbow color at animated hue angle (Oklch space). */
export function oklchRainbowHex(hueDegrees: number): string {
  const hue = ((hueDegrees % 360) + 360) % 360;
  return oklchToHex(RAINBOW_OKLCH_LIGHTNESS, RAINBOW_OKLCH_CHROMA, hue);
}

/**
 * Monochromatic glow pulse — modulate Oklch L/C around base color hue (v5.3.8).
 * Replaces prior HSV saturation/value sinusoid for perceptual consistency.
 */
export function oklchMonochromaticGlowHex(
  baseHex: string,
  phaseHueDegrees: number,
): string | null {
  const normalized = normalizeHexColor(baseHex);
  if (!normalized) return null;

  const base = hexToOklch(normalized);
  if (!base) return normalized;

  const t = (phaseHueDegrees / 360) * Math.PI * 2;
  const lightness = Math.max(0.38, Math.min(0.92, base.l + 0.08 * Math.sin(t)));
  const chroma = Math.max(0.04, Math.min(0.28, base.c * (0.78 + 0.22 * Math.cos(t))));
  return oklchToHex(lightness, chroma, base.h);
}