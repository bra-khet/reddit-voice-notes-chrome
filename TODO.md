# TODO

## v5.3.6+ — Smart Split + overlay fixes (on `main`, next tag)

**Smart Split:** `SMART_SPLIT_WIDTH_RELAXATION = 1.5` + font headroom above 22px (`SMART_SPLIT_REFERENCE_FONT_SIZE`).  
**BUG-036:** cue-cache overlay A/V drift — **fixed** (user QA pass).  
**Docs:** [`docs/5.3.6-smart-split-relaxation-design.md`](docs/5.3.6-smart-split-relaxation-design.md), [`docs/bug-archive.md`](docs/bug-archive.md) BUG-036

Roll into next tag (not a separate v5.3.6 patch).

**Phase 1 in progress** on `feature/v5.3.6-smart-split-refactor` — see [`docs/5.3.6-5.3.8-integrated-roadmap.md`](docs/5.3.6-5.3.8-integrated-roadmap.md).

| Step | Status |
|------|--------|
| `measureCueRenderedSize()` export | **done** |
| Two-tier heuristic filter constants | **done** |
| `transcript-edit-diff.ts` (per-cue manual-edit) | **done** |
| Wire two-tier + real measure into LONG badge | pending |
| Smart Adjust Mode A (minimal fixes) | pending |
| Smart Adjust Mode B (full re-splice) | pending |

**Later phases:** Oklch → v5.3.7 (Phase 2); worker/chunking → v5.3.8 (Phase 3).

## v5.3.6 — Smart Split relaxation — **TAGGED** (`v5.3.6`)

**Release notes:** [`docs/release-notes-v5.3.6.md`](docs/release-notes-v5.3.6.md)

## v5.3.5 — Cue-stable overlay caching — **COMPLETE** (merged 2026-07-04)

**Tag:** `v5.3.5` (push deferred)  
**Source of truth:** [`docs/5.3.5-cue-stable-overlay-caching-design.md`](docs/5.3.5-cue-stable-overlay-caching-design.md)  
**Release notes:** [`docs/release-notes-v5.3.5.md`](docs/release-notes-v5.3.5.md)

Speed-up goals beyond cue-cache (pacing floor, VP8A normalize, worker chunking) → **v5.3.7** — see `docs/future-ideas.md` § Canvas Subtitle Bake Performance.

## Next — v5.3.7 (planned)

| Doc | Topic |
|-----|-------|
| `docs/5.3.7-worker-and-chunked-parallelization-design.md` | Worker + temporal chunking; burst capture |

## v5.3.4 — Subtitle canvas overlay (complete)

**Tag:** `v5.3.4`  
**Source of truth:** [`docs/v5.3.4-subtitle-canvas-overlay.md`](docs/v5.3.4-subtitle-canvas-overlay.md)  
**Release notes:** [`docs/release-notes-v5.3.4.md`](docs/release-notes-v5.3.4.md)

### Restore / test (current stable)

```bash
git checkout feature/v5.3.6-smart-split-refactor && npm install && npm run dev
node scripts/test-smart-split.mjs
node scripts/test-cue-measurement.mjs
node scripts/test-transcript-edit-diff.mjs
node scripts/test-overlay-frame-pacing.mjs
node scripts/test-cue-cache.mjs
```