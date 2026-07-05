# TODO

## v5.3.10 — WebCodecs Per-Chunk Encoding — **NEXT**

**Branch:** `feature/v5.3.10-webcodecs-encoding` (branch from `main` @ `v5.3.9`)  
**Design:** [`docs/5.3.10-webcodecs-per-chunk-encoding.md`](docs/5.3.10-webcodecs-per-chunk-encoding.md)  
**Depends on:** v5.3.9 encoder-agnostic chunk seam (shipped)

| Deliverable | Status |
|-------------|--------|
| Capability detection + `experimental.webCodecsBake` flag | pending |
| Per-chunk `VideoEncoder` loop (`webcodecs-chunk-encoder.ts`) | pending |
| Wire into chunk orchestrator behind flag | pending |
| Timing JSON `encoderType` + `encodeMs` | pending |
| QA: 60 s rich-effects bake ≤30 s target | pending |

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