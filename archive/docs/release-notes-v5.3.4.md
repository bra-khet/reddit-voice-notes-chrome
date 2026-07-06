# Release notes — v5.3.4 **Canvas subtitle overlay**

**Tag:** `v5.3.4` · **Date:** 2026-07-03  
**Merge:** `feature/v5.3.4-subtitle-canvas-overlay` → `main` (from `v5.3.3` baseline)  
**Checkpoint tags:** `5.3.4-phase-3.5-complete`, `5.3.4-phase-4-complete`, `5.3.4-phase-5-complete`, `5.3.4-complete`  
**Restore:** `git checkout v5.3.4 && npm install && npm run dev`  
**Prior stable:** `v5.3.3`; feature baseline `v5.3.2` (One-Time Test cold-start fix)  
**Design + plan:** `docs/v5.3.4-subtitle-canvas-overlay.md`

## Summary

**Canvas subtitle overlay** fixes the long-standing glow/border ceiling (BUG-035) that
forced FFmpeg `drawtext` to drop rich styling once a clip had more than a handful of
cues. Subtitles with halo, dual border, text gradient, gradient wave, or per-frame hue
rotate now render offline on a Canvas 2D surface, capture to a transparent WebM, and
composite onto the base MP4 with a single cheap `overlay=` filter — no per-cue layer
explosion.

Production bake in Design Studio **auto-selects** the canvas path when effects require
it or when glow is on and cue count exceeds six. The legacy drawtext degradation chain
remains the fast fallback (including when the render perf guard times out). No changes
to the live recording path; everything stays client-side.

## Problem this solves

With the pre-v5.3.4 pipeline, `MAX_BURNIN_DRAWTEXT_LAYERS = 64` capped how many glow
rings could be baked per cue. Clips with **7+ cues** and glow enabled silently degraded
to plain text. Rainbow glow, dual contrasting border, and animated gradient effects were
never viable on drawtext at all.

Canvas overlay removes the layer budget entirely: paint passes are cheap, real
`shadowBlur` and gradients are available, and the final FFmpeg graph is one overlay
input regardless of cue count.

## Highlights

### Canvas overlay bake (production)

| Area | What shipped |
|------|----------------|
| **Offline render** | `subtitle-overlay-renderer.ts` paints captions at 30 fps on an offscreen canvas, captures via `MediaRecorder`, finalizes to seekable VP8A WebM |
| **Alpha-safe composite** | `normalizeOverlayWebmForComposite()` re-encodes to `yuva420p` via wasm `libvpx` before composite — fixes opaque black matte that blocked the base video |
| **Auto strategy** | `shouldPreferCanvasOverlay()` picks canvas when rich effects are on, glow + >6 cues, or overlay bytes are supplied; drawtext tiers remain fallback |
| **Shared segment prep** | `prepareSegmentsForSubtitleBake()` — one path for drawtext and canvas (scaffold filter, timings, min cue 0.35 s, clip clamp) |
| **Chronos meter** | Amber progress bar + elapsed / ETA line during bake; smoother updates during canvas render; "Preparing overlay…" during VP8A normalize |

### Rich canvas-only effects (Phase 3.5)

| Effect | Notes |
|--------|--------|
| **Soft halo** | Integral-normalized multi-ring halo + `shadowBlur` underpass (softer than drawtext duplicate rings) |
| **Dual contrasting border** | Inner + outer stroke keyline via `resolveInnerBorderColor()`; strength follows glow opacity slider |
| **Text gradient** | Vertical highlight on caption fill (default on); drawtext compare stays flat |
| **Text gradient wave** | Slow downward sweep through the highlight (~3.5 s cycle) |
| **Hue rotate glow** | Per-frame rainbow or monochromatic rotation (~45°/s); UI label "Hue rotate" |
| **Backdrop radius** | Rounded caption plates (wired; visual QA deferred) |

New subtitle style fields: `textGradient`, `textGradientWave`, `glow.dualBorder`,
`glow.hueRotateMode`, `glow.colorSource: 'rainbow'`.

### Production safeguards

- **Render perf guard** — production bake aborts offline render past a 2.5–3 min budget
  and falls back to drawtext (`canvas-render-perf-guard.ts`). Dev / Overlay Lab omit
  the budget.
- **Finalize timeout** — VP8A normalize capped at 6 min (`FINALIZE_TIMEOUT_MS`).
- **User hint** — bake panel notes that longer clips with rich effects may take several
  minutes; progress updates below.

