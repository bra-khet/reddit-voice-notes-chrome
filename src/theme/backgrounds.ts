import {
  EMPTY_AUDIO_VIZ_FRAME,
  renderAudioVisualForCanvas,
  type AudioVizFrame,
  type VisualizerParams,
} from './audio-reactive';
import {
  drawBokehBackdrop,
  registerCoreOverlayVisuals,
} from './audio-reactive/overlays';
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

// CHANGED: Sparkle and Bubbles are registry-native built-ins, not hard-coded draw branches.
// WHY: every current and future overlay must use the same per-canvas lifecycle and parameter seam.
registerCoreOverlayVisuals();

const MIDNIGHT_BOKEH_PARAMS: Partial<VisualizerParams> = Object.freeze({
  sensitivity: 0.62,
  intensity: 0.78,
  smoothing: 0.8,
  density: 0.62,
  color: ['#67e8f9', '#818cf8', '#c084fc'],
});

export { DEFAULT_USER_BACKGROUND_LAYOUT, normalizeUserBackgroundLayout } from './background-layout';
export type { UserBackgroundLayout } from './types';

/** Bundled static backgrounds under `public/assets/backgrounds/`. */
export const BACKGROUND_ASSETS = {
  aurora: 'assets/backgrounds/aurora.svg',
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
  audioFrame: AudioVizFrame,
  layout: UserBackgroundLayout,
): void {
  if (!isDrawableBackgroundReady(image)) {
    drawThemeFallbackBackground(ctx, canvas, theme.colors);
    return;
  }

  if (layout.scaleMode === 'fit') {
    drawBundledThemeBackground(ctx, canvas, theme, bundledBackgroundImage, audioFrame);
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
  audioFrame: AudioVizFrame,
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
      drawBokehBackdrop(ctx, canvas, colors.bg);
      renderAudioVisualForCanvas(
        'overlay',
        'bokeh',
        ctx,
        canvas,
        audioFrame,
        MIDNIGHT_BOKEH_PARAMS,
      );
      break;
    }
    default:
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

function drawBokehThemeOverlay(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  background: ThemeBackground,
  audioFrame: AudioVizFrame,
): void {
  if (background.type !== 'bokeh') return;
  renderAudioVisualForCanvas(
    'overlay',
    'bokeh',
    ctx,
    canvas,
    audioFrame,
    MIDNIGHT_BOKEH_PARAMS,
  );
}

export function drawThemeBackground(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  theme: WaveformTheme,
  backgroundImage: HTMLImageElement | null,
  audioFrame: AudioVizFrame = EMPTY_AUDIO_VIZ_FRAME,
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
      audioFrame,
      layout,
    );
    // BUG FIX: Midnight Bokeh missing over personal backgrounds (fill mode)
    // Fix: Preset bokeh draws as orb overlay when fill mode replaces the dark bokeh base
    // Sync: skip when fit mode — letterbox already shows the full preset backdrop
    if (layout.scaleMode === 'fill') {
      drawBokehThemeOverlay(ctx, canvas, theme.background, audioFrame);
    }
  } else {
    drawBundledThemeBackground(ctx, canvas, theme, backgroundImage, audioFrame);
  }

  // CHANGED: one normalized frame now crosses the background + overlay draw seam.
  // WHY: v6 presets need bands without splitting Studio preview from captured output.
  drawDesignEffectOverlays(ctx, canvas, theme, audioFrame);
}

function drawDesignEffectOverlays(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  theme: WaveformTheme,
  audioFrame: AudioVizFrame,
): void {
  const effects = theme.designEffects;
  const overlay = effects?.overlayPreset !== undefined
    ? effects.overlayPreset
    : effects?.backgroundOverlay;
  if (!overlay) return;

  const stripAlpha = (color: string): string => color.length === 9 ? color.slice(0, 7) : color;
  const fallbackPalette = [stripAlpha(theme.colors.bar), stripAlpha(theme.colors.glow)];
  renderAudioVisualForCanvas('overlay', overlay, ctx, canvas, audioFrame, {
    ...effects?.visualizerParams,
    color: effects?.visualizerParams?.color ?? fallbackPalette,
  });
}

export function backgroundNeedsImage(background: ThemeBackground): boolean {
  return background.type === 'image' && typeof background.value === 'string';
}

export function backgroundIsBokeh(background: ThemeBackground): boolean {
  return background.type === 'bokeh';
}
