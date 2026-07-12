# TODO

## Current stable — **v5.10.0 Raw Trim Apply** (SHIPPED · real-browser QA PASS 2026-07-12 · tagged `v5.10.0`)

**Design (as-built):** [`docs/v5.10.0-raw-trim-apply-roadmap.md`](docs/v5.10.0-raw-trim-apply-roadmap.md) · **Release notes:** [`docs/release-notes-v5.10.0.md`](docs/release-notes-v5.10.0.md)  
**Package:** `5.10.0` · **Push:** deferred (user pushes)

Trim keeps the voice: **Apply trim** also cuts the raw capture WebM (audio-only, mediabunny, sample-accurate Opus) and re-stamps `baseRecording` in the same atomic write — post-trim **voice re-apply / Change Voice** work. Raw-leg failure demotes honestly to the v5.9 lock. Node: timeline 22 · take-manager 34; build + tsc clean. Real-browser checklist **all PASS**.

## ▶ Next — **v6.0 "Polish & Visual Maturity"** (unscoped)

Background / bar-style refresh + accumulated micro-interactions/a11y from the v5 arc ([`docs/v5.9.0-trim-apply-roadmap.md`](docs/v5.9.0-trim-apply-roadmap.md) §9).

**Also open (lower priority):** architecture **H8** (recovery voice provenance). Optional `/architecture-hardening` when ready.

## Hardening closed on main (2026-07-12) — **no version bump**

**Branch:** `feature/h13-persist-before-stamp` → **merged to `main`**. Hardening only (not a release). Stable remains **v5.10.0**.

| Item | Outcome |
|------|---------|
| **H13** persist-before-stamp | **RESOLVED + browser QA PASS** — `saveLast*` throw on size/IDB failure, return meta; four choke points stamp only from meta. Node **28/28**. |
| **H14 / BUG-038** tab-close transcript | **RESOLVED + browser QA PASS** — background owns terminal transcript commit + 125 s watchdog; initiating tab may close without dropping success/scaffold. Node **12/12**. |

**Verify:** artifact-store writes 28 · transcribe-failure 12 · take-manager 34 · timeline 22 · build PASS · tsc 2 pre-existing. Push of `main` / tags remains user-owned.

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

**H13 + H14/BUG-038 merged (2026-07-12, browser QA PASS)** — **map v2.11 · extension-points v1.12 · hardening backlog v2.9 · ADRs 0001–0005**. Persist-before-stamp enforced; background owns terminal transcript delivery after tab close. No new context/store/key/message family/UI. **Open:** **H8** recovery voice provenance (Med/S); **H10** deferred. Triggers in [`docs/architecture/README.md`](docs/architecture/README.md).
