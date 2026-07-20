# TODO

## Prior stable — **v5.10.0 Raw Trim Apply** (tagged `v5.10.0` · real-browser QA PASS 2026-07-12)

**Design (as-built):** [`docs/v5.10.0-raw-trim-apply-roadmap.md`](docs/v5.10.0-raw-trim-apply-roadmap.md) · **Release notes:** [`docs/release-notes-v5.10.0.md`](docs/release-notes-v5.10.0.md)  
**Package:** `5.10.0` · **Push:** deferred (user pushes)

Trim keeps the voice: **Apply trim** also cuts the raw capture WebM (audio-only, mediabunny, sample-accurate Opus) and re-stamps `baseRecording` in the same atomic write — post-trim **voice re-apply / Change Voice** work. Raw-leg failure demotes honestly to the v5.9 lock. Node: timeline 22 · take-manager 34; build + tsc clean. Real-browser checklist **all PASS**.

## Current stable — **v5.11.0 preferences full-IDB migration** (SHIPPED · browser QA PASS 2026-07-13 · merged to `main` + tagged `v5.11.0`, push deferred)

**Merged:** `feature/v5.11.0-prefs-storage-refactor` → `main` (`853d3d8`) · **Tag:** `v5.11.0` · **Package:** `5.11.0` · **Source of truth:** [`docs/v5.11.0-prefs-storage-refactor.md`](docs/v5.11.0-prefs-storage-refactor.md) · **Release notes:** [`docs/release-notes-v5.11.0.md`](docs/release-notes-v5.11.0.md)

**Implemented:** preserved `user-preferences.ts` API + BUG-023 queue; full `rvnUserPrefs` IndexedDB (`global`, `profiles`, `customStyles`); signal-only `rvnUserPrefs.v2`; transparent Reddit content-script → background IDB load/replace requests; delete-after-success/retryable v1 migration; transcript-result stripping; JSON Export/Import in the Studio profile cluster; per-save size telemetry/dev warnings; ADR-0006 and architecture map **v3.1**.

**Automated:** `test-user-prefs-storage.mjs` **12/12** · `npm run build` **PASS** · `npm run compile` only the same **2 pre-existing** subtitle errors.

**Real-browser QA (2026-07-13):** **PASS · blockers none.** Checklist `.ignore/QA-5.11.0/qa-checklist.md` — fresh install, v1 upgrade (real + planted), profile/style CRUD, hot-swap, Reddit cold-load relay + capture, Export/Import, DevTools rows, size telemetry, product smoke all ■. §3 force-fail ▲ PARTIAL accepted (fallback verified; Node covers inject). §14 skipped (H8 closed). No post-QA code fixes.

**Shipped:** merged → `main` (`853d3d8`) + tagged **v5.11.0** (2026-07-13; push user-owned) · release notes [`docs/release-notes-v5.11.0.md`](docs/release-notes-v5.11.0.md). **Next:** scope **v6.0**. Optional future: Import merge/union mode ([`docs/future-ideas.md`](docs/future-ideas.md)).

## Current work — **v6.0 "Polish & Visual Maturity" · Track B OPEN · A + C merged**

Roadmaps from `.ignore/prep-v6.0.0/` via `/architecture-hardening`. **Active branch:** `feature/v6.0.0-background-panel-refactor` (FF to `main@2b42db5`).

| Track | Roadmap | ADR | Gist |
|-------|---------|-----|------|
| **A — audio-reactive visuals** | [`docs/v6.0.0-custom-styles-refactor.md`](docs/v6.0.0-custom-styles-refactor.md) | [0007](docs/architecture/adr/0007-audio-reactive-visualizer-core.md) + [0009](docs/architecture/adr/0009-registry-native-sparkle-bokeh.md) + [0010](docs/architecture/adr/0010-bubbles-label-stable-bokeh-id.md) | 6 spectra · 7 atmospheres · 7 stackables · Style Control Center · governor — **confidence QA PASS (Pass E) · merged** |
| **B — background layout** | [`docs/v6.0.0-background-panel-refactor.md`](docs/v6.0.0-background-panel-refactor.md) | [0008](docs/architecture/adr/0008-background-direct-manipulation-layout.md) **Accepted** | Hero direct drag + layout core — **OPEN · Phase 0+1 DONE · operator Phase 1 QA PASS · Phase 2 next** |
| **C — popup UI refresh** | [`docs/v6.0.0-popup-ui-refresh.md`](docs/v6.0.0-popup-ui-refresh.md) | none (presentational, under 0007 tokens) | Popup Cividis skin + elevated restart caution — **agent QA gate PASS · merged** |

**Track B status:** ✅ branch FF · ✅ QA scaffold · ✅ ADR-0008 Accepted · ✅ **Phase 0** layout core (`08a2de5`) · ✅ **Phase 1** hero direct drag (`1e3118f`) · ✅ **operator Phase 1 QA PASS** (drag on Design Studio live preview only; side panel still legacy 9-grid — by design until Phase 2+). **Next code:** Phase 2 precision widget + bidirectional sync. Full Track B merge gate still open.

**Track A status:** ✅ full catalog + Style panel + governor · ✅ Pass E confidence · ✅ merged · map **v3.21** / seams **v1.35**. **Package still 5.11.0** until explicit v6 ship/tag. **Accepted residual:** Conway long-horizon corner parking (documented; not a blocker).

**Track C status:** ✅ popup-only Cividis skin + elevated restart caution · ✅ agent gate PASS · ✅ merged · §8 real-extension eyeball residual optional.

**QA workspace:** [`qa/QA-6.0.0/`](qa/QA-6.0.0/) · [`TODO-6.0.0.md`](qa/QA-6.0.0/TODO-6.0.0.md) · [`progress-QA-6.0.0.md`](qa/QA-6.0.0/progress-QA-6.0.0.md) · checklist [`track-b/qa-checklist.md`](qa/QA-6.0.0/track-b/qa-checklist.md)

**NEXT:** Track B Phase 2 · optional v6.0.0 version bump after B · user-owned push of `main` · optional Track C §8 eyeball.

**Non-negotiables:** capture-time visuals; Design-phase bg layout only (I1/I3); `normalize*` guards / no `USER_PREFS_VERSION` bump; no new deps/WASM/compositing layer; no Classic regression vs v5.11.0.

Optional future: Import merge/union mode ([`docs/future-ideas.md`](docs/future-ideas.md)).

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

**v5.11 prefs IDB browser QA PASS (2026-07-13) · tagged `v5.11.0`; H8 + H13 + H14/BUG-038 fully closed** — **map v3.1 · extension-points v1.15 · hardening backlog v2.13 · ADRs 0001–0006**. H10 deferred. Triggers in [`docs/architecture/README.md`](docs/architecture/README.md).
