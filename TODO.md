# TODO

## Current: v5.9.0 — Atomic Trim Apply — **CODE COMPLETE on `feature/v5.9.0-trim-apply`; real-browser QA gates merge/tag**

**Design (living, as-built):** [`docs/v5.9.0-trim-apply-roadmap.md`](docs/v5.9.0-trim-apply-roadmap.md) (authoritative) · **Release notes (draft):** [`docs/release-notes-v5.9.0.md`](docs/release-notes-v5.9.0.md)
**Package:** `5.9.0` · **Push:** deferred (user pushes)

Trim now actually cuts: **Apply trim** (two-click confirm) in the timeline trim strip → H6-verified shorter `baseMp4` + cue shift mirroring the ghost preview (both transcript copies — revert stays honest) + atomic take re-stamp (`bakedMp4`/`baseRecording` stamps dropped: re-bake needed, voice locked in) via new `src/editing/trim-apply.ts`. No new seam. Phases 0–2 done; sprint log in [`claude-progress.md`](claude-progress.md).

## ▶ Next (open) — v5.9.0 real-browser QA gate (user)

Checklist: roadmap §7 / release-notes QA table. Key rows: apply happy-path duration + cue positions vs ghosts · post-apply bake is a FULL composite with subs on the new timeline · voice-change after apply fails honestly · revert/undo cannot resurrect pre-trim times · deck/Download/attach serve the trimmed base · v5.8 editor + splice regression. Then merge → `main`, tag `v5.9.0`.

After that (candidates): `/docs-archiving` Refresh #2 · trimming the raw capture WebM (restores post-trim voice changes) · **v6.0 "Polish & Visual Maturity"** arc (roadmap §9).

## Shipped ledger

Full milestone index with living + archived doc pointers: [`docs/HISTORY.md`](docs/HISTORY.md).

| Version | Focus | More |
|---------|-------|------|
| **v5.9.0** | Atomic trim apply (this milestone — QA pending) | ↑ above |
| **v5.8.0** | Timeline visual subtitle editor | [notes](docs/release-notes-v5.8.0.md) |
| **v5.7.0** | Partial re-bake splice (Phase 2b) — default-on | [notes](docs/release-notes-v5.7.0.md) |
| **v5.6.0** | Audio decoupling + voice re-apply + editing/timeline backend | [notes](docs/release-notes-v5.6.0.md) |
| **v5.5.0 / v5.5.1** | Browser-side full composite + default-on | [HISTORY](docs/HISTORY.md) |
| **v5.4.0** | Design Studio First (standalone suite + Take lifecycle) | [HISTORY](docs/HISTORY.md) |
| **≤ v5.3.10** | WebCodecs backbone → v1.0.0 MVP | [HISTORY](docs/HISTORY.md) / `archive/` |

**Restore any time:** `git checkout main && npm install && npm run dev`

## Architecture hardening

Last full `/architecture-hardening` pass at v5.4.0; docs refreshed through v5.9.0 — **map v2.5 · extension-points v1.7 · hardening backlog v2.4 · ADRs 0001–0005**. Re-run before the next major refactor or on a new execution context / message-pipeline family / storage class (triggers in [`docs/architecture/README.md`](docs/architecture/README.md)). Ranked items + risk register: [`docs/architecture/hardening-backlog.md`](docs/architecture/hardening-backlog.md).
