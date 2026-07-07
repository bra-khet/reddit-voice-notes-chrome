# ADR-0003: Browser-side full composite (eliminate FFmpeg composite stage for primary path)

- **Status:** Accepted
- **Date:** 2026-07-07
- **Reflects branch/tag:** `main` @ package `5.4.0` (commit `b0db6bd0183cb4454775e9b6a8b61fc955a559df`; tag `v5.4.0` "Design Studio First")
- **Deciders:** User strategic direction (non-negotiable) + architecture decision (this record)

## Context

v5.3.10 shipped the per-chunk WebCodecs encoding backbone (ADR-0001): shared `createOverlayFramePainter`, `EncodedOverlaySegmentMeta`, pure-TS IVF concat with global integer PTS, dual-VP8 construction that eliminated normalize by design, and alphamerge tiers inside the remaining single x264 composite pass. v5.4.0 shipped TakeManager + Studio-native recording on that foundation.

Post-v5.3.10 QA (`.ignore/sub-QA-5.3.10/`, `claude-progress.md`): a 60 s rich-effects clip bakes in ~46–50 s wall time on the WebCodecs path; **~43 s (≈88%) is the FFmpeg WASM alphamerge + x264 composite** (base MP4 decode + overlay + re-encode + AAC remux) in a single-threaded Emscripten environment. The render/encode/stitch work optimized by the backbone is only ~7 s. The composite stage is the last super-linear wall.

ADR-0001 explicitly named "Browser-side full composite (ADR-0001 option 4)" and built the segment/painter/IVF primitives as its prerequisite. The stub in this ADR (opened during hardening v2.0) deferred the choice.

**Strategic direction (non-negotiable):** Choose browser-side full composite. Deprioritize the historical "preview must be pixel-identical to final bake" constraint. Rich features, performance, and long-term extensibility now take priority. The v5.3.10 foundation exists precisely to enable this evolution.

Hard constraints that must survive:
- MediaRecorder + drawtext fallback chain remains end-to-end and untouched for the compatibility paths.
- Chronos/telemetry stays honest (distinct semantic stages, real ratios derived from work; no fudging to mask the old wall — R8).
- Output artifact still lands in `rvnLastBakedMp4` (and base stores) with correct `TakeArtifactStamp`s so TakeManager, attach mode, Download, and recovery continue to work without change.

## Decision

**Browser-side full composite is chosen** (ADR-0001 option 4, full variant).

Implementation shape (high level):
- `VideoDecoder` on the video track of the existing base MP4 (demuxed via new dependency).
- Per-frame decode → `VideoFrame` (or ImageBitmap/OffscreenCanvas draw).
- Blend using the **existing shared painter** at exact global frame times: `paintFrameAt((startFrame + i) / fps)` on a compositing canvas (or direct `drawImage` + painter output with proper alpha handling). This is the new blend surface.
- `VideoEncoder` on the composited frames (VP8 or AVC per capability; same rate-control character as prior choices where possible).
- Audio passthrough: demux audio samples/encoded chunks from base MP4 and remux without re-encode.
- Final MP4 authored via the muxer (no FFmpeg for this path).

The old FFmpeg alphamerge/x264 composite (and its three-tier strategy family) is bypassed for the primary WebCodecs path. It remains available (and required) for the MediaRecorder fallback tiers and the drawtext last resort.

Rationale:
- **Performance:** Removes the single-threaded WASM x264 wall. The composite becomes bounded by browser VideoDecoder/Encoder throughput (hardware-accelerated paths where available) + canvas paint (already proven fast at 360p). Expected wall time approaches the optimized render/encode time (~few seconds for 60 s clips).
- **Extensibility:** Segments + global-frame painter + explicit metadata are first-class primitives for future Studio features (selective re-bake of changed segments, timeline scrubbing during export, richer GPU effects, variable-rate overlays). FFmpeg filtergraphs are a dead-end for these.
- **Leverage of v5.3.10 investment:** The backbone was deliberately built with this in mind (see ADR-0001 § "Browser-side full composite" and design doc §0.8). Choosing it now realizes the planned arc instead of leaving the primitives under-utilized.
- Preview↔bake pixel fidelity is explicitly relaxed. The blend executor moves from libavfilter `alphamerge`/`unpremultiply`/`overlay` inside x264 to canvas 2D (or equivalent) + encoder round-trip. Visual quality must remain production-grade and subject to rigorous QA, but bit-identical or "alphamerge-equivalent" is no longer a gate.

Options explicitly considered and rejected (for this decision):
1. Accept current cost — sub-real-time is user-accepted today, but leaves a glaring architectural bottleneck and starves future rich features.
2. WASM x264 tuning — bounded by single-thread Emscripten ceiling; does not unlock extensibility.
3. Hybrid (browser video, FFmpeg mux only) — reduces blast radius but still pays a WASM hop and limits the clean "everything is browser primitives" story. Full browser wins on autonomy and future leverage.
4. Browser full (chosen).

