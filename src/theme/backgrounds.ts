import {
  drawBokehBackground,
  resolveBokehStyle,
  type BokehDrawOptions,
} from './bokeh';
import {
  type DrawableBackgroundImage,
  getDrawableBackgroundSize,
  isDrawableBackgroundReady,
  loadBackgroundImageElement,
} from '@/src/storage/background-loader';
import { normalizeBackgroundAssetId } from '@/src/storage/image-db';
import { USER_BACKGROUND_DIM_OVERLAY } from '@/src/storage/image-db-types';
import type { BackgroundScaleMode, ThemeBackground, WaveformTheme } from './types';

/** Personal backgrounds cover the frame; bundled theme images default to contain. */
export const USER_BACKGROUND_SCALE_MODE: BackgroundScaleMode = 'fill';

export type { BokehDrawOptions };

/** Bundled static backgrounds under `public/assets/backgrounds/`. */
export const BACKGROUND_ASSETS = {
  aurora: 'assets/backgrounds/aurora.svg',
  'midnight-bokeh': 'assets/backgrounds/midnight-bokeh.svg',
  'warm-glow': 'assets/backgrounds/warm-glow.svg',
} as const;

export type BackgroundAssetKey = keyof typeof BACKGROUND_ASSETS;

const imageCache = new Map<string, HTMLImageElement>();

export function resolveBackgroundAssetUrl(key: string): string | null {
  const path = BACKGROUND_ASSETS[key as BackgroundAssetKey];
  if (!path) return null;
  try {
    if (!browser.runtime?.id) return null;
    return browser.runtime.getURL(path as never);
  } catch {
    // Extension context invalidated (reload) — avoid chrome-extension://invalid/ requests.
    return null;
  }
}

export function isBackgroundAssetKey(value: string): value is BackgroundAssetKey {
  return value in BACKGROUND_ASSETS;
}

export async function loadUserBackgroundImage(id: string): Promise<DrawableBackgroundImage | null> {
  return loadBackgroundImageElement(id);
}

export interface ResolvedClipBackgrounds {
  userBackgroundImage: DrawableBackgroundImage | null;
  bundledBackgroundImage: HTMLImageElement | null;
}

/** Resolve personal ImageDB background first; fall back to bundled theme image (pretty-7b). */
export async function resolveClipBackgrounds(
  theme: WaveformTheme,
  customBackgroundId: string | null | undefined,
): Promise<ResolvedClipBackgrounds> {
  const normalizedId = normalizeBackgroundAssetId(customBackgroundId);
  if (normalizedId) {
    const userBackgroundImage = await loadUserBackgroundImage(normalizedId);
    if (userBackgroundImage) {
      return { userBackgroundImage, bundledBackgroundImage: null };
    }
  }

  let bundledBackgroundImage: HTMLImageElement | null = null;
  if (backgroundNeedsImage(theme.background) && typeof theme.background.value === 'string') {
    bundledBackgroundImage = await loadBackgroundImage(theme.background.value);
  }

  return { userBackgroundImage: null, bundledBackgroundImage };
}

export async function loadBackgroundImage(key: string): Promise<HTMLImageElement | null> {
  const cached = imageCache.get(key);
  if (cached?.complete && cached.naturalWidth > 0) return cached;

  const url = resolveBackgroundAssetUrl(key);
  if (!url) return null;

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      imageCache.set(key, img);
      resolve(img);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

interface DrawImageBackgroundOptions {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  image: DrawableBackgroundImage;
  letterboxColor: string;
  scaleMode: BackgroundScaleMode;
}

function drawImageBackground({
  ctx,
  canvas,
  image,
  letterboxColor,
  scaleMode,
}: DrawImageBackgroundOptions): void {
  const { width, height } = canvas;
  ctx.fillStyle = letterboxColor;
  ctx.fillRect(0, 0, width, height);

  const { width: imageWidth, height: imageHeight } = getDrawableBackgroundSize(image);
  const scale =
    scaleMode === 'fill'
      ? Math.max(width / imageWidth, height / imageHeight)
      : Math.min(width / imageWidth, height / imageHeight);

  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;
  const dx = (width - drawWidth) / 2;
  const dy = (height - drawHeight) / 2;

  ctx.drawImage(image, dx, dy, drawWidth, drawHeight);
}

function drawThemeFallbackBackground(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  colors: WaveformTheme['colors'],
): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, colors.bg);
  gradient.addColorStop(1, '#1a1d24');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawUserBackgroundLayer(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  theme: WaveformTheme,
  image: DrawableBackgroundImage,
): void {
  if (!isDrawableBackgroundReady(image)) {
    drawThemeFallbackBackground(ctx, canvas, theme.colors);
    return;
  }

  drawImageBackground({
    ctx,
    canvas,
    image,
    letterboxColor: theme.colors.bg,
    scaleMode: USER_BACKGROUND_SCALE_MODE,
  });

  const dim = USER_BACKGROUND_DIM_OVERLAY;
  if (dim > 0) {
    ctx.fillStyle = `rgba(0, 0, 0, ${dim})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

export function drawThemeBackground(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  theme: WaveformTheme,
  backgroundImage: HTMLImageElement | null,
  bokehOptions: BokehDrawOptions = {},
  userBackgroundImage: DrawableBackgroundImage | null = null,
): void {
  const { background, colors } = theme;

  if (userBackgroundImage) {
    drawUserBackgroundLayer(ctx, canvas, theme, userBackgroundImage);
    return;
  }

  switch (background.type) {
    case 'solid': {
      ctx.fillStyle = typeof background.value === 'string' ? background.value : colors.bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      break;
    }
    case 'gradient': {
      if (!Array.isArray(background.value) || background.value.length === 0) {
        ctx.fillStyle = colors.bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        break;
      }
      const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
      for (const stop of background.value) {
        gradient.addColorStop(stop.offset, stop.color);
      }
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      break;
    }
    case 'image': {
      const key = typeof background.value === 'string' ? background.value : '';
      if (backgroundImage?.complete && backgroundImage.naturalWidth > 0) {
        drawImageBackground({
          ctx,
          canvas,
          image: backgroundImage,
          letterboxColor: colors.bg,
          scaleMode: background.scaleMode ?? 'fit',
        });
      } else {
        // Fallback while image loads or on failure — matches MVP gradient.
        drawThemeFallbackBackground(ctx, canvas, colors);
      }

      const dim = background.imageDimOverlay ?? 0;
      if (dim > 0) {
        ctx.fillStyle = `rgba(0, 0, 0, ${dim})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      break;
    }
    case 'bokeh': {
      const style = resolveBokehStyle(background);
      if (style) {
        drawBokehBackground(ctx, canvas, style, bokehOptions);
      } else {
        ctx.fillStyle = colors.bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      break;
    }
    default:
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

export function backgroundNeedsImage(background: ThemeBackground): boolean {
  return background.type === 'image' && typeof background.value === 'string';
}