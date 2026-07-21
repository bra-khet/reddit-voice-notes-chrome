import { rgbToHex } from '@/src/theme/color-utils';

export interface CanvasSamplePoint {
  x: number;
  y: number;
}

export function canvasSamplePointFromClient(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): CanvasSamplePoint | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || canvas.width <= 0 || canvas.height <= 0) {
    return null;
  }
  const x = Math.floor(((clientX - rect.left) / rect.width) * canvas.width);
  const y = Math.floor(((clientY - rect.top) / rect.height) * canvas.height);
  return {
    x: Math.max(0, Math.min(canvas.width - 1, x)),
    y: Math.max(0, Math.min(canvas.height - 1, y)),
  };
}

export function sampleCanvasColorAtClient(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): string | null {
  const point = canvasSamplePointFromClient(canvas, clientX, clientY);
  const ctx = canvas.getContext('2d');
  if (!point || !ctx) return null;
  try {
    // CHANGED: the Background tool samples the already-rendered in-surface pixel.
    // WHY: this avoids whole-screen permission and hands Style the exact color the user can see.
    const pixel = ctx.getImageData(point.x, point.y, 1, 1).data;
    if (pixel[3] === 0) return null;
    return rgbToHex(pixel[0], pixel[1], pixel[2]);
  } catch {
    return null;
  }
}