## First-class concern impact

- **Preview ↔ bake:** Relaxed per user direction. The live preview (and Studio WYSIWYG audition canvas) continue to use the identical `createOverlayFramePainter` at the same global `(startFrame + i) / fps` timestamps. The fidelity surface that moves is the *final blend + encode*: canvas draw/composite + VideoEncoder output vs prior FFmpeg graph. New edge cases (decode color space, premul handling in canvas vs alphamerge, encoder rate-control) become the QA targets. The invariant "rich effects are canvas-native" strengthens; the "post-base composite" concept is preserved but the executor for the primary path is now in-page browser code.
- **Effect composition:** Order unchanged (base video frames under overlay subtitles + effects). The painter already renders bars? No — bars are in the base capture canvas; subtitles are the post overlay. Composition order for the overlay layer itself is identical.
- **Message contracts:** Primary (WebCodecs + browser composite) path becomes entirely in-Design-Studio-page. The `MSG_BURNIN_START` / offscreen relay / `MSG_BURNIN_*` hop is eliminated for successful rich bakes (already true for the paint/encode leg; now also true for composite). Fallback paths (mediarecorder-parallel/serial + drawtext) retain the existing burn-in client, relay, and offscreen FFmpeg contract unchanged. No change to transcode/transcribe relays. Studio page already receives its own burn-in messages via the skip-tab-relay path (`burnInSkipTabRelayByJobId`); that machinery is simply not exercised on the fast path.
- **State ownership:** None new. The final `Blob` is still passed to `saveLastBakedMp4` (exactly as today) → `rvnLastBakedMp4` IDB + `TakeArtifactStamp` update via `TakeManager.updateFromBake`. All consumers (deck Download, Reddit attach via chunked `fetchBakedMp4*`, recovery, H6 verification) are unaffected. Single-slot overwrite semantics and stamp checks remain the only freshness mechanism.
- **Telemetry / progress (R8):** Must use honest semantic stages and ratios derived from real work (frame counts, decoder/encoder callbacks, mux progress). New distinct labels required (e.g., `browser-composite-decode`, `browser-composite-paint`, `browser-composite-encode`, `browser-composite-mux`). Creep timers only for truly opaque sub-phases. The meter must never be adjusted to hide the old composite cost once users see faster numbers.
- **Execution contexts:** No new context. Work stays in the Design Studio page (OffscreenCanvas + Video* APIs), consistent with the v5.3.10 encode loop. Later workerization is possible and desirable (the painter is already worker-portable) but out of scope for the initial cut.

## New dependencies analysis

