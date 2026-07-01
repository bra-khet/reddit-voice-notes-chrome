/**
 * Loads the DejaVu TTF assets used by the bake pipeline into the browser's font registry
 * so the subtitle preview canvas can render the exact same glyphs that FFmpeg + FreeType burn in.
 *
 * Family names are prefixed with 'RVN-' to avoid collisions with system fonts.
 * Implementation lives in subtitle-overlay-fonts.ts (v5.3.4 single source of truth).
 */

export {
  OVERLAY_FONT_FAMILY_FOR_KEY as PREVIEW_FAMILY_FOR_KEY,
  loadSubtitleOverlayFonts as loadDejaVuPreviewFonts,
} from '@/src/transcription/subtitle-overlay-fonts';
