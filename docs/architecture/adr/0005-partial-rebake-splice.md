# ADR-0005: Partial re-bake splice — keyframe-aligned smart-render with a self-verifying fidelity gate

- **Status:** Accepted — **shipped default-on** in `v5.7.0` after real-browser QA sign-off (AVC + VP9, single machine 2026-07-08). Opt-out: `experimental.partialRebakeSplice: false`.
- **Date:** 2026-07-08
- **Reflects:** `main` @ `v5.7.0` (from `feature/5.7.0-partial-rebake-splice`, baseline `v5.6.0`)
- **Deciders:** User strategic direction (Phase 2b execution + default-on) + architecture decision (this record)
- **Extends:** ADR-0004 §Follow-ups ("Phase 2b splice execution behind `coordinateRebake`"), ADR-0003 (browser composite), ADR-0001 (encoding backbone; the v5.3.9.1 honesty lesson)

## Context

v5.6.0 shipped the partial re-bake **planner** (`partial-rebake-coordinator.ts`) + telemetry, but `coordinateRebake` always executed a **full** browser composite and honestly reported `executed:'full'` — execution was deferred to avoid claiming composite-ready output without a construction-level guarantee (the v5.3.9.1 lesson). Phase 2b is that execution: when a cue edit dirties only a few keyframe-aligned regions, re-composite **only** those regions and splice them into the previous baked MP4 instead of re-compositing the whole clip.

The pipeline's baked MP4s are 1 packet/frame with strictly increasing PTS in decode order (no B-frames), keyframes pinned at `BROWSER_COMPOSITE_KEYFRAME_INTERVAL_SECONDS = 2 s`. That makes packet-level "smart rendering" feasible — but two problems had to be solved to keep it honest:

1. **The planner reasons on an ASSUMED 2 s grid; the encoder's REAL keyframes may drift off it.** A splice may only replace whole GOPs, cutting on real keyframe boundaries.
2. **An MP4 video track carries ONE sample description (`avcC`).** Copying kept AVC packets bit-exact while splicing in freshly re-encoded AVC packets puts two independently-produced SPS/PPS under one `avcC` — decodable only if compatible. VP9 keyframes are self-contained and splice cleanly; AVC is the hazard.

## Decision

1. **Separate intent from physical layout.** The coordinator's grid spans are *intent*; a new pure module `src/editing/splice-plan.ts` re-projects them onto the artifact's **real** keyframe frame indices (`scanKeyframes` gate rejects reordered/VFR/no-leading-keyframe streams → full fallback), building contiguous `keep`/`reencode` regions and validating them (`validateSplicePlan`: every cut on a real keyframe; `validateSpliceOutput`: `kept + reencoded == output == expected` packet count, ≤1-frame drift). Node-tested.

2. **Dirty regions re-composite from the CLEAN base, not the baked frames.** The baked MP4's edited region still carries the OLD burned-in subtitle, so `renderCompositeSplice` (`src/composite/composite-splice.ts`) takes BOTH inputs: kept packets copied bit-exact from `bakedMp4`; dirty regions decoded from `baseMp4` (`VideoSampleSink.samples(range)`), repainted with the new cues (shared painter at exact global PTS), re-encoded with a forced keyframe at each region start and stamped with the baked region's PTS for a seamless splice.

3. **A self-verifying fidelity gate makes the avcC hazard SAFE regardless of theory.** After assembly, `verifySpliceKeptFrames` decodes the spliced output and the original at kept-region anchors and asserts they are **pixel-identical** (kept packets are byte-exact, so any difference IS the corruption signal), plus boundary-frame decodability. A miss throws → `coordinateRebake` falls back to the full composite. This converts "the SPS/PPS probably match" into "verified decodable-and-identical, or discarded."

4. **Honesty preserved.** `coordinateRebake(plan, full, splice?)` reports `executed:'partial'` ONLY when the fidelity-verified splice returns bytes; `null` / non-abort throw / fidelity rejection all fall back to full (`'full'`). `AbortError` propagates. Distinct chronos stages `partial-splice-{scan,reencode,assemble}` from real counters. Shipped behind `experimental.partialRebakeSplice` (default **ON** after QA; opt-out `false`).

