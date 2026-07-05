# TODO

## v5.3.10 — WebCodecs Per-Chunk Encoding — **IMPLEMENTED, PENDING QA**

**Branch:** `feature/v5.3.10-webcodecs-encoding` (from `main` @ `v5.3.9`)  
**Design:** [`docs/5.3.10-webcodecs-per-chunk-encoding.md`](docs/5.3.10-webcodecs-per-chunk-encoding.md) **§0 As-Built** · ADR: [`docs/architecture/adr/0001-webcodecs-encoding-backbone.md`](docs/architecture/adr/0001-webcodecs-encoding-backbone.md)  
**Depends on:** v5.3.9 encoder-agnostic chunk seam (shipped)

Key reframe vs the draft: normalize (~111 s, 77% of bake wall) — not capture —
was the blocker. The WebCodecs path produces dual color+alpha IVF streams that
are composite-ready **by construction** (integer global PTS, frame-exact,
explicit alpha via `alphamerge` in the composite graph), so normalize is
eliminated on this path, not just faster. Expected 200-cue/60 s bake:
~145 s → ~25–40 s (real-browser QA to confirm).

| Deliverable | Status |
|-------------|--------|
| Capability detection + alpha-luma **calibration probe** + `experimental.webCodecsBake` flag (default off) | **done** |
| Encoding layer: segment model, pure-TS IVF mux/concat, dual `VideoEncoder` per-chunk loop | **done** |
| WebCodecs orchestrator (planner reuse) + alphamerge composite tiers + bake fallback chain | **done** |
| Timing schema v3: `encoderType`, `encode` aggregates; Lab toggle on BOTH buttons | **done** |
| Tests: `test-ivf` (7) · `test-overlay-alphamerge-args` (6, incl. never-re-encode regression guard) · `test-encoded-segment` (5) — 20/20 suites green, tsc baseline, build clean | **done** |
| **QA (real browser):** design doc §0.7 checklist — timing JSONs, visual alpha fidelity, fallback drill, ≤30 s target | **pending** |
| Merge → tag `v5.3.10` → version bump (release commit, after QA) | **pending** |

## v5.3.9 — Parallel Chunked Bake (Phase 3) — **MERGED & TAGGED**

**Tag:** `v5.3.9` on `main` · **Release notes:** [`docs/release-notes-v5.3.9.md`](docs/release-notes-v5.3.9.md)  
**Branch:** merged `feature/v5.3.9-parallelization` (2026-07-05)  
**Push:** deferred (local tag + merge only)

| Deliverable | Status |
|-------------|--------|
| Concurrent paced chunk captures + stream-copy concat | **done** |
| v5.3.9.1 concat regression fix + Lab bake toggle | **done** |
| Tests (`test-chunk-planner`, `test-overlay-concat-args`) | **done** |
| User QA (post-fix `.ignore/sub-QA-5.3.9b/`) | **done** — acceptable; normalize dominates; v5.3.10 completes perf |

## v5.3.8 — Oklch Perceptual Hue Rotation (Phase 2) — **MERGED & TAGGED**

**Tag:** `v5.3.8` · **Release notes:** [`docs/release-notes-v5.3.8.md`](docs/release-notes-v5.3.8.md)

## v5.3.7 — Editor Intelligence (Phase 1) — **MERGED & TAGGED**

**Tag:** `v5.3.7` · **Release notes:** [`docs/release-notes-v5.3.7.md`](docs/release-notes-v5.3.7.md)

## v5.3.6 — Smart Split relaxation — **TAGGED** (`v5.3.6`)

**Release notes:** [`docs/release-notes-v5.3.6.md`](docs/release-notes-v5.3.6.md)

### Restore / test (v5.3.9)

```bash
git checkout v5.3.9 && npm install && npm run dev
node scripts/test-chunk-planner.mjs
node scripts/test-overlay-concat-args.mjs
node scripts/test-oklch.mjs && node scripts/test-cue-cache.mjs
```

**Next push when ready:** `git push origin main --tags`