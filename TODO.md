# TODO

## Current: v5.8.0 — Timeline Visual Subtitle Editor — **SHIPPED & TAGGED** `v5.8.0`

**Design (as-built):** [`docs/v5.8.0-trim-ui-visual-subtitle-editor.md`](docs/v5.8.0-trim-ui-visual-subtitle-editor.md) (authoritative) · **Scope:** [`docs/v5.8.0-scope.md`](docs/v5.8.0-scope.md) · **Release notes:** [`docs/release-notes-v5.8.0.md`](docs/release-notes-v5.8.0.md)
**Merged** `feature/v5.8.0-trim-ui-visual-subtitle-editor` → `main` (2026-07-10) · **Package:** `5.8.0` · **Push:** deferred (user pushes `main` + tags)

Visual timeline cue editor over the v5.6 / v5.7 editing backend: DOM (not canvas) bars, timeline-primary + List toggle, stage-mode zoom + minimap, waveform lane, hysteresis snap + guides, keyboard nudge / undo / multi-select, on-bar smart suggestions, non-destructive ✂ trim **intent** (`planTrim`). All 10 sprints done; Sprints 3–9 real-browser QA **PASS**. Full sprint log: [`claude-progress.md`](claude-progress.md).

## ▶ Next (open) — atomic trim **apply** (own branch)

The one open thread. Stored `edits.trim` intent from v5.8.0 is **inert** until this ships:

- Wire `applyTrimToMp4` into the bake / artifact path (mediabunny `Conversion` already exists, unwired).
- Automatic subtitle-cue / transcript shift onto the post-trim timeline.
- H6 re-stamp of the trimmed artifact + restore story for pre-apply bytes.
- Own real-browser QA gate: keep-duration matches bake/download + cue shift + revert.

## Shipped ledger

Full milestone index with living + archived doc pointers: [`docs/HISTORY.md`](docs/HISTORY.md).

| Version | Focus | More |
|---------|-------|------|
| **v5.8.0** | Timeline visual subtitle editor (this milestone) | ↑ above |
| **v5.7.0** | Partial re-bake splice (Phase 2b) — default-on | [notes](docs/release-notes-v5.7.0.md) |
| **v5.6.0** | Audio decoupling + voice re-apply + editing/timeline backend | [notes](docs/release-notes-v5.6.0.md) |
| **v5.5.0 / v5.5.1** | Browser-side full composite + default-on | [HISTORY](docs/HISTORY.md) |
| **v5.4.0** | Design Studio First (standalone suite + Take lifecycle) | [HISTORY](docs/HISTORY.md) |
| **≤ v5.3.10** | WebCodecs backbone → v1.0.0 MVP | [HISTORY](docs/HISTORY.md) / `archive/` |

**Restore any time:** `git checkout main && npm install && npm run dev`

## Architecture hardening

Last full `/architecture-hardening` pass at v5.4.0; docs carried forward through v5.6.0 — **map v2.3 · extension-points v1.5 · hardening backlog v2.3 · ADRs 0001–0005**. Re-run before the next major refactor or on a new execution context / message-pipeline family / storage class (triggers in [`docs/architecture/README.md`](docs/architecture/README.md)). Ranked items + risk register: [`docs/architecture/hardening-backlog.md`](docs/architecture/hardening-backlog.md).
