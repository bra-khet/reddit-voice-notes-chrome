import type {
  BackgroundImagePosition,
  BackgroundScaleMode,
  UserBackgroundLayout,
} from './types';

export const DEFAULT_USER_BACKGROUND_LAYOUT: UserBackgroundLayout = {
  scaleMode: 'fill',
  position: 'center',
};

const VALID_SCALE_MODES: readonly BackgroundScaleMode[] = ['fit', 'fill'];
const VALID_POSITIONS: readonly BackgroundImagePosition[] = [
  'top',
  'top-left',
  'top-right',
  'center',
  'bottom',
  'bottom-left',
  'bottom-right',
  'left',
  'right',
];

export function normalizeBackgroundScaleMode(
  raw: BackgroundScaleMode | undefined,
): BackgroundScaleMode {
  if (raw && VALID_SCALE_MODES.includes(raw)) return raw;
  return DEFAULT_USER_BACKGROUND_LAYOUT.scaleMode;
}

export function normalizeBackgroundPosition(
  raw: BackgroundImagePosition | undefined,
): BackgroundImagePosition {
  if (raw && VALID_POSITIONS.includes(raw)) return raw;
  return DEFAULT_USER_BACKGROUND_LAYOUT.position;
}

export function normalizeUserBackgroundLayout(
  raw: Partial<UserBackgroundLayout> | null | undefined,
): UserBackgroundLayout {
  return {
    scaleMode: normalizeBackgroundScaleMode(raw?.scaleMode),
    position: normalizeBackgroundPosition(raw?.position),
  };
}

export function userBackgroundLayoutFromAppearance(appearance: {
  backgroundScaleMode?: BackgroundScaleMode;
  backgroundPosition?: BackgroundImagePosition;
}): UserBackgroundLayout {
  return normalizeUserBackgroundLayout({
    scaleMode: appearance.backgroundScaleMode,
    position: appearance.backgroundPosition,
  });
}

export function computeImageDrawOffset(
  canvasWidth: number,
  canvasHeight: number,
  drawWidth: number,
  drawHeight: number,
  position: BackgroundImagePosition,
): { dx: number; dy: number } {
  switch (position) {
    case 'top-left':
      return { dx: 0, dy: 0 };
    case 'top-right':
      return { dx: canvasWidth - drawWidth, dy: 0 };
    case 'bottom-left':
      return { dx: 0, dy: canvasHeight - drawHeight };
    case 'bottom-right':
      return { dx: canvasWidth - drawWidth, dy: canvasHeight - drawHeight };
    case 'left':
      return { dx: 0, dy: (canvasHeight - drawHeight) / 2 };
    case 'right':
      return { dx: canvasWidth - drawWidth, dy: (canvasHeight - drawHeight) / 2 };
    case 'top':
      return { dx: (canvasWidth - drawWidth) / 2, dy: 0 };
    case 'bottom':
      return { dx: (canvasWidth - drawWidth) / 2, dy: canvasHeight - drawHeight };
    case 'center':
    default:
      return {
        dx: (canvasWidth - drawWidth) / 2,
        dy: (canvasHeight - drawHeight) / 2,
      };
  }
}