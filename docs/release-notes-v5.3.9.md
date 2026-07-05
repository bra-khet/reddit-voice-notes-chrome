# Release notes — v5.3.9 **Parallel Chunked Bake (Phase 3)**

**Tag:** `v5.3.9` · **Date:** 2026-07-05  
**Branch:** merged `feature/v5.3.9-parallelization` → `main`  
**Restore:** `git checkout v5.3.9 && npm install && npm run dev`  
**Prior stable:** `v5.3.8` (Oklch Perceptual Hue Rotation)  
**Design:** `docs/5.3.9-worker-and-chunked-parallelization-design.md` §0 As-Built Revision  
**Roadmap:** `docs/5.3.6-5.3.9-integrated-roadmap.md` § Phase 3  
**Superseded by:** **v5.3.10** WebCodecs encoding — `docs/release-notes-v5.3.10.md` (sub-real-time bake; normalize eliminated on fast path)

## Summary

The canvas subtitle bake's render stage is **real-time bound**: MediaRecorder ingests canvas frames at wall-clock rate, so a 60 s clip takes ≥60 s to capture no matter how fast painting is (the v5.3.5 cue cache already made paint nearly free). v5.3.9 splits the timeline into **frame-aligned chunks at cue-gap boundaries** and runs **N paced capture loops concurrently** in the Design Studio page, then stitches the chunks with a **stream-copy FFmpeg concat** (no decode, no encode) before the existing alpha-normalize + composite steps.

**Architecture revision vs. the original proposal:** the Web Worker render loop and `chrome.offscreen` coordinator were **dropped** — MediaRecorder can't live in a worker, paint was never the bottleneck, and the bake doesn't run in the service worker. The chunk seam is **encoder-agnostic** so v5.3.10 can swap per-chunk `VideoEncoder` for MediaRecorder without touching the planner or concat contract.

## v5.3.9.1 — concat regression found and fixed (2026-07-04)

The first cut of concat did a full decode+re-encode of the entire clip and skipped normalize, making the parallel path **1.4×–2.7× slower end-to-end** than serial on 60 s clips (concat alone cost 70–150 s). Fixed same day: stream-copy `-f concat` demuxer, normalize always runs afterward, concat gets its own timing stage (`concatMs`), Lab bake button respects the A/B toggle. Full diagnosis: design doc **§0.4**.

## User QA (2026-07-05) — post-fix pass

**Source:** `.ignore/sub-QA-5.3.9b/` (Overlay Lab, session segment set, rich effects: gradient + wave + rainbow halo + dual border). Toggle **on** = forced parallel; **off** = serial.

### Overlay render only (download path)

| Cues | Toggle | Total | Capture `wallMs` | `realtimeFactor` |
|------|--------|-------|------------------|------------------|
| 20 | serial (off) | 64.1 s | 63.8 s | 1.05× |
| 20 | parallel (on) | 90.4 s | 17.6 s | 0.29× |
| 200 | serial (off) | 68.3 s | 68.2 s | 1.13× |
| 200 | parallel (on) | 116.6 s | 18.7 s | 0.31× |

Parallel **capture** lands as designed (~0.3× realtime, 4 chunks), but the overlay-only render path still pays a large chunk-stitch bracket (`parallel-concat-done` − `parallel-concat-start` ≈ 73–98 s on these runs), so **serial is faster for overlay-only download** on 60 s clips. Full bakes use a cheap stream-copy stitch; this overhead is specific to the Lab render action's parallel concat wait.

### Full canvas bake (overlay + normalize + composite)

| Cues | Toggle | Total | Capture `wallMs` | Normalize | Composite |
|------|--------|-------|------------------|-----------|-----------|
| 200 | parallel (on) | **145.1 s** | 17.5 s (0.29×) | 111.0 s (77%) | 16.6 s |
| 200 | serial (off) | **143.0 s** | 17.8 s (0.29×) | 110.0 s (77%) | 15.2 s |

Post-fix full bakes are **parity within ~1.5%** — the catastrophic concat tax is gone. Capture is ~4× faster than serial pacing (~68 s on the 200-cue render-off run), but **normalize + composite dominate** (~88% of wall time), so end-to-end bake does not yet beat the v5.3.8 experience (~45 s on typical production rich-effects clips). That gap is expected: parallel chunking removes real-time capture wait, not FFmpeg alpha-normalize or wasm composite cost.

**Verdict:** Acceptable to ship as **infrastructure** — capture parallelism works, seams visually OK, fallback chain intact. Meaningful sub-real-time bake waits for **v5.3.10** (`VideoEncoder` replaces paced MediaRecorder per chunk).

## Highlights

| Change | Detail |
|--------|--------|
| **Chunk planner** | `overlay-chunk-planner.ts` — frame partition, cue-gap snap (±5 s), mid-cue fallback, auto gate (≥20 s / cores / memory), cache budget `max(24, 64/N)` |
| **Concurrent capture** | `subtitle-overlay-renderer.ts` `timeRange` + `captureOverlayChunkRaw()` — global `(startFrame+i)/fps` keeps Oklch phase + cache keys chunk-invariant |
| **Stream-copy stitch** | `overlay-chunk-concat.ts` + `overlay-concat-args.ts` — `-f concat -c copy` + `outpoint` trim; decode+re-encode tier is fallback only |
| **Orchestrator** | `subtitle-overlay-parallel.ts` — staggered captures, abort fan-out, serial fallback on failure |
| **Unified normalize** | `normalizeOverlayWebmForComposite` always runs after concat (both paths) |
| **Feature flag** | `experimental.parallelBake` (default **true**; auto-gate + fallback) |
| **Overlay Lab A/B** | Parallel toggle on render **and** bake; timing JSON: `parallel-plan`, `concatMs`, `parallel-result` |

## Safety / fallback chain

```
experimental.parallelBake (default on)
  → auto-gate: ≥20 s · ≥3 cores · ≥4 GB · ≥2 chunks
    → chunk failure → serial render
      → concat stream-copy failure → concat re-encode fallback
        → concat failure → serial render
          → perf guard → drawtext fallback
```

## Restore / test

```bash
git checkout v5.3.9 && npm install && npm run dev
node scripts/test-chunk-planner.mjs        # 13 checks
node scripts/test-overlay-concat-args.mjs  # 8 checks
npm run build
```

Overlay Lab → session/long set → parallel toggle A/B on render and bake; compare `summary.stages.concatMs` (small on bake) and capture `realtimeFactor` (~0.3× parallel vs ~1.1× serial on render-off).

## Next

**v5.3.10** — WebCodecs per-chunk encoding for sub-real-time overlay bake (`docs/5.3.10-webcodecs-per-chunk-encoding.md`). Branch: `feature/v5.3.10-webcodecs-encoding`. Then **v5.4.0** Design Studio First.