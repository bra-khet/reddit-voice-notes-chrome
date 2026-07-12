# TODO

## Current stable — **v5.10.0 Raw Trim Apply** (SHIPPED · real-browser QA PASS 2026-07-12 · tagged `v5.10.0`)

**Design (as-built):** [`docs/v5.10.0-raw-trim-apply-roadmap.md`](docs/v5.10.0-raw-trim-apply-roadmap.md) · **Release notes:** [`docs/release-notes-v5.10.0.md`](docs/release-notes-v5.10.0.md)  
**Package:** `5.10.0` · **Push:** deferred (user pushes)

Trim keeps the voice: **Apply trim** also cuts the raw capture WebM (audio-only, mediabunny, sample-accurate Opus) and re-stamps `baseRecording` in the same atomic write — post-trim **voice re-apply / Change Voice** work. Raw-leg failure demotes honestly to the v5.9 lock. Node: timeline 22 · take-manager 34; build + tsc clean. Real-browser checklist **all PASS**.

## ▶ Next — **v6.0 "Polish & Visual Maturity"** (unscoped)

Background / bar-style refresh + accumulated micro-interactions/a11y from the v5 arc ([`docs/v5.9.0-trim-apply-roadmap.md`](docs/v5.9.0-trim-apply-roadmap.md) §9).

**Also open (lower priority):** architecture **H13** (acknowledged store writes — v5.10 bounds pre-check is trim-raw-leg only) · **H8** (recovery voice provenance). Optional `/architecture-hardening` when ready.

## Shipped ledger

Full milestone index with living + archived doc pointers: [`docs/HISTORY.md`](docs/HISTORY.md).

| Version | Focus | More |
|---------|-------|------|
| **v5.10.0** | Raw WebM trim — post-trim voice re-apply — **QA PASS · tagged** | [notes](docs/release-notes-v5.10.0.md) |
| **v5.9.0** | Atomic trim apply — **tagged** | [notes](archive/docs/release-notes-v5.9.0.md) |
| **v5.8.0** | Timeline visual subtitle editor | [notes](archive/docs/release-notes-v5.8.0.md) |
| **v5.7.0** | Partial re-bake splice (Phase 2b) — default-on | [notes](archive/docs/release-notes-v5.7.0.md) |
| **v5.6.0** | Audio decoupling + voice re-apply + editing/timeline backend | [notes](archive/docs/release-notes-v5.6.0.md) |
| **v5.5.0 / v5.5.1** | Browser-side full composite + default-on | [HISTORY](docs/HISTORY.md) |
| **v5.4.0** | Design Studio First (standalone suite + Take lifecycle) | [HISTORY](docs/HISTORY.md) |
| **≤ v5.3.10** | WebCodecs backbone → v1.0.0 MVP | [HISTORY](docs/HISTORY.md) / `archive/` |

**Restore any time:** `git checkout main && npm install && npm run dev`

## Architecture hardening

**Incremental refresh complete (2026-07-12)** for v5.9→v5.10 — **map v2.8 · extension-points v1.10 · hardening backlog v2.6 · ADRs 0001–0005**. No new seam/context/store/message. Top open: **H13** acknowledged artifact persistence (High/S — partial bounds pre-check at trim raw leg only), then **H8** recovery voice provenance (Med/S); H12 resolved. Triggers in [`docs/architecture/README.md`](docs/architecture/README.md).
