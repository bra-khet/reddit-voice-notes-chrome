# Release notes — v5.3.7 **Editor Intelligence (Phase 1)**

**Tag:** `v5.3.7` · **Date:** 2026-07-04  
**Branch:** `main` (merged `feature/v5.3.6-smart-split-refactor`)  
**Restore:** `git checkout v5.3.7 && npm install && npm run dev`  
**Prior stable:** `v5.3.6-split-adjust` (Smart Split 1.5× relaxation baseline on `main`)  
**Roadmap:** `docs/5.3.6-5.3.9-integrated-roadmap.md`

## Summary

The subtitle transcript editor now **measures cues against the real bake canvas** (640×360) and offers **Smart Adjust** — including a recommended **Auto-fix** full re-splice from the Vosk original. Overflow detection uses the centered **backdrop plate vs frame edge**, not the old preview-scale heuristic.

Also rolls up post–v5.3.6 fixes already on `main`: **BUG-036** overlay A/V drift, **24px font headroom**, and Smart Split **bake ink word budget** (fixes over-split at large fonts).

## Highlights

| Feature | Detail |
|---------|--------|
| **LONG badge / fit status** | `Fits comfortably` / `Near edge (Npx margin)` / `Needs fix (+Npx past edge)` — canvas authority |
| **Validate all cues** | On-demand full-canvas pass; auto-runs when font size changes in the modal |
| **Smart Adjust** | Auto-fix re-splice (recommended) + word-shift + global font −1px |
| **Attention affordance** | Amber glowing Smart Adjust button + “Auto-fix recommended” hint when cues overflow |
| **Smart Split budget** | Word grouping uses `bakeSafeInkMaxWidth` (~608px) — longer natural cues at 24–36px font |

## Restore / test

```bash
git checkout v5.3.7 && npm install && npm run dev
node scripts/test-smart-split.mjs
node scripts/test-cue-measurement.mjs
node scripts/test-transcript-edit-diff.mjs
node scripts/test-smart-adjust.mjs
npm run build
```

Manual QA: Design Studio → Subtitles → Edit transcript → Validate all / Smart Adjust → Auto-fix on a dense clip; change font slider with modal open (auto-validates).

## Deferred

Smart Adjust rich visual UI (before/after preview, proposal ranking polish) → `docs/future-ideas.md`.