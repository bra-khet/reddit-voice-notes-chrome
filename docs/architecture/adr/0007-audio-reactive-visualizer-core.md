# ADR-0007: Audio-reactive visualizer core (generalized spectrum + simulation layer)

- **Status:** Proposed
- **Date:** 2026-07-14
- **Reflects branch/tag:** `feature/v6.0.0-custom-styles-refactor` (from `main@98c37ab`, v5.11.0)
- **Deciders:** v6 planning session (roadmap synthesis)

## Context

v6 "Polish & Visual Maturity" replaces the ad-hoc waveform bar loop and the two hard-coded overlays (`sparkle`, `bokeh`) with a generalized, audio-reactive visual system: six curated spectrum presets + a simulation backbone (spatial grid, agents, stackables). Trigger: `docs/v6.0.0-custom-styles-refactor.md` (synthesized from supplemental-A + supplemental-B); README update-trigger "new visual effect touching preview=bake."

Constraints (honest): MV3, Canvas 2D only (no WebGL/WASM/new deps), and — the binding one — visuals are **captured into the WebM at record time** and transcoded, so high-entropy effects inflate the encoded MP4 toward `LAST_BASE_MP4_MAX_BYTES` (25 MB) / `LAST_BAKED_MP4_MAX_BYTES` (30 MB) on 120 s clips. The audio pipeline needed already exists: `WaveformRenderer`'s `AnalyserNode` + `computeBandValues` (32 bands) + `smoothedAudioEnergy` (`src/recorder/waveform.ts`).

## Decision

Introduce `src/theme/audio-reactive/` with a preset **registry** and a shared `AudioVizFrame` carrier. Two draw seams are generalized: the **spectrum layer** replaces the 32-bar loop (`waveform.ts:418`); the **overlay layer** generalizes `drawDesignEffectOverlays` (`backgrounds.ts:336`). Legacy `sparkle`/`bokeh` become thin registry adapters (migration-safe). Presets/params persist in an extended `DesignOverrides`, fully `normalize`-guarded, with **no `USER_PREFS_VERSION` bump**. A performance governor (density slider + semantic warnings + hard caps) protects both CPU smoothness and encoded size.

## First-class concern impact

- **Preview ↔ bake:** Visuals are record-time capture; the Studio preview (`renderThemePreview`) has no live audio, so reactive presets render **representatively** (synthetic energy/bands) while capture is truly reactive. This is an honest, documented fidelity gap (rainbow→stepped precedent), not a violation of I1 — the recorder canvas *is* the export. Classic (Neon Glow) must reproduce pre-v6 bars pixel-for-pixel so no-change users see no change.
- **Effect composition:** No new compositing layer — the two existing seams (bars, overlays) are generalized in place. Order unchanged: background → overlay simulation → spectrum → (post) subtitles. Candidate invariant **I22**.
- **Message contracts:** None. Pure client-side draw; no new `MSG_*` family, no relay.
- **State ownership:** No new store/signal. Extends `DesignOverrides` in the existing IDB-backed prefs (ADR-0006); `normalizeDesignOverrides` guards all new optional fields.

## Options considered

1. **Generalized registry + two seams (this ADR)** — zero new deps, migration via adapters, reuses existing audio + persistence. Cost: careful parity work on Classic-Neon + a size-QA harness.
2. **Per-preset bespoke draw functions** (like today's sparkle/bokeh, N copies) — simplest per preset, but copy-paste explosion for High-Contrast/Layout variants; rejected by supp-A/B's zero-duplication goal.
3. **WebGL/GPU visualizer** — richer effects, but violates the no-new-heavy-dep constraint, complicates the capture canvas, and risks the preview=bake surface. Rejected.
4. **Do nothing** — bars/overlays stay ad-hoc; v6 visual maturity blocked.

## Consequences

- **Positive:** future presets = register a factory; shared High-Contrast/Layout/afterimage/band-weighting; legacy styles render unchanged; the audio pipeline is reused, not rebuilt.
- **Negative / accepted cost:** we deliberately do **not** build WebGL, free-form user style authoring (v6.1), or a bake-time re-render (visuals stay record-time). We accept a representative (not live) preview for reactive presets, and we cap density/stackables (≤3) rather than allowing unbounded composition — the size cap makes unbounded effects a real footgun, not a theoretical one.
- **Follow-ups:** extension-points v1.16 (audio-reactive seam), map v3.2 + I22, 120 s size-QA harness gating every preset, possible ADR-0009 if Boids/simulation cost modeling grows structural.

## References

- Code: `src/recorder/waveform.ts:363,418`, `src/theme/backgrounds.ts:336`, `src/theme/design-overrides.ts:19,45,100`, `src/theme/sparkle.ts`, `src/theme/bokeh.ts`, `src/storage/last-base-mp4-db.ts:12`, `src/storage/last-baked-mp4-db.ts:12`
- Docs: `docs/v6.0.0-custom-styles-refactor.md`; architecture-map §3.2, I1/I3; `docs/engineering-principles.md` § pipeline-native; ADR-0006 (prefs normalize precedent)
- Bugs: R18 prefs-gate class (normalize footgun)
