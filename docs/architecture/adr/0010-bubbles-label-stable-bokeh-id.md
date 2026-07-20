# ADR-0010: Bubbles public label retains the `bokeh` stability key

- **Status:** Accepted
- **Date:** 2026-07-14
- **Reflects branch/tag:** `feature/v6.0.0-custom-styles-refactor` @ Phase 2 Classic-Neon entry milestone
- **Deciders:** user naming amendment + v6 Track A implementation session
- **Supersedes:** ADR-0009 only where it kept Bokeh as the public label; its replacement algorithm, density cap, record-time rendering, and appearance-break decisions remain Accepted.

## Context

Phase 1 rebuilt the old `bokeh` placeholder as a strong soft-orb/depth effect. Browser QA passed, but the result reads more naturally as bubbles than photographic bokeh. The persisted value already appears in saved v5/v6 style fields, background theme types, and registry dispatch. The user's governing rule is that legacy matters when it protects project stability, not when it preserves an obsolete feature set or appearance.

## Decision

Present the effect everywhere as **Bubbles**, centralized through `BUBBLES_OVERLAY_LABEL`, while retaining `bokeh` as the serialized theme/registry ID and `midnight-bokeh` as the bundled theme ID. Existing styles therefore keep resolving to the new v6 algorithm without a preference migration, adapter renderer, or old-feature compatibility path.

## First-class concern impact

- **Preview ↔ bake:** None. Only discovery/display text changes; preview and capture still call the same registry definition on the record-time canvas.
- **Effect composition:** None. Bubbles remains the overlay/background orb field below the spectrum layer.
- **Message contracts:** None. No message family or payload changes.
- **State ownership:** The existing `bokeh` value remains durable preference truth. No store, signal, version bump, alias field, or migration is introduced.

## Options considered

1. **Public Bubbles label + stable `bokeh` key (accepted)** — correct user language with zero persisted-state break and no migration surface.
2. **Rename the key to `bubbles` and migrate/alias `bokeh`** — cleaner internal spelling, but creates migration theater and two accepted IDs without user value.
3. **Rename key and intentionally break saved styles** — allowed for appearance in v6, but unnecessary for stability; a missing effect is a project failure rather than a creative redesign.
4. **Keep Bokeh everywhere** — technically cheapest, but knowingly mislabels the effect users see.

## Consequences

- **Positive:** UI language matches the visual; future registry-driven pickers inherit one public label; saved styles remain stable while still receiving the opinionated v6 algorithm.
- **Negative / accepted cost:** Internal symbols/files continue to say `bokeh`, so contributors must distinguish public label from serialized ID. This is documented rather than hidden behind an alias layer.
- **Follow-ups:** Tests must assert registry label `Bubbles`; current docs say Bubbles and identify `bokeh` only when discussing storage/code. A future intentional schema break may rename the key, but v6 does not need one.

## References

- Code: `src/theme/audio-reactive/catalog.ts`; `src/theme/audio-reactive/overlays/bokeh.ts`; `src/ui/design-studio/effect-controls.ts`; `src/ui/design-studio/studio-section-summaries.ts`; `src/theme/presets.ts`
- Docs: `docs/v6.0.0-custom-styles-refactor.md`; ADR-0007; ADR-0009
- Bugs: none — user-facing naming amendment after Phase 1 browser QA
