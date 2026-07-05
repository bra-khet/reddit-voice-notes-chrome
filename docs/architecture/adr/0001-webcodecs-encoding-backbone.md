# ADR-0001: WebCodecs dual-stream encoding backbone (normalize eliminated by construction)

- **Status:** Accepted
- **Date:** 2026-07-04
- **Reflects branch/tag:** `feature/v5.3.10-webcodecs-encoding`
- **Deciders:** v5.3.10 implementation session (Claude + bra-khet)

## Context

Post-v5.3.9 QA (`.ignore/sub-QA-5.3.9b/`, 200-cue 60 s bake) showed the overlay
bake at ~143–145 s wall with **normalize at ~111 s (77%)** — a full libvpx
`yuva420p` re-encode whose only job is repairing MediaRecorder's output (VFR
timestamps, missing duration metadata, implicit VP8A alpha). Parallel capture
(v5.3.9) already cut the render stage to ~17 s, so swapping MediaRecorder for
`VideoEncoder` while keeping normalize would save ~12 s of a 143 s bake.
Sub-real-time export requires removing normalize's *reason to exist*, not just
speeding up capture. Constraint: Chrome's `VideoEncoder` cannot encode an alpha
plane, and the overlay pipeline is alpha-dependent end to end.

## Decision

Each chunk encodes **two VP8 streams** (color = paint canvas with
`alpha:'discard'`, premultiplied-over-black; alpha = coverage rendered as gray
luminance via three GPU compositing ops), muxed into **IVF containers in pure
TypeScript with global-frame-index PTS**, stitched by **pure-TS concatenation**
(no FFmpeg), and consumed by a new **`alphamerge` + `unpremultiply` composite
tier family** inside the single x264 pass the composite always ran. A one-time
**encode→decode calibration probe** measures the encoder's actual luma range
(limited 16–235 vs full 0–255) and gates the whole path; any failure anywhere
falls back to the untouched MediaRecorder pipeline.

## First-class concern impact

- **Preview ↔ bake:** unchanged promise — the WebCodecs path paints through the
  exact same `paintFrame` internals at the exact same global `(startFrame+i)/fps`
  timestamps (now formalized as `createOverlayFramePainter`, the shared seam
  under both encoders). No new fidelity gap; the composite blend itself is the
  one new surface (premultiplication round-trip) and is QA-gated.
- **Effect composition:** subtitle layer only; compositing order unchanged
  (background → bars → subtitles burned onto base.mp4).
- **Message contracts:** none — the whole path runs in the Design Studio page,
  like the rest of the canvas bake.
- **State ownership:** one new pref field `experimental.webCodecsBake`
  (default false), spread-merged in `normalizePreferences`.

## Options considered

1. **VideoEncoder + keep normalize** — smallest change; fails the goal
   (normalize dominates; ~12 s saved of 143 s).
2. **Self-muxed VP8A WebM (Matroska `BlockAdditions`)** — downstream 100%
   unchanged, but requires a hand-written EBML muxer with alpha side-data and
   keyframe-locked dual encoders, AND still needs normalize skipped to win —
   same correctness question at much higher implementation risk.
3. **Dual-stream IVF + alphamerge (CHOSEN)** — IVF is 32-byte-header trivial
   (pure-TS mux/concat, byte-level unit tests), alpha correctness is decided by
   a measured calibration rather than codec metadata, and normalize's two
   repair jobs (CFR enforcement, explicit alpha plane) become structurally
   unnecessary rather than "skipped".
4. **Browser-side full composite (VideoDecoder on base MP4)** — eliminates the
   composite pass too, but needs an MP4 demuxer dependency, audio remux
   handling, and a much larger blast radius. Deferred; this ADR's segment
   backbone is the prerequisite for it either way.
5. **Do nothing** — bake stays ~2.4× real time; 5.4.0 editing features get no
   encode primitives.

Codec: **VP8 first** (same encoder family MediaRecorder uses today → identical
quality character; cheapest wasm decode in the composite; broadest
`VideoEncoder` support), VP9 as listed alternative, AV1 rejected this phase.
This inverts the original draft doc's "VP9/AV1 preferred" — deliberately.

## Why this is NOT the v5.3.9.1 `compositeReady` mistake

v5.3.9.1's root cause was trusting *captured* MediaRecorder output to be
composite-ready. Here the streams are *constructed*: integer PTS from the
planner's frame indices, frame counts asserted per segment, stream-param
agreement validated at stitch, and the alpha plane built explicitly inside the
composite graph. The invariant "concat output must be normalized" applies to
the MediaRecorder world and still holds there unchanged; this path has a
different contract, enforced by validation + regression-guard tests
(`scripts/test-overlay-alphamerge-args.mjs` asserts the overlay streams are
never re-encoded and never grow a second encoder).

## Consequences

- **Positive:** render is compute-bound (~0.1–0.3× realtime expected at 360p);
  normalize (~111 s) is gone from this path; stitch is FFmpeg-free; segments
  carry self-describing metadata (`EncodedOverlaySegmentMeta`: cue span,
  timing, codec, cost telemetry) — the primitive for 5.4.0 selective
  re-encode/timeline features; the paint seam is worker-portable
  (OffscreenCanvas, no DOM in the encode loop).
- **Negative / accepted cost:** premultiplied color round-trips through YUV
  `unpremultiply` (sub-pixel edge precision at very low alpha — glow tails);
  dual encode doubles encoder work (cheap at 640×360); the composite gains a
  three-input graph that real-browser QA must validate visually. Rejected
  over-engineering: no worker pool this phase (paint is ~2–5 ms/frame at 360p
  — measure before adding transfer machinery), no in-browser base-video
  compositing (option 4), no per-user codec/quality UI (constants until QA
  data says otherwise).
- **Follow-ups:** real-browser QA (visual alpha fidelity, calibration result
  on real hardware, timing JSONs); flip `webCodecsBake` default after QA;
  worker placement + option 4 exploration in 5.4.0.

## References

- Code: `src/encoding/` (segment model, IVF, probe, encoder),
  `src/transcription/subtitle-overlay-webcodecs.ts`,
  `src/ffmpeg/overlay-alphamerge-args.ts`,
  `src/ffmpeg/subtitle-burnin.ts` `buildWebCodecsOverlayStrategies`,
  `src/ui/design-studio/subtitle-canvas-bake.ts` encoder branch.
- Docs: `docs/5.3.10-webcodecs-per-chunk-encoding.md` §0 (as-built),
  `docs/5.3.9-worker-and-chunked-parallelization-design.md` §0 (seam contract).
- Bugs: v5.3.9.1 concat regression (design doc 5.3.9 §0.4) — the failure mode
  this ADR's guards exist to prevent recurring.
