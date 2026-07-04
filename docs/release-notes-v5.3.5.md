# Release notes — v5.3.5 **Cue-stable overlay caching**

**Tag:** `v5.3.5` · **Date:** 2026-07-04  
**Merge:** `feature/v5.3.5-cue-stable-overlay-caching` → `main` (from `v5.3.4` baseline)  
**Restore:** `git checkout v5.3.5 && npm install && npm run dev`  
**Prior stable:** `v5.3.4`  
**Design + QA record:** `docs/5.3.5-cue-stable-overlay-caching-design.md`

## Summary

**Cue-stable overlay caching** avoids re-running the expensive canvas `paintCue` stack on every frame when the active cue and animation phase are unchanged. Each distinct (cue, style, phase) graphic is painted once into an `ImageBitmap`, then reused via fast `drawImage` blits for subsequent frames.

Caching is **on by default** for production and Overlay Lab bakes. It improves cue-count scaling on typical transcripts and keeps rich canvas effects viable without multiplying per-frame paint cost. **Full bake wall time is largely unchanged** on sparse clips because VP8A normalize still dominates; render-only work on typical session transcripts stays near the MediaRecorder pacing floor (~1.1× realtime).

Deferred to later phases: burst capture / worker chunking (v5.3.7), smart-split relaxation pairing (v5.3.6), larger LRU for heavy animated styles.

## Problem this solves

On v5.3.4, every overlay frame re-executed glow, gradient, clipping, and font metrics even when the same cue was on screen for seconds. Dense transcripts (hundreds of cues on a ~60 s clip) pushed render from ~1.1× to ~1.3× realtime. Rich animated effects (gradient wave + hue rotate) multiplied unique paint states per cue.

Caching collapses per-frame paint to one snapshot per cache key, with LRU reuse across frames.

## Highlights

### Cue overlay cache (production)

| Area | What shipped |
|------|----------------|
| **Cache module** | `subtitle-overlay-cue-cache.ts` — stable keys, 32 phase buckets, 64-entry LRU |
| **Renderer integration** | `paintCueWithCache()` in `subtitle-overlay-renderer.ts`; bypassed in `singleFrameDebug` |
| **Metrics** | `SubtitleOverlayRenderMetrics` on `SubtitleOverlayResult.renderMetrics` |
| **Default** | `enableCueCache` true; `enableCueCache: false` to disable |

### Cache key design

```
{cueStart}|{cueEnd}|{cueText}|{styleHash}|phase:{wN,hM}
```

- Static cues: single `phase:0` bucket
- Gradient wave + hue rotate: quantized into **32 buckets** per cycle (visual QA tuned from 16)

### Overlay Lab timing JSON v2

Harness downloads now include `version: 2` logs with pre-computed `summary` (render realtime factor, stage shares, cache hit rate, evictions). Modules: `overlay-lab-timing-summary.ts`, wired in `subtitle-overlay-lab.ts`.

### Tests

- `scripts/test-cue-cache.mjs` — cache keys + phase bucketing
- `scripts/test-overlay-lab-timing-summary.mjs` — stage breakdown builder

## Performance — observed (Overlay Lab QA)

Session transcript ~62 s, Design Studio Overlay Lab. Full tables: design doc §5.

| Profile | Cues | Render RT | Cache hit rate | Notes |
|---------|------|-----------|----------------|-------|
| Light / sparse | 21 | **~1.10×** | **99%** | At MediaRecorder pacing floor; 0 evictions |
| Rich / sparse | 21 | ~1.36× | 62% | LRU cap saturates with wave+hue keys |
| Light / medium | 294 | ~1.30× | 91% | Matches v5.3.4 dense plain render |
| Rich / dense | 882 | ~1.62× | 56% | Heavy LRU churn |
| Full bake sparse | 21 | total ~155 s | 99% / 62% | Normalize ~47–49% of wall time |

**Takeaways**

- Typical sparse transcripts: caching works as intended; users see stable render times.
- Rich animated styles: acceptable visuals at 32 phase buckets; slight stepping on wave/hue vs per-frame paint.
- **64-entry LRU** is the bottleneck for animated + dense cues — evictions can erase render gains.
- **Total bake** still multi-minute on long rich clips — normalize/composite unchanged; see `docs/future-ideas.md`.

## Visual parity

- Static / light effects: indistinguishable from v5.3.4.
- Rich animated effects: only delta is quantized wave/hue stepping (32 buckets judged acceptable in QA).

## Architecture

```
paintFrame()
  → cuesAtTimestamp()
  → paintCueWithCache() per active cue
       hit  → drawImage(cached ImageBitmap)
       miss → paintCue on temp canvas → createImageBitmap → LRU store
```

See `docs/transcription-architecture.md` § Cue-stable overlay caching.

## Notes / known follow-ups

- **Render speed floor:** `waitForNextCaptureTick` keeps sparse renders ~1× realtime regardless of cache — v5.3.7 worker/chunking target.
- **LRU cap:** 64 entries may thrash on rich animated dense transcripts — consider raising in a future patch.
- **VP8A normalize:** still largest bake cost — unchanged since v5.3.4.
- **v5.3.6:** Smart Split relaxation — pair with cache/LRU awareness.
- **v5.3.7:** Worker + temporal chunking per design docs.

## Verification

Automated: `test-cue-cache`, `test-overlay-lab-timing-summary`, `test-canvas-render-perf-guard`, `test-bake-chronos`; `npm run build` clean.

Manual QA: Overlay Lab trials in `.ignore/sub-QA-harness-logs-5.3.5b-light` and `…-5.3.5b-heavy` (timing JSON v2).

## Key files

- **New:** `subtitle-overlay-cue-cache.ts`, `overlay-lab-timing-summary.ts`, `test-cue-cache.mjs`, `test-overlay-lab-timing-summary.mjs`, this file.
- **Changed:** `subtitle-overlay-renderer.ts`, `subtitle-overlay-lab.ts`, `subtitle-canvas-bake.ts`, `docs/transcription-architecture.md`, `docs/5.3.5-cue-stable-overlay-caching-design.md`.