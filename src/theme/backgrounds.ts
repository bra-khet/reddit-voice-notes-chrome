import {
  drawBokehBackground,
  resolveBokehStyle,
  type BokehDrawOptions,
} from './bokeh';
import type { BackgroundScaleMode, ThemeBackground, WaveformTheme } from './types';

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
  return browser.runtime.getURL(path as never);
}

export function isBackgroundAssetKey(value: string): value is BackgroundAssetKey {
  return value in BACKGROUND_ASSETS;
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
  image: HTMLImageElement;
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

  const scale =
    scaleMode === 'fill'
      ? Math.max(width / image.naturalWidth, height / image.naturalHeight)
      : Math.min(width / image.naturalWidth, height / image.naturalHeight);

  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const dx = (width - drawWidth) / 2;
  const dy = (height - drawHeight) / 2;

  ctx.drawImage(image, dx, dy, drawWidth, drawHeight);
}

export function drawThemeBackground(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  theme: WaveformTheme,
  backgroundImage: HTMLImageElement | null,
  bokehOptions: BokehDrawOptions = {},
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
        });
      } else {
        // Fallback while image loads or on failure — matches MVP gradient.
        const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
        gradient.addColorStop(0, colors.bg);
        gradient.addColorStop(1, '#1a1d24');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
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