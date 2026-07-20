import type {
  BackgroundImagePosition,
  BackgroundScaleMode,
  NormalizedUserBackgroundLayout,
  UserBackgroundLayout,
} from './types';
import { USER_BACKGROUND_DIM_OVERLAY } from '../storage/image-db-types';

export const MIN_USER_BACKGROUND_MANUAL_SCALE = 0.5;
export const MAX_USER_BACKGROUND_MANUAL_SCALE = 3;
export const MAX_USER_BACKGROUND_BLUR = 12;
export const MIN_USER_BACKGROUND_GIF_SPEED = 0.5;
export const MAX_USER_BACKGROUND_GIF_SPEED = 2;

export const USER_BACKGROUND_BLEND_MODES = [
  'source-over',
  'multiply',
  'overlay',
  'screen',
  'soft-light',
] as const satisfies readonly GlobalCompositeOperation[];

type UserBackgroundBlendMode = (typeof USER_BACKGROUND_BLEND_MODES)[number];

export const DEFAULT_USER_BACKGROUND_LAYOUT: NormalizedUserBackgroundLayout = {
  scaleMode: 'fill',
  position: 'center',
  customPosition: { x: 0.5, y: 0.5 },
  manualScale: 1,
  dim: USER_BACKGROUND_DIM_OVERLAY,
  blur: 0,
  blendMode: 'source-over',
  gifSpeed: 1,
  gifReactToAudio: false,
  lockToSafeText: false,
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

function clampFinite(raw: unknown, min: number, max: number, fallback: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

function normalizeBoolean(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback;
}

function normalizeBackgroundBlendMode(raw: unknown): UserBackgroundBlendMode {
  if (
    typeof raw === 'string'
    && USER_BACKGROUND_BLEND_MODES.includes(raw as UserBackgroundBlendMode)
  ) {
    return raw as UserBackgroundBlendMode;
  }
  return 'source-over';
}

export function backgroundPositionToCustomPosition(
  position: BackgroundImagePosition,
): { x: number; y: number } {
  const x = position.endsWith('left') || position === 'left'
    ? 0
    : position.endsWith('right') || position === 'right'
      ? 1
      : 0.5;
  const y = position.startsWith('top') || position === 'top'
    ? 0
    : position.startsWith('bottom') || position === 'bottom'
      ? 1
      : 0.5;
  return { x, y };
}

function normalizeCustomPosition(
  raw: UserBackgroundLayout['customPosition'] | undefined,
  fallback: { x: number; y: number },
): { x: number; y: number } {
  if (!raw || typeof raw !== 'object') return fallback;
  return {
    x: clampFinite(raw.x, 0, 1, fallback.x),
    y: clampFinite(raw.y, 0, 1, fallback.y),
  };
}

export function normalizeUserBackgroundLayout(
  raw: Partial<UserBackgroundLayout> | null | undefined,
): NormalizedUserBackgroundLayout {
  const position = normalizeBackgroundPosition(raw?.position);
  const discretePosition = backgroundPositionToCustomPosition(position);

  // CHANGED: every additive layout field is normalized at the shared prefs/draw seam.
  // WHY: old profiles must reproduce their discrete layout while malformed imports cannot leak into Canvas state.
  return {
    scaleMode: normalizeBackgroundScaleMode(raw?.scaleMode),
    position,
    customPosition: normalizeCustomPosition(raw?.customPosition, discretePosition),
    manualScale: clampFinite(
      raw?.manualScale,
      MIN_USER_BACKGROUND_MANUAL_SCALE,
      MAX_USER_BACKGROUND_MANUAL_SCALE,
      DEFAULT_USER_BACKGROUND_LAYOUT.manualScale,
    ),
    dim: clampFinite(raw?.dim, 0, 1, USER_BACKGROUND_DIM_OVERLAY),
    blur: clampFinite(raw?.blur, 0, MAX_USER_BACKGROUND_BLUR, DEFAULT_USER_BACKGROUND_LAYOUT.blur),
    blendMode: normalizeBackgroundBlendMode(raw?.blendMode),
    gifSpeed: clampFinite(
      raw?.gifSpeed,
      MIN_USER_BACKGROUND_GIF_SPEED,
      MAX_USER_BACKGROUND_GIF_SPEED,
      DEFAULT_USER_BACKGROUND_LAYOUT.gifSpeed,
    ),
    gifReactToAudio: normalizeBoolean(
      raw?.gifReactToAudio,
      DEFAULT_USER_BACKGROUND_LAYOUT.gifReactToAudio,
    ),
    lockToSafeText: normalizeBoolean(
      raw?.lockToSafeText,
      DEFAULT_USER_BACKGROUND_LAYOUT.lockToSafeText,
    ),
  };
}

export function userBackgroundLayoutFromAppearance(appearance: {
  backgroundScaleMode?: BackgroundScaleMode;
  backgroundPosition?: BackgroundImagePosition;
  backgroundLayout?: Partial<UserBackgroundLayout>;
}): NormalizedUserBackgroundLayout {
  const nested = appearance.backgroundLayout;
  return normalizeUserBackgroundLayout({
    scaleMode: nested?.scaleMode ?? appearance.backgroundScaleMode,
    position: nested?.position ?? appearance.backgroundPosition,
    customPosition: nested?.customPosition,
    manualScale: nested?.manualScale,
    dim: nested?.dim,
    blur: nested?.blur,
    blendMode: nested?.blendMode,
    gifSpeed: nested?.gifSpeed,
    gifReactToAudio: nested?.gifReactToAudio,
    lockToSafeText: nested?.lockToSafeText,
  });
}

export function userBackgroundLayoutsEqual(
  left: NormalizedUserBackgroundLayout,
  right: NormalizedUserBackgroundLayout,
): boolean {
  return left.scaleMode === right.scaleMode
    && left.position === right.position
    && left.customPosition.x === right.customPosition.x
    && left.customPosition.y === right.customPosition.y
    && left.manualScale === right.manualScale
    && left.dim === right.dim
    && left.blur === right.blur
    && left.blendMode === right.blendMode
    && left.gifSpeed === right.gifSpeed
    && left.gifReactToAudio === right.gifReactToAudio
    && left.lockToSafeText === right.lockToSafeText;
}

export function computeImageDrawOffset(
  canvasWidth: number,
  canvasHeight: number,
  drawWidth: number,
  drawHeight: number,
  position: BackgroundImagePosition,
  customPosition?: UserBackgroundLayout['customPosition'],
): { dx: number; dy: number } {
  // CHANGED: normalized focal coordinates are primary; the 9-way anchor remains the migration fallback.
  // WHY: direct manipulation needs continuous placement without changing existing discrete-layout pixels.
  if (customPosition) {
    const dx = (canvasWidth - drawWidth) * customPosition.x;
    const dy = (canvasHeight - drawHeight) * customPosition.y;
    return {
      dx: dx === 0 ? 0 : dx,
      dy: dy === 0 ? 0 : dy,
    };
  }

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

export function computeImageDrawSize(
  canvasWidth: number,
  canvasHeight: number,
  imageWidth: number,
  imageHeight: number,
  scaleMode: BackgroundScaleMode,
  manualScale = DEFAULT_USER_BACKGROUND_LAYOUT.manualScale,
): { width: number; height: number } {
  // CHANGED: expose the painter's fit/fill geometry as shared pure layout math.
  // WHY: direct manipulation must invert the exact crop/letterbox span used by preview and capture.
  const baseScale = scaleMode === 'fill'
    ? Math.max(canvasWidth / imageWidth, canvasHeight / imageHeight)
    : Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight);
  const scale = baseScale * manualScale;
  return {
    width: imageWidth * scale,
    height: imageHeight * scale,
  };
}
