# ADR-0003: Composite-stage elimination for the WebCodecs bake (STUB)

- **Status:** Proposed (stub — decision needed before any implementation)
- **Date:** 2026-07-06
- **Reflects branch/tag:** `main` @ package `5.4.0` (tag deferred)
- **Deciders:** TBD (opened by architecture-hardening v2.0 pass)

## Context

v5.3.10 QA: the WebCodecs bake is ~46–50 s wall for a 60 s rich-effects clip,
of which **~43 s (≈88%) is the single FFmpeg x264 composite pass** (decode base
MP4 + alphamerge overlay + re-encode + AAC remux) in single-threaded WASM. The
encode/stitch stages this backbone optimized are now ~7 s. ADR-0001 named
browser-side compositing as option 4 and deferred it; `claude-progress.md`
v5.3.10/v5.4.0 both list "composite-stage perf" as the optional follow-up.
This is the last super-linear wall between the current bake and a few-second
export.

**Decision needed:** where should the final MP4 be authored — WASM FFmpeg (as
today) or the browser (VideoDecoder + canvas blend + VideoEncoder + JS MP4
mux)?

## First-class concern impact (to evaluate per option)

- **Preview ↔ bake:** browser-side compositing moves the *blend* out of FFmpeg
  — the blend becomes a new fidelity surface that must be QA-gated exactly like
  the alphamerge tiers were (premultiply semantics, color space).
- **Effect composition:** compositing order unchanged; only the executor moves.
- **Message contracts:** browser-side path would remove the burn-in offscreen
  hop entirely for this stage (bake already runs in the Studio page).
- **State ownership:** none new; output still lands in `rvnLastBakedMp4`.

## Options considered (sketch — expand before deciding)

1. **Accept current cost** — bake is already sub-real-time and user-accepted;
   spend the effort on product features instead.
2. **WASM x264 tuning** — preset/tune/threads flags; likely bounded gains
   (single-threaded WASM is the ceiling); cheapest to try, measure first.
3. **Browser-side full composite (ADR-0001 option 4)** — VideoDecoder on base
   MP4 + paint/blend + VideoEncoder + JS mux (needs an MP4 demux/mux dependency
   and an audio remux story). Largest win (composite becomes compute-bound),
   largest blast radius; the v5.3.10 segment backbone was built as its
   prerequisite.
4. **Hybrid: browser video, FFmpeg mux** — encode composited video in the
   browser, use FFmpeg only for stream-copy mux with the original AAC. Avoids
   the JS-mux dependency; keeps one cheap FFmpeg pass.

## Consequences

To be filled at decision time. Constraint to carry: whatever is chosen must
keep the MediaRecorder/drawtext fallback chain intact and must not fudge the
chronos meter to *look* faster (risk register R8).

## References

- Code: `src/ffmpeg/overlay-alphamerge-args.ts`, `src/ffmpeg/subtitle-burnin.ts`,
  `src/encoding/*` (segment backbone).
- Docs: ADR-0001 (option 4 + "follow-ups"); `docs/5.3.10-webcodecs-per-chunk-encoding.md`
  §0.8; `docs/architecture/hardening-backlog.md` H9 + R8.
- QA: `.ignore/sub-QA-5.3.10/` timing JSONs (composite ≈ 43 s of 46–50 s).
