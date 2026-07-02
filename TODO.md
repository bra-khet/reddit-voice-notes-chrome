# TODO

## v5.3.4 — Subtitle canvas overlay

**Branch:** `feature/v5.3.4-subtitle-canvas-overlay`  
**Source of truth:** [`docs/v5.3.4-subtitle-canvas-overlay.md`](docs/v5.3.4-subtitle-canvas-overlay.md) (phases, specs, checklists)  
**Session log:** [`claude-progress.md`](claude-progress.md) (v5.3.4 entry at top)

| Phase | Status |
|-------|--------|
| 1–3 | DONE (`2c8c450` … `2334c6b`) |
| **3.5 — canvas visual polish** | **IN PROGRESS** (3.5.5 impl → QA; 3.5.4 deferred) |
| 4 — burn-in integration | after 3.5 |
| 5 — lab panel, perf guard, arch docs | pending |

### Phase 3.5 (summary — see design doc for full spec)

1. Halo diffusion — **done** (integral normalize `324ab90`)
2. Dual contrasting border — **done** (opacity + long-cue clip polish)
3. Text gradient + wave — QA pass (`5.3.4-gradient-wave`)
4. Backdrop rounding — deferred (visual QA pass)
5. Rainbow / monochromatic hue rotate — impl → QA

### Restore / test

```bash
git checkout feature/v5.3.4-subtitle-canvas-overlay && npm install && npm run dev
```

Design Studio → Subtitles → DEV harness. Record on Reddit first for compare drawtext side.