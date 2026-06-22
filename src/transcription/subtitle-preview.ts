import type { SubtitleStyleConfig } from './types';

export interface SubtitlePreviewOptions {
  enabled: boolean;
  text: string;
  style: SubtitleStyleConfig;
}

const PREVIEW_PLACEHOLDER = 'Your caption here';

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
  let textY = blockY + paddingY;

  const shadow = style.shadow;
  if (shadow?.enabled !== false) {
    const offsetX = shadow?.offsetX ?? 1;
    const offsetY = shadow?.offsetY ?? 1;
    const shadowOpacity = shadow?.opacity ?? 0.85;
    ctx.fillStyle = `rgba(0, 0, 0, ${shadowOpacity})`;
    for (const line of lines) {
      ctx.fillText(line, textX + offsetX, textY + offsetY);
      textY += lineHeight;
    }
    textY = blockY + paddingY;
  }

  ctx.fillStyle = '#ffffff';
  for (const line of lines) {
    ctx.fillText(line, textX, textY);
    textY += lineHeight;
  }

  ctx.restore();
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