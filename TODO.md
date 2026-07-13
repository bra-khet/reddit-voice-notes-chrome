# TODO

## Current stable — **v5.10.0 Raw Trim Apply** (SHIPPED · real-browser QA PASS 2026-07-12 · tagged `v5.10.0`)

**Design (as-built):** [`docs/v5.10.0-raw-trim-apply-roadmap.md`](docs/v5.10.0-raw-trim-apply-roadmap.md) · **Release notes:** [`docs/release-notes-v5.10.0.md`](docs/release-notes-v5.10.0.md)  
**Package:** `5.10.0` · **Push:** deferred (user pushes)

Trim keeps the voice: **Apply trim** also cuts the raw capture WebM (audio-only, mediabunny, sample-accurate Opus) and re-stamps `baseRecording` in the same atomic write — post-trim **voice re-apply / Change Voice** work. Raw-leg failure demotes honestly to the v5.9 lock. Node: timeline 22 · take-manager 34; build + tsc clean. Real-browser checklist **all PASS**.

## ▶ Next — **H8 browser acceptance, then scope v6.0**

**H8 status:** **RESOLVED in code · manual A→B repro re-run pending** on `feature/h8-recovery-voice-provenance`. Hardening only — package stays **5.10.0**.

**Implemented:** optional JSON-safe `captureVoiceIntent` (normalized config + id-free key) is persisted on `beginTake` and refreshed in the awaited stop-time pre-transcode patch. The original job renders that same config. Recovery prefers the captured intent, then promotes `TakeVoiceStamp` (including voice fallback) with `ready`. Legacy drafts still use current prefs and now show an honest ready-deck note.

**Automated:** take-manager **37/37** · take-deck **13/13** · `npm run build` **PASS** · `tsc` only the same **2 pre-existing** subtitle errors.

**Manual acceptance:** capture with voice A → hard-reload extension mid-transcode → edit `rvnUserPrefs.voiceEffect` to B in DevTools → reopen Studio → recovered MP4 must sound like A. For a deliberately legacy draft without `captureVoiceIntent`, current voice is allowed but the deck must disclose it.

**After acceptance:** scope **v6.0 "Polish & Visual Maturity"** ([`docs/v5.9.0-trim-apply-roadmap.md`](docs/v5.9.0-trim-apply-roadmap.md) §9).

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

**H8 resolved in code; H13 + H14/BUG-038 merged (2026-07-12)** — **map v2.12 · extension-points v1.13 · hardening backlog v2.10 · ADRs 0001–0005**. Recovery voice is now take-owned before render; persist-before-stamp and background transcript terminal ownership remain enforced. **H8 browser repro re-run pending; H10 deferred.** Triggers in [`docs/architecture/README.md`](docs/architecture/README.md).
