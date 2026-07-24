# ADR-0009: Registry-native Sparkle and Bokeh replace placeholder visuals

- **Status:** Accepted
- **Date:** 2026-07-14
- **Reflects branch/tag:** `feature/v6.0.0-custom-styles-refactor` @ Phase 1
- **Deciders:** user-directed Track A Phase 1 sprint
- **Supersedes:** ADR-0007 only where it required legacy Sparkle/Bokeh adapters and appearance compatibility; the carrier, two draw seams, record-time capture, persistence, and performance decisions remain Accepted.

## Context

ADR-0007 originally treated the pre-v6 `sparkle.ts` and `bokeh.ts` implementations as compatibility targets. The user clarified that both were rudimentary placeholders and explicitly authorized a v6 appearance break: do not port or pixel-match their math, do not build migration theater, and instead make both names worthy Canvas-2D effect families. The binding constraints remain record-time capture, normalized `AudioVizFrame` input, no WebGL/WASM/new dependency, and bounded entropy/CPU under the 25 MB base / 30 MB baked caps.

## Decision

Keep the stable registry IDs and labels `sparkle` / `bokeh`, delete the placeholder implementations, and rebuild both as deterministic registry-native overlays. Sparkle is a capped twinkle/mote particle field (18–64 elements); Bokeh is a capped soft-lens depth/parallax field (5–14 orbs) with a bounded photographic backdrop. Saved styles may load those IDs but intentionally render the new v6 appearance.

## First-class concern impact

- **Preview ↔ bake:** Both use the same per-canvas registry runtime and `AudioVizFrame`; Studio remains representative/synthetic while record-time capture is truly reactive. No bake-time visual renderer is added.
- **Effect composition:** The existing overlay slot is generalized in place under the spectrum/bars. No fourth layer or order change.
- **Message contracts:** None. Rendering stays in-page and synchronous with the canvas frame.
- **State ownership:** `DesignOverrides` gains normalized optional preset/parameter fields in existing prefs IDB truth. No store, signal, writer, or `USER_PREFS_VERSION` change.

## Options considered

1. **Registry-native replacement (chosen)** — stable user-facing names, materially stronger visuals, shared future-facing runtime/params, deterministic density caps.
2. **Legacy adapters from ADR-0007** — cheap compatibility, but preserves placeholder quality and spends Phase 1 on pixels the v6 product no longer wants.
3. **Rename/remove both effects** — clean break, but creates needless UI and saved-ID churn without improving the algorithms.
4. **WebGL or a bake-time renderer** — richer ceiling, but violates the accepted dependency/compositing constraints and expands the preview/export risk surface.

## Consequences

- **Positive:** Sparkle/Bokeh now prove the actual registry lifecycle; stable spatial seeds improve visual coherence and encoded compressibility; labels/families/defaults/element ceilings are discoverable for the future Style panel and governor.
- **Negative / accepted cost:** v6 changes the appearance of saved Sparkle/Bokeh styles. Browser visual and 120-second encoded-size QA remain required before release; automated caps do not prove device FPS or file size.
- **Follow-ups:** Phase 2 migrates Classic/Neon into the spectrum registry; land the 120-second size harness alongside it. `SpatialPartition<T>` waits for the first neighbor-querying Phase 3 preset rather than shipping unused.

## References

- Code: `src/theme/audio-reactive/index.ts`; `src/theme/audio-reactive/overlays/sparkle.ts`; `src/theme/audio-reactive/overlays/bokeh.ts`; `src/theme/backgrounds.ts`; `src/theme/design-overrides.ts`
- Tests: `scripts/test-audio-frame.mjs`; `scripts/test-overlay-visuals.mjs`; `scripts/test-design-overrides-v6.mjs`
- Docs: `archive/docs/v6.0.0-checkpoint/track-roadmaps/v6.0.0-custom-styles-refactor.md`; architecture map I22; ADR-0007
