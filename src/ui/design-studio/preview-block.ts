export type PreviewBlockKind = 'primary' | 'secondary' | 'tertiary';

const PREVIEW_LABELS: Record<PreviewBlockKind, string> = {
  primary: 'Live preview',
  secondary: 'Preview',
  tertiary: 'Effects preview',
};

const PREVIEW_MODIFIERS: Partial<Record<PreviewBlockKind, string>> = {
  secondary: ' studio__preview-wrap--secondary',
  tertiary: ' studio__preview-wrap--tertiary',
};

export function renderPreviewBlock(kind: PreviewBlockKind): string {
  const label = PREVIEW_LABELS[kind];
  const modifier = PREVIEW_MODIFIERS[kind] ?? '';
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