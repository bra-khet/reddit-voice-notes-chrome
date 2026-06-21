export function renderPreviewBlock(kind: 'primary' | 'secondary'): string {
  const label = kind === 'primary' ? 'Live preview' : 'Preview';
  const modifier = kind === 'secondary' ? ' studio__preview-wrap--secondary' : '';
  return `
    <div class="studio__preview-wrap${modifier}">
      <span class="studio__preview-label">${label}</span>
      <canvas
        class="studio__preview-canvas"
        data-preview-canvas
        data-preview-kind="${kind}"
        width="640"
        height="360"
        aria-label="Clip style preview"
        role="img"
      ></canvas>
    </div>
  `;
}