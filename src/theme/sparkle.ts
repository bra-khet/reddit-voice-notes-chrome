import { hexToRgb } from '@/src/theme/color-utils';

export interface SparkleDrawOptions {
  timeMs?: number;
  audioEnergy?: number;
}

interface SparklePoint {
  x: number;
  y: number;
  phase: number;
  size: number;
}

/** Fixed star field — cheap twinkle, no per-frame allocation. */
const SPARKLE_POINTS: readonly SparklePoint[] = [
  { x: 0.08, y: 0.12, phase: 0.2, size: 1.1 },
  { x: 0.19, y: 0.28, phase: 1.4, size: 0.85 },
  { x: 0.31, y: 0.09, phase: 2.7, size: 1.0 },
  { x: 0.44, y: 0.22, phase: 0.9, size: 0.75 },
  { x: 0.57, y: 0.11, phase: 3.5, size: 1.15 },
  { x: 0.71, y: 0.18, phase: 1.8, size: 0.9 },
  { x: 0.86, y: 0.08, phase: 2.2, size: 0.8 },
  { x: 0.12, y: 0.48, phase: 4.1, size: 0.95 },
  { x: 0.26, y: 0.61, phase: 0.6, size: 1.05 },
  { x: 0.39, y: 0.52, phase: 2.9, size: 0.7 },
  { x: 0.53, y: 0.44, phase: 1.1, size: 1.2 },
  { x: 0.67, y: 0.57, phase: 3.8, size: 0.88 },
  { x: 0.79, y: 0.49, phase: 0.4, size: 0.82 },
  { x: 0.91, y: 0.63, phase: 2.5, size: 1.0 },
  { x: 0.15, y: 0.78, phase: 1.6, size: 0.9 },
  { x: 0.34, y: 0.84, phase: 3.1, size: 0.78 },
  { x: 0.48, y: 0.73, phase: 0.8, size: 1.1 },
  { x: 0.62, y: 0.81, phase: 2.0, size: 0.86 },
  { x: 0.76, y: 0.74, phase: 4.4, size: 0.95 },
  { x: 0.88, y: 0.86, phase: 1.3, size: 0.72 },
];

function rgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(255, 255, 255, ${alpha})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function stripAlphaHex(color: string): string {
  return color.length === 9 ? color.slice(0, 7) : color;
}

/**
 * Soft additive sparkles — layered on top of theme/personal backgrounds.
 * CHANGED: pretty-8 custom style sparkle overlay.
 * WHY: cheap canvas flair without shaders or getImageData.
 */
export function drawSparkleOverlay(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  barColor: string,
  glowColor: string,
  options: SparkleDrawOptions = {},
): void {
  const timeMs = options.timeMs ?? 0;
  const audioEnergy = Math.min(1, Math.max(0, options.audioEnergy ?? 0));
  const primary = stripAlphaHex(barColor);
  const accent = stripAlphaHex(glowColor);
  const scale = Math.min(canvas.width, canvas.height);

  ctx.save();
  ctx.globalCompositeOperation = 'screen';

  for (const point of SPARKLE_POINTS) {
    const twinkle = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(timeMs * 0.0032 + point.phase));
    const audioBoost = 0.85 + 0.15 * audioEnergy;
    const alpha = twinkle * audioBoost * 0.55;
    const radius = point.size * scale * 0.0075 * (0.85 + twinkle * 0.35);
    const cx = point.x * canvas.width;
    const cy = point.y * canvas.height;
    const tint = point.phase % 2 < 1 ? primary : accent;

    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gradient.addColorStop(0, rgba('#ffffff', alpha));
    gradient.addColorStop(0.35, rgba(tint, alpha * 0.75));
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}