export type PreviewBlockKind =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'subpanel'
  | 'subtitle-text';

const PREVIEW_LABELS: Record<PreviewBlockKind, string> = {
  primary: 'Live preview',
  secondary: 'Preview',
  tertiary: 'Effects preview',
  subpanel: 'Live preview',
  'subtitle-text': 'Caption preview',
};

const PREVIEW_MODIFIERS: Partial<Record<PreviewBlockKind, string>> = {
  secondary: ' studio__preview-wrap--secondary',
  tertiary: ' studio__preview-wrap--tertiary',
  subpanel: ' studio__preview-wrap--subpanel',
  'subtitle-text': ' studio__preview-wrap--subtitle-text',
};

export function renderPreviewBlock(kind: PreviewBlockKind): string {
  const label = PREVIEW_LABELS[kind];
  const modifier = PREVIEW_MODIFIERS[kind] ?? '';
  const backgroundManipulator = kind === 'primary'
    ? `
      <div
        class="studio__background-manipulator"
        data-background-manipulator
        tabindex="0"
        role="group"
        aria-label="Position personal background. Drag the image to pan, drag the focal point, or press Escape to center."
        hidden
      >
        <span class="studio__background-chip" aria-hidden="true">BG</span>
        <span class="studio__background-focal" data-background-focal-dot aria-hidden="true"></span>
      </div>
    `
    : '';
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
      ${backgroundManipulator}
    </div>
  `;
}
