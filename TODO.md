# TODO

## v5.3.6+ — Smart Split + overlay fixes (on `main`, next tag)

**Smart Split:** `SMART_SPLIT_WIDTH_RELAXATION = 1.5` + font headroom above 22px (`SMART_SPLIT_REFERENCE_FONT_SIZE`).  
**BUG-036:** cue-cache overlay A/V drift — **fixed** (user QA pass).  
**Docs:** [`docs/5.3.6-smart-split-relaxation-design.md`](docs/5.3.6-smart-split-relaxation-design.md), [`docs/bug-archive.md`](docs/bug-archive.md) BUG-036

Roll into next tag (not a separate v5.3.6 patch).

**Next up (Phase 1 of integrated roadmap):** real-canvas measurement + Smart Adjust (minimal fixes + full re-splice from original transcript) on `feature/v5.3.6-smart-split-refactor`. See [`docs/5.3.6-5.3.8-integrated-roadmap.md`](docs/5.3.6-5.3.8-integrated-roadmap.md) — synthesizes the measurement/Smart-Adjust supplements plus resequences Oklch (now Phase 2 / v5.3.7) ahead of worker/chunking (now Phase 3 / v5.3.8).

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
git checkout main && npm install && npm run dev
node scripts/test-smart-split.mjs
node scripts/test-overlay-frame-pacing.mjs
node scripts/test-cue-cache.mjs
```