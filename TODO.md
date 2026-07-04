# TODO

## v5.3.9 — Worker Render Loop + Temporal Chunking (Phase 3) — **NEXT**

**Design:** [`docs/5.3.9-worker-and-chunked-parallelization-design.md`](docs/5.3.9-worker-and-chunked-parallelization-design.md)  
**Roadmap:** [`docs/5.3.6-5.3.9-integrated-roadmap.md`](docs/5.3.6-5.3.9-integrated-roadmap.md) § Phase 3

| Deliverable | Status |
|-------------|--------|
| Worker pool + offscreen MediaRecorder split | pending |
| Temporal chunking + FFmpeg concat | pending |
| Feature flag for first ship | pending |

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