# TODO

## Current stable — **v5.10.0 Raw Trim Apply** (SHIPPED · real-browser QA PASS 2026-07-12 · tagged `v5.10.0`)

**Design (as-built):** [`docs/v5.10.0-raw-trim-apply-roadmap.md`](docs/v5.10.0-raw-trim-apply-roadmap.md) · **Release notes:** [`docs/release-notes-v5.10.0.md`](docs/release-notes-v5.10.0.md)  
**Package:** `5.10.0` · **Push:** deferred (user pushes)

Trim keeps the voice: **Apply trim** also cuts the raw capture WebM (audio-only, mediabunny, sample-accurate Opus) and re-stamps `baseRecording` in the same atomic write — post-trim **voice re-apply / Change Voice** work. Raw-leg failure demotes honestly to the v5.9 lock. Node: timeline 22 · take-manager 34; build + tsc clean. Real-browser checklist **all PASS**.

## ▶ Next — **H8 recovery voice provenance** (before v6.0)

**Status:** **OPEN · next sprint** · backlog item in [`docs/architecture/hardening-backlog.md`](docs/architecture/hardening-backlog.md) § H8 · **no version bump** expected.

**What it is:** When a draft has raw WebM but no base MP4 and the *original* transcode is gone (`inflight === false`), `studio-take-recovery.ts` starts a **new** WebM→MP4 with `loadUserPreferences().voiceEffect` **at resume time**. Capture-time voice is not on the interrupted draft (`TakeVoiceStamp` only lands on successful `ready`). User-confirmed repro (2026-07-12): extension hard-reload mid-transcode → edit `rvnUserPrefs.voiceEffect` in DevTools → reopen Studio → resume uses the **edited** voice.

**Practical exposure today:** Very narrow. Normal tab-close keeps the original job (orphan persist = stop-time voice). Voice prefs are written from Design Studio (`saveVoiceEffectPreferences`); opening Studio also runs recovery, so a normal user rarely changes prefs *before* resume without DevTools. Hardening still worth doing: capture intent on the take snapshot so recovery cannot silently drift if prefs change (future surfaces, multi-page, crash + later edit).

**Fix sketch (from backlog):** optional JSON-safe capture voice intent at `beginTake` (or stop); recovery prefers that config and promotes `TakeVoiceStamp` on resume success; legacy drafts without the field keep current-prefs + honest note.

**After H8:** scope **v6.0 "Polish & Visual Maturity"** ([`docs/v5.9.0-trim-apply-roadmap.md`](docs/v5.9.0-trim-apply-roadmap.md) §9).

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

**H13 + H14/BUG-038 merged (2026-07-12, browser QA PASS)** — **map v2.11 · extension-points v1.12 · hardening backlog v2.9 · ADRs 0001–0005**. Persist-before-stamp enforced; background owns terminal transcript delivery after tab close. **Next open item: H8** (recovery voice provenance — user-confirmed via hard-reload + DevTools prefs edit). **H10** deferred. Triggers in [`docs/architecture/README.md`](docs/architecture/README.md).
