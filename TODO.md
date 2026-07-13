# TODO

## Current stable — **v5.10.0 Raw Trim Apply** (SHIPPED · real-browser QA PASS 2026-07-12 · tagged `v5.10.0`)

**Design (as-built):** [`docs/v5.10.0-raw-trim-apply-roadmap.md`](docs/v5.10.0-raw-trim-apply-roadmap.md) · **Release notes:** [`docs/release-notes-v5.10.0.md`](docs/release-notes-v5.10.0.md)  
**Package:** `5.10.0` · **Push:** deferred (user pushes)

Trim keeps the voice: **Apply trim** also cuts the raw capture WebM (audio-only, mediabunny, sample-accurate Opus) and re-stamps `baseRecording` in the same atomic write — post-trim **voice re-apply / Change Voice** work. Raw-leg failure demotes honestly to the v5.9 lock. Node: timeline 22 · take-manager 34; build + tsc clean. Real-browser checklist **all PASS**.

## ▶ Current — **v5.11.0 preferences full-IDB migration (browser QA PASS · merge-ready)**

**Branch:** `feature/v5.11.0-prefs-storage-refactor` @ `ebca7cb` · **Package:** `5.11.0` · **Source of truth:** [`docs/v5.11.0-prefs-storage-refactor.md`](docs/v5.11.0-prefs-storage-refactor.md)

**Implemented:** preserved `user-preferences.ts` API + BUG-023 queue; full `rvnUserPrefs` IndexedDB (`global`, `profiles`, `customStyles`); signal-only `rvnUserPrefs.v2`; transparent Reddit content-script → background IDB load/replace requests; delete-after-success/retryable v1 migration; transcript-result stripping; JSON Export/Import in the Studio profile cluster; per-save size telemetry/dev warnings; ADR-0006 and architecture map **v3.1**.

**Automated:** `test-user-prefs-storage.mjs` **12/12** · `npm run build` **PASS** · `npm run compile` only the same **2 pre-existing** subtitle errors.

**Real-browser QA (2026-07-13):** **PASS · blockers none.** Checklist `.ignore/QA-5.11.0/qa-checklist.md` — fresh install, v1 upgrade (real + planted), profile/style CRUD, hot-swap, Reddit cold-load relay + capture, Export/Import, DevTools rows, size telemetry, product smoke all ■. §3 force-fail ▲ PARTIAL accepted (fallback verified; Node covers inject). §14 skipped (H8 closed). No post-QA code fixes.

**Merge next:** branch → `main` (user-owned push) · tag / release notes for **v5.11.0** · then scope **v6.0**.

## Follow-up — **after v5.11 merge · scope v6.0**

**H8 is fully closed** (code + browser QA PASS). **v5.11 prefs browser matrix PASS 2026-07-13.** After merge/tag of v5.11.0, scope **v6.0 "Polish & Visual Maturity"**. Optional future: Import merge/union mode ([`docs/future-ideas.md`](docs/future-ideas.md)).

## Hardening closed (2026-07-12) — **no version bump**

| Item | Outcome |
|------|---------|
| **H13** persist-before-stamp | **RESOLVED + browser QA PASS** — merged to `main`. `saveLast*` throw on size/IDB failure, return meta; four choke points stamp only from meta. Node **28/28**. |
| **H14 / BUG-038** tab-close transcript | **RESOLVED + browser QA PASS** — merged to `main`. Background owns terminal transcript commit + 125 s watchdog. Node **12/12**. |
| **H8** recovery voice provenance | **RESOLVED + browser QA PASS** — on `feature/v5.11.0-prefs-storage-refactor` (from `ad534df`). Take-owned `captureVoiceIntent`; recovery ignores mutated/nuked resume-time prefs. Node take-manager **37/37** · deck **13/13**. |

**Verify:** artifact-store writes 28 · transcribe-failure 12 · take-manager 37 · take-deck 13 · timeline 22 · build PASS · tsc 2 pre-existing. Push of `main` / tags remains user-owned.

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

**v5.11 prefs IDB browser QA PASS (2026-07-13) · merge-ready; H8 + H13 + H14/BUG-038 fully closed** — **map v3.1 · extension-points v1.15 · hardening backlog v2.13 · ADRs 0001–0006**. H10 deferred. Triggers in [`docs/architecture/README.md`](docs/architecture/README.md).
