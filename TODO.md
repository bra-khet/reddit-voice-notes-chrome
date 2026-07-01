# TODO

## v5.3.4 — Subtitle canvas overlay (`feature/v5.3.4-subtitle-canvas-overlay`)

- [ ] **Halo diffusion polish** — soft halo renders but is too sharp / too close to hard-border style. Tune canvas glow in `subtitle-overlay-renderer.ts` (`paintGlowText`): try `buildGlowLayerSpecs(..., 'full')` on canvas-only path and/or hybrid `shadowBlur` under duplicate layers. Re-run compare harness vs drawtext. See `docs/v5.3.4-subtitle-canvas-overlay.md` Open items.
- [ ] **Phase 4** — Wire canvas overlay into `subtitle-burnin.ts` (`useCanvasOverlay`, `buildCanvasOverlayStrategy`, strategy selection, dev full-pipeline bake button).
- [ ] **Phase 5** — Progress callbacks, performance guard, Subtitle Overlay Lab panel, `docs/transcription-architecture.md` sync, 15+ cue QA.