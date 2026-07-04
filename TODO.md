# TODO

## v5.3.9 — Parallel Chunked Bake (Phase 3) — **IMPLEMENTED, pending QA + merge**

**Branch:** `feature/v5.3.9-parallelization` (2026-07-04)  
**Design:** [`docs/5.3.9-worker-and-chunked-parallelization-design.md`](docs/5.3.9-worker-and-chunked-parallelization-design.md) — **§0 As-Built Revision** (workers cut: pacing-bound, not paint-bound)  
**Roadmap:** [`docs/5.3.6-5.3.9-integrated-roadmap.md`](docs/5.3.6-5.3.9-integrated-roadmap.md) § Phase 3 · **Release notes (draft):** [`docs/release-notes-v5.3.9.md`](docs/release-notes-v5.3.9.md)

| Deliverable | Status |
|-------------|--------|
| ~~Worker pool + offscreen MediaRecorder split~~ → concurrent paced captures in Studio page | **done** (revised — design doc §0.1) |
| Temporal chunking (cue-gap boundaries) + one-pass FFmpeg trim/concat/yuva420p | **done** — replaces alpha-normalize on parallel path |
| Feature flag for first ship | **done** — `experimental.parallelBake` (default on, auto-gated ≥20 s / cores / memory; serial + drawtext fallback chain) |
| Tests | **done** — `test-chunk-planner.mjs` (13), `test-overlay-concat-args.mjs` (5); full suite + `npm run build` green |
| **User QA** (Overlay Lab parallel A/B + real ≥30 s bake, seam scrub) | **pending** |
| Merge → `main`, tag `v5.3.9` | **pending QA** |

```bash
node scripts/test-chunk-planner.mjs
node scripts/test-overlay-concat-args.mjs
```

Overlay Lab → "Parallel chunked render (v5.3.9)" toggle → long segment set → compare timing JSON `render.realtimeFactor` vs serial; scrub seams at `parallel-plan` startFrames / 30 s.

## v5.3.8 — Oklch Perceptual Hue Rotation (Phase 2) — **MERGED & TAGGED**

**Tag:** `v5.3.8` on `main` · **Release notes:** [`docs/release-notes-v5.3.8.md`](docs/release-notes-v5.3.8.md)  
**Branch:** merged `feature/v5.3.8-oklch-rainbow` (2026-07-04)  
**Push:** deferred (local tag + merge only)

| Deliverable | Status |
|-------------|--------|
| Oklch ↔ sRGB conversion module + tests | **done** |
| Rainbow / monochromatic hue paths → Oklch rotation | **done** |
| Phase buckets 32 → 24 | **done** |
| Visual QA on animated effects | **done**, QA pass — smooth rotation; ~45 s bake vs 60+ s prior |

## v5.3.7 — Editor Intelligence (Phase 1) — **MERGED & TAGGED**

**Tag:** `v5.3.7` · **Release notes:** [`docs/release-notes-v5.3.7.md`](docs/release-notes-v5.3.7.md)

## v5.3.6 — Smart Split relaxation — **TAGGED** (`v5.3.6`)

**Release notes:** [`docs/release-notes-v5.3.6.md`](docs/release-notes-v5.3.6.md)

## v5.3.5 — Cue-stable overlay caching — **COMPLETE**

**Tag:** `v5.3.5` (push deferred) · [`docs/5.3.5-cue-stable-overlay-caching-design.md`](docs/5.3.5-cue-stable-overlay-caching-design.md)

## v5.3.4 — Subtitle canvas overlay — **COMPLETE**

**Tag:** `v5.3.4` · [`docs/v5.3.4-subtitle-canvas-overlay.md`](docs/v5.3.4-subtitle-canvas-overlay.md)

### Restore / test (v5.3.8)

```bash
git checkout v5.3.8 && npm install && npm run dev
node scripts/test-oklch.mjs
node scripts/test-cue-cache.mjs
node scripts/test-smart-split.mjs
node scripts/test-cue-measurement.mjs
node scripts/test-transcript-edit-diff.mjs
node scripts/test-smart-adjust.mjs
node scripts/test-overlay-frame-pacing.mjs
```

**Next push when ready:** `git push origin main --tags`

Design Studio → Subtitles → Overlay Lab — rainbow / monochromatic hue-rotate for visual check.