# TODO

## Current stable — **v5.10.0 Raw Trim Apply** (SHIPPED · real-browser QA PASS 2026-07-12 · tagged `v5.10.0`)

**Design (as-built):** [`docs/v5.10.0-raw-trim-apply-roadmap.md`](docs/v5.10.0-raw-trim-apply-roadmap.md) · **Release notes:** [`docs/release-notes-v5.10.0.md`](docs/release-notes-v5.10.0.md)  
**Package:** `5.10.0` · **Push:** deferred (user pushes)

Trim keeps the voice: **Apply trim** also cuts the raw capture WebM (audio-only, mediabunny, sample-accurate Opus) and re-stamps `baseRecording` in the same atomic write — post-trim **voice re-apply / Change Voice** work. Raw-leg failure demotes honestly to the v5.9 lock. Node: timeline 22 · take-manager 34; build + tsc clean. Real-browser checklist **all PASS**.

## ▶ Current — **v5.11.0 preferences full-IDB migration (browser QA pending)**

**Branch:** `feature/v5.11.0-prefs-storage-refactor` · **Package:** `5.11.0` · **Source of truth:** [`docs/v5.11.0-prefs-storage-refactor.md`](docs/v5.11.0-prefs-storage-refactor.md)

**Implemented:** preserved `user-preferences.ts` API + BUG-023 queue; full `rvnUserPrefs` IndexedDB (`global`, `profiles`, `customStyles`); signal-only `rvnUserPrefs.v2`; transparent Reddit content-script → background IDB load/replace requests; delete-after-success/retryable v1 migration; transcript-result stripping; JSON Export/Import in the Studio profile cluster; per-save size telemetry/dev warnings; ADR-0006 and architecture map v3.0.

**Automated:** `test-user-prefs-storage.mjs` **12/12** · `npm run build` **PASS** · `npm run compile` only the same **2 pre-existing** subtitle errors.

**Manual gate:** fresh install; large v1 upgrade; forced migration failure/retry; profile/style create/update/apply/delete; popup/recorder hot-swap; Export→Import; DevTools rows; confirm the old large local blob is removed. Full matrix is roadmap §9.

## Follow-up — **H8 browser acceptance, then scope v6.0**

H8 remains **resolved in code** on this branch (inherited from `ad534df`) with the manual A→B hard-reload repro re-run pending. After v5.11 and H8 acceptance, scope **v6.0 "Polish & Visual Maturity"**.

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

**v5.11 prefs IDB implemented; H8 resolved in code; H13 + H14/BUG-038 merged** — **map v3.0 · extension-points v1.14 · hardening backlog v2.11 · ADRs 0001–0006**. Preference migration/relay browser QA and H8 A→B repro remain pending; H10 deferred. Triggers in [`docs/architecture/README.md`](docs/architecture/README.md).
