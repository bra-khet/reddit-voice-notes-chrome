# Release notes — v5.3.8 **Oklch Perceptual Hue Rotation (Phase 2)**

**Tag:** `v5.3.8` · **Date:** 2026-07-04  
**Branch:** `main` (merged `feature/v5.3.8-oklch-rainbow`)  
**Restore:** `git checkout v5.3.8 && npm install && npm run dev`  
**Prior stable:** `v5.3.7` (Editor Intelligence)  
**Roadmap:** `docs/5.3.6-5.3.9-integrated-roadmap.md`

## Summary

Animated subtitle glow effects (rainbow hue-rotate and monochromatic pulse) now rotate through **Oklch** — a perceptually uniform color space — instead of HSV/sRGB hue. This removes the uneven “jumping” that previously required **32 phase buckets** to mask. Phase buckets drop to **24**, cutting cache churn and bake time with negligible visual regression.

**User QA (2026-07):** Perceptually smooth rotation confirmed; quality loss from fewer buckets barely noticeable. Typical rich-effects bake **~45 s** vs prior **60+ s** experience.

## Highlights

| Change | Detail |
|--------|--------|
| **Oklch color math** | New `src/utils/oklch.ts` — sRGB ↔ Oklch conversion, `oklchRainbowHex`, `oklchMonochromaticGlowHex` |
| **Glow hue paths** | `resolveCanvasOverlayRainbowGlowHex()` in `subtitle-effects.ts` — rainbow + monochromatic branches |
| **Phase buckets** | `CUE_OVERLAY_CACHE_PHASE_BUCKETS` **32 → 24** — aligns with 24/30 fps; fewer unique cache keys per animated cue |
| **Architecture** | `docs/transcription-architecture.md` — Oklch rationale documented |

## Restore / test

```bash
git checkout v5.3.8 && npm install && npm run dev
node scripts/test-oklch.mjs
node scripts/test-cue-cache.mjs
node scripts/test-overlay-frame-pacing.mjs
npm run build
```

Manual QA: Design Studio → Subtitles → Overlay Lab (or bake) with rainbow + monochromatic hue-rotate glow; confirm smooth even rotation.

## Next

**v5.3.9** — Web Worker render loop + temporal chunking (`docs/5.3.9-worker-and-chunked-parallelization-design.md`).