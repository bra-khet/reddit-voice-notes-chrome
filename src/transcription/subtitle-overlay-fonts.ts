/**
 * v5.3.4 — DejaVu font loading for canvas overlay capture (bake parity).
 *
 * Sync points:
 * - Asset paths: subtitle-burnin.ts FONT_ASSETS / BURNIN_FONT_ASSET
 * - Family keys: subtitle-controls.ts FONT_FAMILY_OPTIONS
 * - Preview re-exports: preview-font-loader.ts PREVIEW_FAMILY_FOR_KEY
 */

export const OVERLAY_FONT_FAMILY_FOR_KEY: Readonly<Record<string, string>> = {
  'dejavu-sans': 'RVN-DejaVu-Sans',
  'dejavu-serif': 'RVN-DejaVu-Serif',
  'dejavu-mono': 'RVN-DejaVu-Mono',
  'dejavu-bold': 'RVN-DejaVu-Bold',
};

const ASSET_FOR_FAMILY: Readonly<Record<string, string>> = {
  'RVN-DejaVu-Sans': 'assets/fonts/DejaVuSans.ttf',
  'RVN-DejaVu-Serif': 'assets/fonts/DejaVuSerif.ttf',
  'RVN-DejaVu-Mono': 'assets/fonts/DejaVuSansMono.ttf',
  'RVN-DejaVu-Bold': 'assets/fonts/DejaVuSansCondensedBold.ttf',
};

let loadPromise: Promise<void> | null = null;

async function loadOneFont(family: string, assetPath: string): Promise<void> {
  if (typeof document === 'undefined') return;
  try {
    const url = browser.runtime.getURL(assetPath as never);
    const face = new FontFace(family, `url("${url}")`);
    await face.load();
    document.fonts.add(face);
  } catch (err) {
    console.warn(`[RVN] Subtitle overlay font load failed: ${family}`, err);
  }
}

/** Idempotent — must complete before the first overlay paint pass. */
export function loadSubtitleOverlayFonts(): Promise<void> {
  if (typeof document === 'undefined') {
    return Promise.resolve();
  }
  if (!loadPromise) {
    loadPromise = Promise.all(
      Object.entries(ASSET_FOR_FAMILY).map(([family, asset]) => loadOneFont(family, asset)),
    ).then(() => undefined);
  }
  return loadPromise;
}

export function overlayCssFontFamily(key: string | undefined): string {
  return OVERLAY_FONT_FAMILY_FOR_KEY[key ?? 'dejavu-sans'] ?? 'RVN-DejaVu-Sans';
}