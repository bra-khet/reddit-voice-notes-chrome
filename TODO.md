# TODO

## v5.3.5 — Cue-stable overlay caching — **COMPLETE** (merged 2026-07-04)

**Tag:** `v5.3.5` (push deferred)  
**Source of truth:** [`docs/5.3.5-cue-stable-overlay-caching-design.md`](docs/5.3.5-cue-stable-overlay-caching-design.md) (design + QA §5)  
**Release notes:** [`docs/release-notes-v5.3.5.md`](docs/release-notes-v5.3.5.md)

Speed-up goals beyond cue-cache (pacing floor, VP8A normalize, worker chunking) → **v5.3.6 / v5.3.7** — see `docs/future-ideas.md` § Canvas Subtitle Bake Performance.

## Next — v5.3.6 / v5.3.7 (planned)

| Doc | Topic |
|-----|-------|
| `docs/5.3.6-smart-split-relaxation-design.md` | Relax Smart Split thresholds (pair with cache/LRU) |
| `docs/5.3.7-worker-and-chunked-parallelization-design.md` | Worker + temporal chunking; burst capture |

## v5.3.4 — Subtitle canvas overlay (complete)

**Tag:** `v5.3.4`  
**Source of truth:** [`docs/v5.3.4-subtitle-canvas-overlay.md`](docs/v5.3.4-subtitle-canvas-overlay.md)  
**Release notes:** [`docs/release-notes-v5.3.4.md`](docs/release-notes-v5.3.4.md)

### Restore / test (current stable)

```bash
git checkout main && npm install && npm run dev
node scripts/test-cue-cache.mjs
node scripts/test-overlay-lab-timing-summary.mjs
```