### Subtitle Overlay Lab (QA harness)

Persistent gated panel in Design Studio Subtitles (DEV builds always on; production via
`localStorage.setItem('rvn:subtitle-overlay-lab', '1')`):

- Synthetic segment sets: short (3 cues / 10 s), medium (8 / 30 s), long (16 / 60 s), or session transcript
- Lab effect toggles, backdrop radius slider, inner-border color preview
- Render overlay · compare drawtext vs canvas · full canvas bake
- Downloads: `overlay.webm`, `drawtext-compare.mp4`, `final.mp4`, JSON timing log

## Architecture

```
prepareSegmentsForSubtitleBake()
  → renderSubtitleOverlay()          [Design Studio tab — Canvas + MediaRecorder]
  → normalizeOverlayWebmForComposite() [libvpx yuva420p pre-pass]
  → runSubtitleBurnIn(overlay bytes)   [single overlay=0:0 composite]
```

Drawtext path unchanged for plain styles and as fallback. See
`docs/transcription-architecture.md` § Canvas overlay path.

## Performance — observed, acceptable (caveat)

Full canvas bake wall time scales with **clip duration**; the **prepare overlay**
(VP8A normalize) phase dominates on long or effect-heavy clips — not the canvas paint
loop alone.

| Clip | Cues | Render | Prepare overlay | Composite | Total |
|------|------|--------|-----------------|-----------|-------|
| ~11 s | 3 | ~13 s | — | — | render-only QA |
| 62 s | 21–534 | ~68–82 s | — | — | ~1.1–1.3× realtime |
| 62 s | 534 + rich | 76 s (27%) | **184 s (64%)** | 25 s (9%) | **~4.8 min** |
| 60 s | 20 + rich | ~65 s | ~120–165 s | ~20 s | ~3.5 min |
| 120 s | 121 + rich | ~120 s | ~330 s | ~50 s | **~8+ min** |

**Takeaways**

- Render tracks clip length ~1:1 (~40 ms/frame @ 30 fps); cue count is secondary on a
  fixed-duration clip.
- Rich effects inflate normalize time more than render time.
- Perf guard covers **render only**; normalize relies on the 6 min timeout.
- Deep optimization deferred → `docs/future-ideas.md` § Canvas Subtitle Bake Performance.

Bakes complete successfully; users should expect multi-minute waits on 60–120 s clips
with glow, gradient wave, and dual border enabled.

## Notes / known follow-ups

- **Performance:** skip or fast-path VP8A normalize is the largest future win; adaptive
  overlay fps second. Not in scope for v5.3.4.
- **Overlay Lab:** dev/QA tooling — not end-user facing unless the localStorage flag is set.
- **Drawtext compare:** side-by-side harness shows drawtext as flat fallback; rich effects
  are intentionally canvas-only.
- **3.5.4 backdrop rounding:** deferred visual QA pass; `borderRadius` already wired.
- **Live preview:** canvas-rendered subtitles in the recorder preview are a future phase
  (see design doc "Next Steps After v5.3.4").

## Verification

Automated (esbuild bundle + `node:assert`): `test-burnin-budget`, `test-bake-segments`,
`test-bake-chronos`, `test-canvas-render-perf-guard`, `test-overlay-lab-segments`;
`npm run build` clean.

Manual QA: Overlay Lab timing logs and stress trials through **534 cues / 62 s** full
bake with rich effects; compare harness; production bake chronos; drawtext fallback path
exercised via perf guard design.

## Key files

- **New:** `subtitle-overlay-renderer.ts`, `subtitle-overlay-fonts.ts`,
  `overlay-webm-finalize.ts`, `subtitle-canvas-bake.ts`, `subtitle-overlay-compare.ts`,
  `subtitle-overlay-lab.ts`, `subtitle-overlay-lab-segments.ts`, `bake-chronos.ts`,
  `canvas-render-perf-guard.ts`, test scripts above, `docs/v5.3.4-subtitle-canvas-overlay.md`,
  this file.
- **Changed:** `subtitle-burnin.ts`, `subtitle-effects.ts`, `subtitle-bake.ts`,
  `subtitle-controls.ts`, `transcript-editing.ts`, `types.ts`, `ffmpeg-runner.ts`,
  `entrypoints/design-studio/style.css`, `docs/transcription-architecture.md`,
  `docs/future-ideas.md`.