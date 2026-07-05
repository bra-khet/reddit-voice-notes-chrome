# Release notes — v5.3.9 **Parallel Chunked Bake (Phase 3)** — DRAFT

**Tag:** `v5.3.9` (pending merge + user QA) · **Date:** 2026-07-04  
**Branch:** `feature/v5.3.9-parallelization`  
**Restore:** `git checkout feature/v5.3.9-parallelization && npm install && npm run dev`  
**Prior stable:** `v5.3.8` (Oklch Perceptual Hue Rotation)  
**Design:** `docs/5.3.9-worker-and-chunked-parallelization-design.md` §0 As-Built Revision (§0.4 covers the same-day perf fix below)  
**Roadmap:** `docs/5.3.6-5.3.9-integrated-roadmap.md` § Phase 3

## Summary

The canvas subtitle bake's render stage was **real-time bound**: MediaRecorder ingests
canvas frames at wall-clock rate, so a 60 s clip took ≥60 s to capture no matter how
fast painting was (the v5.3.5 cue cache already made paint nearly free). v5.3.9 splits
the timeline into **frame-aligned chunks at cue-gap boundaries** and runs **N paced
capture loops concurrently** in the Design Studio page, then stitches the chunks with a
**stream-copy FFmpeg concat** (no decode, no encode) before the existing, unchanged
alpha-normalize + composite steps.

**Architecture revision vs. the original proposal:** the Web Worker render loop and
`chrome.offscreen` coordinator were **dropped** — MediaRecorder can't live in a worker,
paint was never the bottleneck, and the bake doesn't run in the service worker. Full
rationale in the design doc §0.1. The chunk seam is encoder-agnostic so a future
WebCodecs path (true faster-than-realtime encode, worker-friendly) can slot in per chunk.

## Known issue, found and fixed same day (v5.3.9.1)

The first cut of the concat step did a full decode+re-encode of the entire clip
(reusing the frame-exact trim as an FFmpeg filter graph, rather than the demuxer-level
`outpoint` directive) and treated that output as already composite-ready, skipping the
normalize step. Real Overlay Lab QA on 60 s clips showed this cost **70-150 s** — far
more than the ~47 s the render phase saved — making the parallel path **1.4×-2.7×
slower end-to-end than serial**, the opposite of the goal. Root-caused from real timing
JSONs and fixed same day: concat is now a stream-copy `-f concat` demuxer pass (no
decode/encode), and `normalizeOverlayWebmForComposite` always runs afterward for both
paths, exactly as it always did for serial. Full diagnosis, before/after numbers, and
the fix: design doc **§0.4**. A related gap (the Lab's bake button ignored the parallel
A/B toggle, so the original "toggle-off" bake benchmark wasn't actually serial) was
fixed in the same pass.

**This means the render-phase win reported below is now the actual end-to-end win** —
concat/stitch is no longer a hidden tax on it.

## Expected wins (to confirm in user QA — see checklist below)

Render stage: ~1.1× realtime → ~0.3× (4 chunks) — a 60 s rich-effects clip's *capture*
drops from ~65 s to ~17 s. Stitch is now a stream copy (near-zero cost regardless of
clip length or chunk count). Normalize + composite cost is unchanged from serial, paid
once by both paths. Expected end-to-end total on a 60 s clip: roughly
`17 s (capture) + ~1 s (stitch) + normalize + composite`, vs serial's
`60+ s (capture) + normalize + composite` — i.e. total time should drop by close to the
full ~47 s capture-phase saving. Short clips (<20 s), low-core (<4), and low-memory
(<4 GB) devices stay serial automatically.

## Highlights

| Change | Detail |
|--------|--------|
| **Chunk planner** | `src/transcription/overlay-chunk-planner.ts` — pure, Node-tested: partitions `ceil(duration×fps)` frames exactly; boundaries snap to cue gaps (±5 s search) so MediaRecorder's ±1-frame jitter lands on blank frames; mid-cue slice fallback for wall-to-wall cues |
| **Concurrent capture** | `subtitle-overlay-renderer.ts` `timeRange` + `captureOverlayChunkRaw()` — chunks paint at global `(startFrame+i)/fps`, keeping animation phase, cue timing, and cache keys bit-identical to serial; 150 ms staggered starts |
| **Stream-copy stitch** | `src/ffmpeg/overlay-chunk-concat.ts` + `overlay-concat-args.ts` — primary tier is `-f concat -safe 0 -c copy` with per-file `outpoint` trim (no decode/encode); falls back to a decode+filter-concat+re-encode tier only on failure |
| **Orchestrator** | `src/transcription/subtitle-overlay-parallel.ts` — abort fan-out, aggregate progress, merged cache stats; **any chunk/concat failure falls back to the untouched serial render** (user cancel / perf-guard aborts always rethrow) |
| **Unified normalize** | `normalizeOverlayWebmForComposite` always runs after concat (both paths) — concat's own progress stage (`OVERLAY_CONCAT_STAGE`) is now distinct from normalize's in the timing JSON |
| **Memory discipline** | Per-chunk cue cache budget `max(24, 64/N)` entries — N caches stay inside the serial envelope; deviceMemory <4 GB disables parallel |
| **Feature flag** | `experimental.parallelBake` in user prefs — default **true** (auto-gating + fallback chain do the safety work); set `false` to force serial |
| **Overlay Lab A/B** | "Parallel chunked render (v5.3.9)" toggle forces parallel on **both** the render and bake buttons; timing JSON gains `parallel-plan` / `canvas-overlay-concat-stitch` / `parallel-result` entries and `summary.stages.concatMs` |

## Safety / fallback chain

```
experimental.parallelBake (default on)
  → auto-gate: ≥20 s clip · ≥3 effective cores · ≥4 GB · ≥2 chunks after 8 s floor
    → chunk capture failure → serial render (unchanged v5.3.8 path)
      → concat stream-copy failure → concat decode+re-encode fallback
        → concat failure (both tiers) → serial render (unchanged v5.3.8 path)
          → perf guard (2.5–3 min) → drawtext fallback (unchanged)
```

## Restore / test

```bash
git checkout feature/v5.3.9-parallelization && npm install && npm run dev
node scripts/test-chunk-planner.mjs        # 13 checks
node scripts/test-overlay-concat-args.mjs  # 8 checks
node scripts/test-cue-cache.mjs && node scripts/test-overlay-frame-pacing.mjs
npm run build
```

Manual QA (pending — this is the reason v5.3.9.1 exists: the first cut's regression was
only visible in real timing JSONs, not in Node tests):

1. Design Studio → Subtitles → Overlay Lab → **long (16-cue)** set → render with and
   without the parallel toggle. Compare timing JSON: `summary.stages.concatMs` should
   now be small (sub-second to a few seconds) instead of tens of seconds, and
   `summary.totalMs` for the parallel run should be well under the serial run's.
2. Same comparison for **Run full bake (canvas)** — the toggle now actually controls
   this button; confirm `summary.stages.normalizeMs` is present and similar in both
   toggle states (proves normalize isn't being skipped or duplicated).
3. Inspect seams: scrub the overlay video near each chunk's `startFrame/30` seconds
   (from the `parallel-plan` entry) for visual glitches or hue/gradient discontinuities.
4. A real ≥30 s recording → full production bake → verify subtitles, A/V sync, and
   chronos progress end to end.

## Next

**v5.4.0** — Design Studio First: standalone voice notes suite
(`docs/5.4.0-design-studio-first-standalone-voice-notes-suite-roadmap.md`); consumes
this bake as a composable backend. WebCodecs chunk encoder is the follow-on perf idea
(design doc §0.6).
