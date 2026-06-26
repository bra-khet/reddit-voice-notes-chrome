import {
  buildPresetBokehOverlayStyle,
  buildTintedBokehOverlayStyle,
  drawBokehBackground,
  drawBokehOverlay,
  resolveBokehStyle,
  type BokehDrawOptions,
} from './bokeh';
import { drawSparkleOverlay } from './sparkle';
import {
  type DrawableBackgroundImage,
  getDrawableBackgroundSize,
  isDrawableBackgroundReady,
  loadAnimatedBackground,
  loadBackgroundImageElement,
} from '@/src/storage/background-loader';
import type { AnimatedBackground } from '@/src/storage/animated-background';
import { normalizeBackgroundAssetId } from '@/src/storage/image-db';
import { USER_BACKGROUND_DIM_OVERLAY } from '@/src/storage/image-db-types';
import {
  computeImageDrawOffset,
  DEFAULT_USER_BACKGROUND_LAYOUT,
  normalizeUserBackgroundLayout,
} from './background-layout';
import type {
  BackgroundScaleMode,
  ThemeBackground,
  UserBackgroundLayout,
  WaveformTheme,
} from './types';

export { DEFAULT_USER_BACKGROUND_LAYOUT, normalizeUserBackgroundLayout } from './background-layout';
export type { UserBackgroundLayout } from './types';

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
  /** Set only when the personal background is an animated GIF with real motion (>1 frame). */
  userAnimatedBackground: AnimatedBackground | null;
  bundledBackgroundImage: HTMLImageElement | null;
}

/** Resolve personal ImageDB background and bundled theme assets (pretty-7b / pretty-8 fit mode). */
export async function resolveClipBackgrounds(
  theme: WaveformTheme,
  customBackgroundId: string | null | undefined,
): Promise<ResolvedClipBackgrounds> {
  const normalizedId = normalizeBackgroundAssetId(customBackgroundId);
  let userBackgroundImage: DrawableBackgroundImage | null = null;
  let userAnimatedBackground: AnimatedBackground | null = null;
  if (normalizedId) {
    // CHANGED: resolve animated GIFs to a frame controller; static assets unchanged.
    // WHY: animated branch Phase 2 — looping happens on the canvas (preview = recorder = MP4).
    // loadAnimatedBackground returns a controller only for GIFs with real motion; everything
    // else (static images, single-frame or undecodable GIFs) falls through to the static path.
    const animated = await loadAnimatedBackground(normalizedId);
    if (animated) {
      userAnimatedBackground = animated;
      userBackgroundImage = animated.firstFrame();
    } else {
      userBackgroundImage = await loadUserBackgroundImage(normalizedId);
    }
  }

  let bundledBackgroundImage: HTMLImageElement | null = null;
  if (backgroundNeedsImage(theme.background) && typeof theme.background.value === 'string') {
    bundledBackgroundImage = await loadBackgroundImage(theme.background.value);
  }

  return { userBackgroundImage, userAnimatedBackground, bundledBackgroundImage };
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
  layout: UserBackgroundLayout;
  /** When true, theme backdrop is already drawn — only place the image (fit mode). */
  skipLetterboxFill?: boolean;
}

function drawImageBackground({
  ctx,
  canvas,
  image,
  letterboxColor,
  scaleMode,
  layout,
  skipLetterboxFill = false,
}: DrawImageBackgroundOptions): void {
  const { width, height } = canvas;
  if (!skipLetterboxFill) {
    ctx.fillStyle = letterboxColor;
    ctx.fillRect(0, 0, width, height);
  }

  const { width: imageWidth, height: imageHeight } = getDrawableBackgroundSize(image);
  const scale =
    scaleMode === 'fill'
      ? Math.max(width / imageWidth, height / imageHeight)
      : Math.min(width / imageWidth, height / imageHeight);

  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;
  const { dx, dy } = computeImageDrawOffset(
    width,
    height,
    drawWidth,
    drawHeight,
    layout.position,
  );

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
  bundledBackgroundImage: HTMLImageElement | null,
  bokehOptions: BokehDrawOptions,
  layout: UserBackgroundLayout,
): void {
  if (!isDrawableBackgroundReady(image)) {
    drawThemeFallbackBackground(ctx, canvas, theme.colors);
    return;
  }

  if (layout.scaleMode === 'fit') {
    drawBundledThemeBackground(ctx, canvas, theme, bundledBackgroundImage, bokehOptions);
    drawImageBackground({
      ctx,
      canvas,
      image,
      letterboxColor: theme.colors.bg,
      scaleMode: 'fit',
      layout,
      skipLetterboxFill: true,
    });
  } else {
    drawImageBackground({
      ctx,
      canvas,
      image,
      letterboxColor: theme.colors.bg,
      scaleMode: 'fill',
      layout,
    });
  }

  const dim = USER_BACKGROUND_DIM_OVERLAY;
  if (dim > 0) {
    ctx.fillStyle = `rgba(0, 0, 0, ${dim})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

function drawBundledThemeBackground(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  theme: WaveformTheme,
  backgroundImage: HTMLImageElement | null,
  bokehOptions: BokehDrawOptions,
): void {
  const { background, colors } = theme;

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
          layout: DEFAULT_USER_BACKGROUND_LAYOUT,
        });
      } else {
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

function drawPresetBokehOverlay(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  background: ThemeBackground,
  bokehOptions: BokehDrawOptions,
): void {
  if (background.type !== 'bokeh' || typeof background.value !== 'string') return;
  const style = buildPresetBokehOverlayStyle(background.value);
  if (!style) return;
  drawBokehOverlay(ctx, canvas, style, bokehOptions, 'screen', false);
}

export function drawThemeBackground(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  theme: WaveformTheme,
  backgroundImage: HTMLImageElement | null,
  bokehOptions: BokehDrawOptions = {},
  userBackgroundImage: DrawableBackgroundImage | null = null,
  userLayout: UserBackgroundLayout = DEFAULT_USER_BACKGROUND_LAYOUT,
): void {
  const layout = normalizeUserBackgroundLayout(userLayout);

  if (userBackgroundImage) {
    drawUserBackgroundLayer(
      ctx,
      canvas,
      theme,
      userBackgroundImage,
      backgroundImage,
      bokehOptions,
      layout,
    );
    // BUG FIX: Midnight Bokeh missing over personal backgrounds (fill mode)
    // Fix: Preset bokeh draws as orb overlay when fill mode replaces the dark bokeh base
    // Sync: skip when fit mode — letterbox already shows the full preset backdrop
    if (layout.scaleMode === 'fill') {
      drawPresetBokehOverlay(ctx, canvas, theme.background, bokehOptions);
    }
  } else {
    drawBundledThemeBackground(ctx, canvas, theme, backgroundImage, bokehOptions);
  }

  drawDesignEffectOverlays(ctx, canvas, theme, bokehOptions);
}

function drawDesignEffectOverlays(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  theme: WaveformTheme,
  bokehOptions: BokehDrawOptions,
): void {
  const overlay = theme.designEffects?.backgroundOverlay;
  if (!overlay) return;

  if (overlay === 'bokeh') {
    const style = buildTintedBokehOverlayStyle(theme.colors.bar);
    drawBokehOverlay(ctx, canvas, style, bokehOptions, 'screen', true);
    return;
  }

  if (overlay === 'sparkle') {
    drawSparkleOverlay(ctx, canvas, theme.colors.bar, theme.colors.glow, bokehOptions);
  }
}

export function backgroundNeedsImage(background: ThemeBackground): boolean {
  return background.type === 'image' && typeof background.value === 'string';
}