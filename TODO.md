# TODO

## Current: v5.9.0 — Atomic Trim Apply — **SHIPPED / TAGGED `v5.9.0` (2026-07-11)**

**Design (as-built):** [`docs/v5.9.0-trim-apply-roadmap.md`](docs/v5.9.0-trim-apply-roadmap.md) · **Release notes:** [`docs/release-notes-v5.9.0.md`](docs/release-notes-v5.9.0.md)  
**Package:** `5.9.0` · **Push:** deferred (user pushes)

Trim actually cuts: **Apply trim** → shorter `baseMp4` + cue shift (both transcript copies) + H6 re-stamp (`bakedMp4`/`baseRecording` dropped). Real-browser QA **PASS**. Post-QA: Reddit panel same-take promote fix; trim OUT fractional-duration floor.

## ▶ Next (open) — post-v5.9 candidates

[Trimming the raw capture WebM](docs/v5.10.0-raw-trim-apply-roadmap.md) (planning only; restores post-trim voice changes) · unique “voice locked after trim” copy if a UI rework wants it (current gray-out is correct) · **v6.0 "Polish & Visual Maturity"** arc (roadmap §9).

## Shipped ledger

Full milestone index with living + archived doc pointers: [`docs/HISTORY.md`](docs/HISTORY.md).

| Version | Focus | More |
|---------|-------|------|
| **v5.9.0** | Atomic trim apply — **tagged** | [notes](docs/release-notes-v5.9.0.md) |
| **v5.8.0** | Timeline visual subtitle editor | [notes](archive/docs/release-notes-v5.8.0.md) |
| **v5.7.0** | Partial re-bake splice (Phase 2b) — default-on | [notes](archive/docs/release-notes-v5.7.0.md) |
| **v5.6.0** | Audio decoupling + voice re-apply + editing/timeline backend | [notes](archive/docs/release-notes-v5.6.0.md) |
| **v5.5.0 / v5.5.1** | Browser-side full composite + default-on | [HISTORY](docs/HISTORY.md) |
| **v5.4.0** | Design Studio First (standalone suite + Take lifecycle) | [HISTORY](docs/HISTORY.md) |
| **≤ v5.3.10** | WebCodecs backbone → v1.0.0 MVP | [HISTORY](docs/HISTORY.md) / `archive/` |

**Restore any time:** `git checkout main && npm install && npm run dev`

## Architecture hardening

Full `/architecture-hardening` pass completed at tagged v5.9.0 — **map v2.6 · extension-points v1.8 · hardening backlog v2.5 · ADRs 0001–0005**. Top hardening: **H13** acknowledged artifact persistence (High/S), then **H8** recovery voice provenance (Med/S); H12 is resolved. Re-run before the next major refactor or on a new execution context / message family / storage class (triggers in [`docs/architecture/README.md`](docs/architecture/README.md)).
