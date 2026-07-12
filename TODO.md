# TODO

## Current: v5.10.0 — Raw Trim Apply — **SHIPPED · real-browser QA PASS (2026-07-12) · tagged `v5.10.0`**

**Design (as-built):** [`docs/v5.10.0-raw-trim-apply-roadmap.md`](docs/v5.10.0-raw-trim-apply-roadmap.md) · **Release notes:** [`docs/release-notes-v5.10.0.md`](docs/release-notes-v5.10.0.md)  
**Package:** `5.10.0` · **Push:** deferred (user pushes)

Trim keeps the voice: **Apply trim** also cuts the raw capture WebM (audio-only, mediabunny, sample-accurate Opus) and re-stamps `baseRecording` in the same atomic write — post-trim **voice re-apply / Change Voice** work. Raw-leg failure demotes honestly to the v5.9 lock. Node: timeline 22 · take-manager 34; build + tsc clean. Real-browser checklist **all PASS** (incl. raw-leg store-mismatch fallback).

## ▶ Next — **v6.0 "Polish & Visual Maturity"** (unscoped)

Background / bar-style refresh + accumulated micro-interactions/a11y from the v5 arc ([`docs/v5.9.0-trim-apply-roadmap.md`](docs/v5.9.0-trim-apply-roadmap.md) §9). Optional: run `/docs-archiving` Refresh #3 to archive through v5.10.0.

**Also open (lower priority):** architecture **H13** (acknowledged store writes — v5.10 added a bounds pre-check at the trim raw leg only) · **H8** (recovery voice provenance).

## Shipped ledger

Full milestone index with living + archived doc pointers: [`docs/HISTORY.md`](docs/HISTORY.md).

| Version | Focus | More |
|---------|-------|------|
| **v5.10.0** | Raw WebM trim — post-trim voice re-apply — **QA PASS · tagged** | [notes](docs/release-notes-v5.10.0.md) |
| **v5.9.0** | Atomic trim apply — **tagged** | [notes](docs/release-notes-v5.9.0.md) |
| **v5.8.0** | Timeline visual subtitle editor | [notes](archive/docs/release-notes-v5.8.0.md) |
| **v5.7.0** | Partial re-bake splice (Phase 2b) — default-on | [notes](archive/docs/release-notes-v5.7.0.md) |
| **v5.6.0** | Audio decoupling + voice re-apply + editing/timeline backend | [notes](archive/docs/release-notes-v5.6.0.md) |
| **v5.5.0 / v5.5.1** | Browser-side full composite + default-on | [HISTORY](docs/HISTORY.md) |
| **v5.4.0** | Design Studio First (standalone suite + Take lifecycle) | [HISTORY](docs/HISTORY.md) |
| **≤ v5.3.10** | WebCodecs backbone → v1.0.0 MVP | [HISTORY](docs/HISTORY.md) / `archive/` |

**Restore any time:** `git checkout main && npm install && npm run dev`

## Architecture hardening

Living docs updated in-place for v5.10.0 — **map v2.7 · extension-points v1.9 · hardening backlog v2.5 · ADRs 0001–0005** (no new seam/context/store/message, so no full re-run needed). Top hardening: **H13** acknowledged artifact persistence (High/S), then **H8** recovery voice provenance (Med/S); H12 is resolved. Re-run before the next major refactor or on a new execution context / message family / storage class (triggers in [`docs/architecture/README.md`](docs/architecture/README.md)).
