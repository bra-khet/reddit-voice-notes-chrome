export type PreviewBlockKind =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'subpanel'
  | 'background-precision'
  | 'subtitle-text';

const PREVIEW_LABELS: Record<PreviewBlockKind, string> = {
  primary: 'Live preview',
  secondary: 'Preview',
  tertiary: 'Effects preview',
  subpanel: 'Live preview',
  'background-precision': 'Position preview',
  'subtitle-text': 'Caption preview',
};

const PREVIEW_MODIFIERS: Partial<Record<PreviewBlockKind, string>> = {
  secondary: ' studio__preview-wrap--secondary',
  tertiary: ' studio__preview-wrap--tertiary',
  subpanel: ' studio__preview-wrap--subpanel',
  'background-precision': ' studio__preview-wrap--subpanel studio__preview-wrap--background-precision',
  'subtitle-text': ' studio__preview-wrap--subtitle-text',
};

function renderBackgroundGuideLayer(): string {
  return `
    <span class="studio__background-guide-layer" data-background-guide-layer aria-hidden="true">
      <span class="studio__background-guide studio__background-guide--x" style="--studio-background-guide-position:33.333%"></span>
      <span class="studio__background-guide studio__background-guide--x studio__background-guide--center" style="--studio-background-guide-position:50%"></span>
      <span class="studio__background-guide studio__background-guide--x" style="--studio-background-guide-position:66.667%"></span>
      <span class="studio__background-guide studio__background-guide--y" style="--studio-background-guide-position:33.333%"></span>
      <span class="studio__background-guide studio__background-guide--y studio__background-guide--center" style="--studio-background-guide-position:50%"></span>
      <span class="studio__background-guide studio__background-guide--y" style="--studio-background-guide-position:66.667%"></span>
      <span class="studio__background-caption-safe-band" data-background-caption-safe-band hidden></span>
      <span class="studio__background-active-guide studio__background-active-guide--x" data-background-active-guide-x hidden></span>
      <span class="studio__background-active-guide studio__background-active-guide--y" data-background-active-guide-y hidden></span>
    </span>
  `;
}

function renderBackgroundFramingOverlay(): string {
  return `
    <span
      class="studio__background-framing-overlay"
      data-background-framing-overlay
      data-background-framing-aspect="native"
      aria-hidden="true"
      hidden
    >
      <span class="studio__background-framing-frame">
        <span class="studio__background-framing-thirds" data-background-framing-thirds hidden>
          <span class="studio__background-framing-third studio__background-framing-third--x" style="--studio-background-third:33.333%"></span>
          <span class="studio__background-framing-third studio__background-framing-third--x" style="--studio-background-third:66.667%"></span>
          <span class="studio__background-framing-third studio__background-framing-third--y" style="--studio-background-third:33.333%"></span>
          <span class="studio__background-framing-third studio__background-framing-third--y" style="--studio-background-third:66.667%"></span>
        </span>
        <span class="studio__background-framing-label" data-background-framing-label>Native 16:9</span>
      </span>
    </span>
  `;
}

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
        ${renderBackgroundGuideLayer()}
        <span class="studio__background-chip" aria-hidden="true">BG</span>
        <span class="studio__background-focal" data-background-focal-dot aria-hidden="true"></span>
      </div>
    `
    : '';
  const precisionManipulator = kind === 'background-precision'
    ? `
      <div
        class="studio__background-precision-manipulator"
        data-background-precision-manipulator
        tabindex="0"
        role="group"
        aria-label="Fine background position. Drag the image or focal point."
        hidden
      >
        ${renderBackgroundGuideLayer()}
        <span
          class="studio__background-focal studio__background-focal--precision"
          data-background-focal-dot
          aria-hidden="true"
        ></span>
      </div>
    `
    : '';
  // CHANGED: the hero owns one DOM-only crop/thirds overlay above the canvas bitmap.
  // WHY: alternate-aspect framing must guide the 16:9 export without creating a renderer or captured layer.
  const backgroundFramingOverlay = kind === 'primary'
    ? renderBackgroundFramingOverlay()
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
      ${backgroundFramingOverlay}
      ${backgroundManipulator}
      ${precisionManipulator}
    </div>
  `;
}
