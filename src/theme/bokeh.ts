import type { ThemeBackground } from './types';

/** Single soft-focus orb — positions normalized 0–1 against canvas size. */
export interface BokehOrb {
  x: number;
  y: number;
  /** Radius as a fraction of min(canvas width, height). */
  radius: number;
  opacity: number;
  /** Radians offset for pulse animation. */
  phase: number;
}

export interface BokehBackgroundStyle {
  baseColor: string;
  coreColor: string;
  edgeColor: string;
  orbs: readonly BokehOrb[];
  /** 0–1 — how much orbs breathe over time. */
  pulseAmount: number;
  /** 0–1 — how much average audio level brightens orbs. */
  audioReactivity: number;
}

export const BOKEH_STYLES: Record<string, BokehBackgroundStyle> = {
  midnight: {
    baseColor: '#0a0e14',
    coreColor: '#79c0ff',
    edgeColor: '#1f6feb',
    pulseAmount: 0.12,
    audioReactivity: 0.18,
    orbs: [
      { x: 0.14, y: 0.19, radius: 0.2, opacity: 0.72, phase: 0 },
      { x: 0.33, y: 0.36, radius: 0.13, opacity: 0.5, phase: 1.4 },
      { x: 0.77, y: 0.25, radius: 0.24, opacity: 0.68, phase: 2.1 },
      { x: 0.55, y: 0.62, radius: 0.16, opacity: 0.42, phase: 0.8 },
      { x: 0.22, y: 0.72, radius: 0.11, opacity: 0.38, phase: 3.2 },
      { x: 0.88, y: 0.58, radius: 0.14, opacity: 0.45, phase: 1.9 },
      { x: 0.48, y: 0.15, radius: 0.09, opacity: 0.35, phase: 4.0 },
    ],
  },
};

export interface BokehDrawOptions {
  timeMs?: number;
  /** 0–1 smoothed audio level for live waveform. */
  audioEnergy?: number;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.length === 4
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex;
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function drawOrb(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  orb: BokehOrb,
  style: BokehBackgroundStyle,
  timeMs: number,
  audioEnergy: number,
  overlayMode: boolean,
): void {
  const { width, height } = canvas;
  const scale = Math.min(width, height);
  const cx = orb.x * width;
  const cy = orb.y * height;

  const pulse = 1 + style.pulseAmount * Math.sin(timeMs * 0.002 + orb.phase);
  const audioBoost = 1 + style.audioReactivity * audioEnergy;
  const breathe = 0.9 + 0.1 * Math.sin(timeMs * 0.0014 + orb.phase * 0.65);
  const radius = orb.radius * scale * pulse * audioBoost;
  const alpha = orb.opacity * breathe * (0.88 + 0.12 * audioEnergy);

  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  if (overlayMode) {
    // BUG FIX: Custom bokeh overlay color inversion on photos
    // Fix: Single tint — ramp alpha/brightness only; no complementary hue in gradient stops
    const tint = style.coreColor;
    gradient.addColorStop(0, rgba(tint, alpha * 0.9));
    gradient.addColorStop(0.35, rgba(tint, alpha * 0.5));
    gradient.addColorStop(0.68, rgba(tint, alpha * 0.18));
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  } else {
    gradient.addColorStop(0, rgba(style.coreColor, alpha));
    gradient.addColorStop(0.28, rgba(style.edgeColor, alpha * 0.55));
    gradient.addColorStop(0.62, rgba(style.edgeColor, alpha * 0.14));
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  }

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Draws a dark field with additive blue orbs — cheap radial "masks" for bokeh.
 * CHANGED: programmatic bokeh replaces midnight SVG (preview vs output mismatch).
 * WHY: SVG read as dark blobs; canvas orbs give spray-blue look on #0a0e14 base.
 */
export function drawBokehBackground(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  style: BokehBackgroundStyle,
  options: BokehDrawOptions = {},
): void {
  const timeMs = options.timeMs ?? 0;
  const audioEnergy = Math.min(1, Math.max(0, options.audioEnergy ?? 0));

  ctx.fillStyle = style.baseColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  // Additive blend — overlapping orbs bloom like out-of-focus highlights.
  ctx.globalCompositeOperation = 'screen';
  for (const orb of style.orbs) {
    drawOrb(ctx, canvas, orb, style, timeMs, audioEnergy, false);
  }
  ctx.restore();
}

export function resolveBokehStyle(background: ThemeBackground): BokehBackgroundStyle | null {
  if (background.type !== 'bokeh' || typeof background.value !== 'string') return null;
  return BOKEH_STYLES[background.value] ?? null;
}

export function backgroundIsBokeh(background: ThemeBackground): boolean {
  return background.type === 'bokeh' && typeof background.value === 'string';
}

function stripAlphaHex(color: string): string {
  return color.length === 9 ? color.slice(0, 7) : color;
}

/** Color-tinted bokeh orbs for custom-style overlays atop image backgrounds. */
export function buildTintedBokehOverlayStyle(barColor: string): BokehBackgroundStyle {
  const tint = stripAlphaHex(barColor);
  const midnight = BOKEH_STYLES.midnight;
  return {
    ...midnight,
    baseColor: 'transparent',
    coreColor: tint,
    edgeColor: tint,
    pulseAmount: midnight.pulseAmount * 0.9,
    audioReactivity: midnight.audioReactivity * 0.85,
    orbs: midnight.orbs.map((orb) => ({
      ...orb,
      opacity: orb.opacity * 0.68,
    })),
  };
}

/** Preset bokeh (e.g. Midnight Bokeh) as overlay atop personal/theme image backgrounds. */
export function buildPresetBokehOverlayStyle(presetKey: string): BokehBackgroundStyle | null {
  const preset = BOKEH_STYLES[presetKey];
  if (!preset) return null;
  return {
    ...preset,
    baseColor: 'transparent',
    orbs: preset.orbs.map((orb) => ({
      ...orb,
      opacity: orb.opacity * 0.72,
    })),
  };
}

/** Draw orbs only — base background already rendered underneath. */
export function drawBokehOverlay(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  style: BokehBackgroundStyle,
  options: BokehDrawOptions = {},
  /** Alpha-only tint overlays use source-over; preset blue orbs keep screen on dark bases. */
  blendMode: GlobalCompositeOperation = 'screen',
  overlayMode = false,
): void {
  const timeMs = options.timeMs ?? 0;
  const audioEnergy = Math.min(1, Math.max(0, options.audioEnergy ?? 0));

  ctx.save();
  ctx.globalCompositeOperation = blendMode;
  for (const orb of style.orbs) {
    drawOrb(ctx, canvas, orb, style, timeMs, audioEnergy, overlayMode);
  }
  ctx.restore();
}