**Chosen:** `mediabunny` (https://github.com/Vanilagy/mediabunny, successor to the author's mp4-muxer).

- Zero dependencies, pure TypeScript, highly tree-shakable ("as small as 5 kB gzipped" for minimal mux usage per project docs).
- WebCodecs-native: direct support for feeding `EncodedVideoChunk` / producing from `VideoFrame`, sample-accurate timing, Input/Output abstractions for demux + mux.
- Covers required surface: MP4 demux for video+audio tracks, sample extraction for audio passthrough, MP4 mux for final video+audio container.
- Browser + (theoretical) worker friendly; ESM.

**Size impact:** Negligible. Tree-shaken payload for our needs (MP4 read for video samples + audio copy + write) expected well under 50 kB minified / <15 kB gz. Compare to `@ffmpeg/core` WASM (~10–20 MB) and vosk model (~40 MB/session). Extension package and load-time impact is tiny.

**Integration pain (accepted):**
- New orchestration layer that owns `VideoDecoder` + demux loop, frame pacing aligned to existing global indices from the chunk planner, backpressure (similar to `overlay-webcodecs-encoder.ts`), `VideoFrame` close discipline, and mux finalization.
- Audio remux story must preserve the voice-effected AAC (or whatever codec the prior transcode produced) with correct timestamps derived from the same base.
- Capability probing extension (beyond the existing encode→decode alpha luma probe).
- Error paths must still resolve to the full MediaRecorder fallback (never partial results).
- CSP: pure library, no eval, fine on extension page.

**Alternatives rejected:**
- `mp4box.js` (gpac): heavier (full builds tens-to-hundreds of kB before gzip; not designed for WebCodecs — requires wrappers such as MP4Demuxer), older, more features than we need. Recent 1.0 added TS but integration story is worse than a WebCodecs-first lib.
- Hand-written ISO BMFF (ftyp/moov/mdat/trak etc.): high risk of subtle spec bugs, long timeline, maintenance burden. Not justified when a small, focused, actively-maintained lib exists.
- WebCodecs + WebM mux only (webm-muxer lineage): would require downstream consumers to accept WebM baked artifacts or an extra remux; we want to keep MP4 output contract.

**Cost accepted:** Per explicit user direction. The architectural win, perf, and future extensibility justify the (small) dep + new surface.

## High-level implementation phases / roadmap

1. **Spike (investigative, pre-v5.5 cut):** Stand up a focused harness (extend `subtitle-overlay-lab.ts` or a new `test-browser-composite.mjs` + Lab toggle). Prove:
   - Demux + `VideoDecoder` of a real base MP4 produced by our transcode path.
   - Frame-accurate paint via `createOverlayFramePainter` using the planner's global indices.
   - Canvas blend (correct alpha/premul for glow/dual-border cases).
   - `VideoEncoder` + mux (with audio copy) producing a valid, playable MP4 of matching duration.
   - Timing numbers and basic visual sanity.
   Output of spike: throwaway prototype + notes; no production wiring.

2. **Hybrid cut / behind flag (initial integration):** Add production-grade `renderBrowserComposite` (or `browser-composite.ts`) module. Evolve the encoder preference or add a composite-strategy flag. In `subtitle-canvas-bake.ts` (and the webcodecs orchestrator path), when the new path is selected and probe passes:
   - Perform the full browser composite.
   - Fall back on any error (deliberate aborts rethrow; others → existing MediaRecorder pipeline).
   Keep the alphamerge burn-in path live for fallbacks and the mediarecorder strategies. Update `canvasStageMessage`, chronos reporting, and `onProgress` with honest per-substage ratios. The final `Blob` path is identical (`saveLastBakedMp4` + Take update).
   At this point both old and new composite surfaces can be A/B'd in Lab.

3. **Full browser path + docs/architecture catch-up:** Flip the primary webcodecs path to browser composite by default (under the existing `experimental.webCodecsBake` / resolver). Update fallback documentation, architecture diagrams, extension-points, and `transcription-architecture.md`. Retire (or keep as compatibility-only) the alphamerge tiers for the constructed path. Extend segment metadata if composite boundaries become first-class. Update any timing schema.

4. **Verification gate + rollout:** Fidelity harness + multi-machine visual + timing QA. Only after pass, consider default enablement and removal of "decision-first" language.

Follow-ups (post-cut): worker placement for the composite loop (leverage painter portability + transferable frames), richer per-segment composite control, optional hardware preference surfaces (only if data shows value).

## Updated risk register entries (new risks + mitigations)

Existing R8 is directly addressed by the decision + honesty requirement below. New risks introduced by moving the composite surface:

| # | Risk | Likelihood | Impact | Mitigation in place / planned | Residual action |
|---|------|------------|--------|-------------------------------|-----------------|
| R8 | Composite stage perceived as regression once users compare render-only vs full-bake timings | Med (UX) | Trust in progress UI | **ADR-0003 accepted**; new path will emit distinct honest chronos stages with frame-derived ratios (no fudging, no "magic" 2× numbers). Legacy paths unchanged. | Watch real-user bake wall times post-cut; keep stage labels descriptive. |
| R9 | Browser canvas blend + VideoEncoder round-trip produces visible differences from alphamerge (low-alpha glow tails, sub-pixel edges, color space, premul) | Med | User-visible edge quality regression on rich effects | Shared global-frame painter guarantees identical paint source; deterministic frame indices enable exact re-renders for comparison. New dedicated fidelity harness exercising the same indices used by the planner. Canvas blend uses same premul discipline as the overlay encoder today. Fallback always available. | Explicit visual side-by-side + alpha-edge QA on glow/dual-border clips before default-on. Document "production-grade but not bit-identical" in release notes. |
| R10 | Audio passthrough in browser muxer loses channels, drifts PTS, or produces unplayable containers vs FFmpeg stream-copy | Low | A/V desync or corrupt exports on voice-effected takes | Use the same base PTS/frame math; demuxer sample-accurate extraction + muxer timestamping. Harness asserts duration match + spot A/V alignment on exported files. | Add duration + container validation to all bake tests and the fidelity harness. |
| R11 | `VideoDecoder`/`VideoEncoder` capability or throughput varies (or regresses in Chrome) for base-MP4-sourced streams where the old FFmpeg path succeeded | Med | Slow bakes or silent fallback on some hardware/OS/driver combos | Extend the existing probe (`webcodecs-support.ts`) to a decode+encode round-trip on representative base content. Full fallback chain preserved (webcodecs → mediarecorder → drawtext). Honest error surfacing (no silent downgrade of rich effects). | Collect capability matrix on 2+ machines during spike/QA. Consider H10-style observability if real silent fallbacks appear post-rollout. |
| R12 | New composite surface + dep increases attack surface or maintenance burden | Low | Future breakage on Chrome or dep updates | Small tree-shaken dep; pure TS; all core logic (painter, planner, segment model) stays in-repo. FFmpeg composite path remains as permanent fallback. | Pin dep version; add a "force legacy composite" Lab toggle for regression sweeps. |

R1/R2 (alpha luma calibration, premul precision) become scoped to the MediaRecorder fallback paths only; the new path has its own blend semantics (R9).

## Verification & QA strategy for the new blend/composite surface

- **Fidelity harness (primary gate):** New or extended harness (Lab mode + script) that:
  - Uses identical `TranscriptResult` + style + base MP4.
  - Drives both paths (when both available) using the **exact same global frame indices** from the planner.
  - Extracts reference frames at cue starts/ends, overlaps, glow tails, and mid-clip using `VideoDecoder` + canvas snapshot (or equivalent) for the new path.
  - Performs side-by-side visual review + optional structural checks (luma histograms in overlay regions, alpha coverage at edges).
  - Asserts: output duration within 1 frame, frame count matches planner, no A/V duration drift > 1 frame, container is valid MP4 playable in Chrome.
- **Alpha/premultiply edge cases:** Dedicated clips with heavy glow (low-alpha tails), dual-border, semi-transparent layers over both light and dark base video regions. Compare against legacy where possible; accept and document deltas that are perceptually clean.
- **Timing alignment:** All progress and segment meta continue to use the global `(startFrame + i)/fps` contract. New stages report real work (e.g. `framesDecoded / totalFrames`, encoder `output` callbacks).
- **End-to-end contracts:** After a browser-composite bake:
  - `saveLastBakedMp4` + TakeManager stamp update succeed.
  - H6 verification (`takeArtifactMatchesStore`) passes at deck, attach, and recovery.
  - Reddit attach succeeds and plays with correct subs.
  - Re-bake (edit style) works.
- **Regression matrix:** Existing `test-*.mjs` (ivf, encoded-segment, alphamerge-args — the latter stays for fallback), plus new pure-TS tests for any mux helpers. Force-legacy toggle in Overlay Lab for periodic sweeps. Multi-machine timing + visual on at least two distinct encoder/decoder profiles.
- **Chronos honesty (non-negotiable):** No ratio math that makes the new path "look" faster than the work justifies. Distinct stage strings so logs and UI always attribute cost correctly. Creep only for phases without observable progress events.

The MediaRecorder + drawtext full chain must continue to produce correct artifacts (unchanged code paths).

## Explicit non-goals and out-of-scope

- Pixel-identical or "alphamerge-equivalent" output with the prior composite (explicitly deprioritized).
- Removal or deprecation of FFmpeg for the project (voice transcode, MediaRecorder fallback composite, drawtext burn-in, and offscreen orchestration remain).
- Immediate worker offload of the composite loop (the encode leg remains page-hosted for v5.5 cut; workerization is a natural follow-up).
- User-facing codec, quality, or "use hardware" toggles.
- Changing the base MP4 production, audio voice-effect application, or single-slot IDB model.
- Automatic re-bake of historical takes.
- Container-level subtitle tracks, multi-video tracks, or advanced ISO features.
- Supporting every possible base MP4 variant produced by future transcode changes (pin to what our pipeline emits).
- Hand-rolled muxer or avoidance of a small modern dependency.

## References

- Code (current): `src/encoding/*` (encoded-segment, ivf, overlay-webcodecs-encoder, webcodecs-support), `src/transcription/subtitle-overlay-webcodecs.ts` + `subtitle-overlay-renderer.ts` (createOverlayFramePainter + global frame), `src/ui/design-studio/subtitle-canvas-bake.ts` + `subtitle-bake.ts`, `src/ffmpeg/subtitle-burnin.ts` (buildWebCodecsOverlayStrategies), `src/ffmpeg/overlay-alphamerge-args.ts`, `src/ffmpeg/burnin-client.ts` + `ffmpeg-runner.ts` (the hop being removed for primary path), `src/storage/last-baked-mp4-db.ts`, `src/session/take-manager.ts`.
- Docs: ADR-0001 (option 4 + follow-ups + "this ADR's segment backbone is the prerequisite"), `docs/5.3.10-webcodecs-per-chunk-encoding.md` (esp. §0 as-built and design principles), `docs/architecture/hardening-backlog.md` (H9 + R8), this map, `docs/transcription-architecture.md`, `docs/engineering-principles.md` (semantic progress), `docs/design-studio.md` §3.3 (preview↔bake).
- QA artifacts: `.ignore/sub-QA-5.3.10/` (composite timing breakdown), Overlay Lab, `scripts/test-*.mjs` (ivf, overlay-alphamerge-args, encoded-segment, bake chronos helpers).
- Future dep: mediabunny (for demux/mux + WebCodecs interop).

This record is the decision. Implementation will cite it; the stub is superseded.
