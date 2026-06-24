/**
 * Loads the DejaVu TTF assets used by the bake pipeline into the browser's font registry
 * so the subtitle preview canvas can render the exact same glyphs that FFmpeg + FreeType burn in.
 *
 * Family names are prefixed with 'RVN-' to avoid collisions with system fonts.
 * These names are shared with subtitle-preview.ts via PREVIEW_FAMILY_FOR_KEY.
 */

export const PREVIEW_FAMILY_FOR_KEY: Readonly<Record<string, string>> = {
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
  try {
    const url = browser.runtime.getURL(assetPath as never);
    const face = new FontFace(family, `url("${url}")`);
    await face.load();
    document.fonts.add(face);
  } catch (err) {
    // Non-fatal: canvas preview falls back to browser default for this face.
    console.warn(`[RVN] Preview font load failed: ${family}`, err);
  }
}

/** Idempotent — safe to call multiple times; resolves when all four faces are attempted. */
export function loadDejaVuPreviewFonts(): Promise<void> {
  if (!loadPromise) {
    loadPromise = Promise.all(
      Object.entries(ASSET_FOR_FAMILY).map(([family, asset]) => loadOneFont(family, asset)),
    ).then(() => undefined);
  }
  return loadPromise;
}
