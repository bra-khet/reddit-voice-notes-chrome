# Release notes — v5.3.6 **Smart Split relaxation**

**Tag:** `v5.3.6` · **Date:** 2026-07-04  
**Branch:** `main` (patch on `v5.3.5` baseline)  
**Restore:** `git checkout v5.3.6 && npm install && npm run dev`  
**Prior stable:** `v5.3.5`  
**Design + QA record:** `docs/5.3.6-smart-split-relaxation-design.md`

## Summary

**Smart Split is less aggressive.** Cues can be ~50% longer (measured caption width) before the editor shows the **⚠ LONG** badge or enables **✂ Split**. Thresholds were still calibrated for the old FFmpeg `drawtext` ~64-layer ceiling; with the v5.3.4 canvas overlay path and v5.3.5 cue caching, longer single-line cues are both supported and cheap to render.

No change to split timing math, manual split, or badge presentation — only the width budget that drives overflow detection and greedy word grouping.

## Problem this solves

On dense transcripts, Smart Split often broke cues into shorter fragments than necessary. Users reported cues that were "too short" in text length (the more common issue) and, secondarily, too brief in duration after proportional timing.

## What changed

| Area | Detail |
|------|--------|
| **Constant** | `SMART_SPLIT_WIDTH_RELAXATION = 1.5` in `src/utils/text-metrics.ts` |
| **Helper** | `smartSplitCaptionMaxWidth()` — ~381 px vs ~254 px preview-line budget at default geometry |
| **Editor** | `subtitle-segment-editor.ts` `buildCaptionMetrics()` uses relaxed width for LONG badge + Split |
| **Tests** | `scripts/test-smart-split.mjs` — borderline + regression cases |

## Restore / test

```bash
git checkout main && npm install && npm run dev
node scripts/test-smart-split.mjs
```

Manual QA: open transcript editor on a dense clip → fewer LONG badges and shorter cue lists; manual ✂ Split still works; bake with rich canvas styles unchanged.