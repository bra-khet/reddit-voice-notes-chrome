# Release notes — v5.3.9 **Parallel Chunked Bake (Phase 3)** — DRAFT

**Tag:** `v5.3.9` (pending merge + user QA) · **Date:** 2026-07-04  
**Branch:** `feature/v5.3.9-parallelization`  
**Restore:** `git checkout feature/v5.3.9-parallelization && npm install && npm run dev`  
**Prior stable:** `v5.3.8` (Oklch Perceptual Hue Rotation)  
**Design:** `docs/5.3.9-worker-and-chunked-parallelization-design.md` §0 As-Built Revision  
**Roadmap:** `docs/5.3.6-5.3.9-integrated-roadmap.md` § Phase 3

## Summary

The canvas subtitle bake's render stage was **real-time bound**: MediaRecorder ingests
canvas frames at wall-clock rate, so a 60 s clip took ≥60 s to capture no matter how
fast painting was (the v5.3.5 cue cache already made paint nearly free). v5.3.9 splits
the timeline into **frame-aligned chunks at cue-gap boundaries** and runs **N paced
capture loops concurrently** in the Design Studio page, then stitches the chunks in a
**single FFmpeg pass** (trim + concat + yuva420p encode) that *replaces* the previous
alpha-normalize re-encode — so the FFmpeg side costs the same as before.

**Architecture revision vs. the original proposal:** the Web Worker render loop and
`chrome.offscreen` coordinator were **dropped** — MediaRecorder can't live in a worker,
paint was never the bottleneck, and the bake doesn't run in the service worker. Full
rationale in the design doc §0.1. The chunk seam is encoder-agnostic so a future
WebCodecs path (true faster-than-realtime encode, worker-friendly) can slot in per chunk.

**Expected wins (to confirm in user QA):** render stage ~1.1× realtime → ~0.3–0.6×
(4 / 2 chunks); a 60 s rich-effects bake's render phase drops from ~65 s to ~17 s.
Short clips (<20 s), low-core (<4), and low-memory (<4 GB) devices stay serial
automatically.

## Highlights

| Change | Detail |
|--------|--------|
| **Chunk planner** | `src/transcription/overlay-chunk-planner.ts` — pure, Node-tested: partitions `ceil(duration×fps)` frames exactly; boundaries snap to cue gaps (±5 s search) so MediaRecorder's ±1-frame jitter lands on blank frames; mid-cue slice fallback for wall-to-wall cues |
| **Concurrent capture** | `subtitle-overlay-renderer.ts` `timeRange` + `captureOverlayChunkRaw()` — chunks paint at global `(startFrame+i)/fps`, keeping animation phase, cue timing, and cache keys bit-identical to serial; 150 ms staggered starts |
| **One-pass concat** | `src/ffmpeg/overlay-chunk-concat.ts` + `overlay-concat-args.ts` — per-input VP8A libvpx decode + genpts, `trim=end=` (drops per-chunk tail frames → zero seam drift), concat, composite-ready yuva420p output; replaces `normalizeOverlayWebmForComposite` on this path |
| **Orchestrator** | `src/transcription/subtitle-overlay-parallel.ts` — abort fan-out, aggregate progress, merged cache stats; **any chunk/concat failure falls back to the untouched serial render** (user cancel / perf-guard aborts always rethrow) |
| **Memory discipline** | Per-chunk cue cache budget `max(24, 64/N)` entries — N caches stay inside the serial envelope; deviceMemory <4 GB disables parallel |
| **Feature flag** | `experimental.parallelBake` in user prefs — default **true** (auto-gating + fallback chain do the safety work); set `false` to force serial |
| **Overlay Lab A/B** | "Parallel chunked render (v5.3.9)" toggle forces parallel; timing JSON gains `parallel-plan` / `parallel-concat-*` / `parallel-result` entries |

## Safety / fallback chain

```
experimental.parallelBake (default on)
  → auto-gate: ≥20 s clip · ≥3 effective cores · ≥4 GB · ≥2 chunks after 8 s floor
    → chunk capture or concat failure → serial render (unchanged v5.3.8 path)
      → perf guard (2.5–3 min) → drawtext fallback (unchanged)
```

## Restore / test

```bash
git checkout feature/v5.3.9-parallelization && npm install && npm run dev
node scripts/test-chunk-planner.mjs        # 13 checks
node scripts/test-overlay-concat-args.mjs  # 5 checks
node scripts/test-cue-cache.mjs && node scripts/test-overlay-frame-pacing.mjs
npm run build
```

Manual QA (pending): Design Studio → Subtitles → Overlay Lab → **long (16-cue)** set →
render with and without the parallel toggle; compare timing JSON `render.realtimeFactor`
and inspect seams around chunk boundaries (`parallel-plan` entry lists `startFrame`s;
scrub the overlay video near `startFrame/30` seconds). Then a real ≥30 s recording →
full bake → verify subtitles, A/V sync, and chronos progress.

## Next

**v5.4.0** — Design Studio First: standalone voice notes suite
(`docs/5.4.0-design-studio-first-standalone-voice-notes-suite-roadmap.md`); consumes
this bake as a composable backend. WebCodecs chunk encoder is the follow-on perf idea
(design doc §0.4).