## First-class concern impact

- **Preview ↔ bake:** dirty regions are painted by the *same* `createOverlayFramePainter` at the same global PTS as the full composite — a spliced region is pixel-equivalent to a full re-bake of that region by construction.
- **Fallback chain (I1):** untouched. `runFullComposite` still wraps browser composite → WebCodecs+alphamerge → MediaRecorder → drawtext; the splice sits *in front* and delegates to it on any miss.
- **Message contracts / state ownership:** none added. Splice runs entirely on the Studio page; the baked artifact + take snapshot are the only outputs, exactly as a full bake.
- **H6:** the spliced blob is written through the same `saveLastBakedMp4` + `updateFromBake` path as a full bake; stamps refresh identically.

## Options considered

1. **Chosen: keyframe-aligned packet splice from clean base + kept baked packets, gated by kept-region pixel-equality.** Saves ~(1 − coverage) of composite time on small edits; correctness guaranteed at runtime, not assumed. Cost: an extra decode-back pass over a handful of anchor frames; AVC relies on the gate (VP9 is inherently safe).
2. **Re-encode the whole clip but skip painting clean regions.** No SPS/PPS hazard, but still decodes+encodes every frame — no real saving. Rejected.
3. **Restrict splice to VP9 artifacts (self-contained keyframes).** Sound without a decode-back gate, but our default output is AVC (Reddit-proven); would exclude the common case. Kept as a natural default-on candidate *after* QA rather than a restriction.
4. **Ship execution now, default-on.** Repeats the v5.3.9.1 mistake — claims composite-ready output before real-browser proof. Rejected: flag stays off until QA.

## Consequences

- **Positive:** small cue edits re-bake in time proportional to the dirty fraction; the `splice-plan` layer + fidelity gate are reusable for any future segment-level artifact editing (trim re-composite, per-cue restyle). The intent/physical split lets the physical layer *reject* artifacts the planner's assumptions don't fit.
- **Negative / accepted cost:** two independently-produced `avcC` parameter sets share one track — mitigated (artifact's own codec string + original-config anchor) and **verified** (kept-region pixel-equality), never merely assumed. Buffering all video packets holds the clip in memory (≤30 MB store cap — same budget as the full composite's `BufferTarget`).
- **Rejected over-engineering:** no worker offload (measure first); no new stores/messages; no default-on before QA.
- **Follow-ups:** real-browser QA **SIGNED OFF** 2026-07-08 (A–E, C1 AVC + C2 VP9 on one machine; VP9 required `latencyMode:realtime` to avoid alt-ref scan reject). Default-on in `v5.7.0`. Optional: second-machine A2 spot-check. Phase 3 trim-apply integration remains separate.

## References

- Code: `src/editing/splice-plan.ts` (pure; `scanKeyframes`, `planSplice`, `selectSpliceFidelityAnchors`, `validateSplicePlan`, `validateSpliceOutput`), `src/composite/composite-splice.ts` (`renderCompositeSplice`), `src/composite/composite-fidelity.ts` (`verifySpliceKeptFrames`), `src/editing/partial-rebake-coordinator.ts` (`coordinateRebake`), `src/ui/design-studio/subtitle-bake.ts` (`bakeWithOptionalSplice`), `src/settings/user-preferences.ts` (`partialRebakeSplice` flag)
- Docs: `archive/docs/pre-v6.0.0/designs/v5.6.0-audio-decoupling.md` §4.2 (+ §12 as-built + QA checklist), ADR-0004 (voice re-apply; the sibling remux primitive), ADR-0003 (browser composite; painter/audio-passthrough patterns reused), ADR-0001 (encoding backbone; honesty lesson)
- Tests: `scripts/test-splice-plan.mjs` (33), `scripts/test-partial-rebake-plan.mjs` (13)
