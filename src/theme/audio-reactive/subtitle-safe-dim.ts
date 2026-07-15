/**
 * CHANGED: dense visual scenes can reserve a calm caption reading zone in the captured canvas.
 * WHY: subtitles composite after the base video, so this dim must sit below them in both preview and export.
 */
export function drawSubtitleSafeDim(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  enabled: boolean,
): void {
  if (!enabled) return;

  const radius = canvas.width * 0.42;
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height * 0.72);
  ctx.scale(1, 0.38);
  const vignette = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
  vignette.addColorStop(0, 'rgba(7, 2, 16, 0.46)');
  vignette.addColorStop(0.58, 'rgba(7, 2, 16, 0.3)');
  vignette.addColorStop(1, 'rgba(7, 2, 16, 0)');
  ctx.fillStyle = vignette;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
