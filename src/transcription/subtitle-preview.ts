import {
  buildGlowLayerSpecs,
  resolveSubtitleEffectPalette,
} from '@/src/transcription/subtitle-effects';
import type { SubtitleStyleConfig } from './types';

export interface SubtitlePreviewOptions {
  enabled: boolean;
  text: string;
  style: SubtitleStyleConfig;
  /** Active theme bar color — resolves theme-hue glow in preview. */
  themeBarColor?: string;
  /** Wall-clock ms for animated special-hue rainbow (from preview RAF). */
  previewTimeMs?: number;
}

const PREVIEW_PLACEHOLDER = 'Your caption here';
const DEFAULT_THEME_BAR = '#00e5ff';

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = words[0] ?? '';

  for (let index = 1; index < words.length; index += 1) {
    const word = words[index];
    const trial = `${current} ${word}`;
    if (ctx.measureText(trial).width <= maxWidth) {
      current = trial;
      continue;
    }
    lines.push(current);
    current = word;
  }

  if (current) lines.push(current);
  return lines;
}

function verticalAnchor(
  position: SubtitleStyleConfig['position'],
  canvasHeight: number,
  blockHeight: number,
): number {
  const margin = Math.round(canvasHeight * 0.08);
  if (position === 'top') return margin;
  if (position === 'center') return Math.round((canvasHeight - blockHeight) / 2);
  return canvasHeight - blockHeight - margin;
}

function drawTextLines(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  textX: number,
  startY: number,
  lineHeight: number,
  offsetX = 0,
  offsetY = 0,
): void {
  let textY = startY + offsetY;
  for (const line of lines) {
    ctx.fillText(line, textX + offsetX, textY);
    textY += lineHeight;
  }
}

const SUBTITLE_TEXT_PREVIEW_WIDTH = 320;
const SUBTITLE_TEXT_PREVIEW_HEIGHT = 180;

/** Text-only caption preview for the Subtitles sub-panel (no bars/background). */
export function drawSubtitleTextOnlyPreview(
  canvas: HTMLCanvasElement,
  options: SubtitlePreviewOptions | undefined,
  timeMs: number = performance.now(),
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  canvas.width = SUBTITLE_TEXT_PREVIEW_WIDTH;
  canvas.height = SUBTITLE_TEXT_PREVIEW_HEIGHT;

  ctx.fillStyle = '#0a0014';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, 'rgba(18, 0, 31, 0.35)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!options?.enabled) return;

  drawSubtitlePreview(ctx, canvas, { ...options, previewTimeMs: timeMs });
}

/** Preview-only subtitle overlay — topmost layer over bars (eloquent-2; not encoded path). */
export function drawSubtitlePreview(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  options: SubtitlePreviewOptions,
): void {
  if (!options.enabled) return;

  const displayText = options.text.trim() || PREVIEW_PLACEHOLDER;
  const style = options.style;
  const fontSize = style.fontSize ?? 22;
  const fontFamily = style.fontFamily ?? 'system-ui, sans-serif';
  const lineHeight = Math.round(fontSize * 1.25);
  const maxWidth = Math.round(canvas.width * 0.88);
  const paddingX = 14;
  const paddingY = 10;
  const themeBarColor = options.themeBarColor ?? DEFAULT_THEME_BAR;
  const previewTimeSec = (options.previewTimeMs ?? performance.now()) / 1000;
  const palette = resolveSubtitleEffectPalette(style, themeBarColor, previewTimeSec);

  ctx.save();
  ctx.font = `600 ${fontSize}px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const lines = wrapText(ctx, displayText, maxWidth - paddingX * 2);
  if (lines.length === 0) {
    ctx.restore();
    return;
  }

  const blockWidth = Math.min(
    maxWidth,
    Math.max(...lines.map((line) => ctx.measureText(line).width)) + paddingX * 2,
  );
  const blockHeight = lines.length * lineHeight + paddingY * 2;
  const blockX = Math.round((canvas.width - blockWidth) / 2);
  const blockY = verticalAnchor(style.position, canvas.height, blockHeight);

  const backdrop = style.backdrop;
  if (backdrop?.enabled !== false) {
    const opacity = backdrop?.opacity ?? 0.72;
    const radius = backdrop?.borderRadius ?? 8;
    ctx.fillStyle = `rgba(0, 0, 0, ${opacity})`;
    fillRoundedRect(ctx, blockX, blockY, blockWidth, blockHeight, radius);
  }

  const textX = canvas.width / 2;
  const textY = blockY + paddingY;
  const glow = style.glow;

  if (glow?.enabled === true) {
    ctx.fillStyle = hexToRgba(palette.glowHex, 1);
    for (const spec of buildGlowLayerSpecs(glow, fontSize)) {
      ctx.globalAlpha = spec.opacity;
      drawTextLines(ctx, lines, textX, textY, lineHeight, spec.offsetX, spec.offsetY);
    }
    ctx.globalAlpha = 1;
  }

  ctx.fillStyle = palette.textHex;
  drawTextLines(ctx, lines, textX, textY, lineHeight);

  ctx.restore();
}

function hexToRgba(hex: string, opacity: number): string {
  const normalized = hex.startsWith('#') ? hex.slice(1) : hex;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

function fillRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
}