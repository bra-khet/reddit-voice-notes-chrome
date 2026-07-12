# Reddit Voice Notes — Session Progress

## Archive Notice (Living Document)

This is the **living** progress file, focused on work **after v5.10.0 (Raw Trim Apply)**. Completed sprint-by-sprint history is preserved verbatim:

- v5.9.0 → v5.10.0 raw-trim-apply arc (incl. real-browser QA): [`archive/progress/claude-progress-through-v5.10.0.md`](archive/progress/claude-progress-through-v5.10.0.md)
- v5.8.0 → v5.9.0 timeline-and-trim arc: [`archive/progress/claude-progress-through-v5.9.0.md`](archive/progress/claude-progress-through-v5.9.0.md)
- v5.4.0 → v5.7.0 editing-suite arc: [`archive/progress/claude-progress-pre-v5.8.0.md`](archive/progress/claude-progress-pre-v5.8.0.md)
- v1.0.0 → v5.3.10 history: [`archive/progress/claude-progress-pre-v5.4.0.md`](archive/progress/claude-progress-pre-v5.4.0.md)
- Milestone index: [`docs/HISTORY.md`](docs/HISTORY.md)

The full prior content is intact so this file can stay small and actionable. Add new session entries below the current-work section; run `/docs-archiving` (Refresh) after the next tagged milestone or major feature.

## Baseline — v5.10.0 Raw Trim Apply (**SHIPPED · QA PASS · tagged**)

**Stable:** `v5.10.0` · **Tag:** `v5.10.0` · **Code:** 2026-07-11 · **Real-browser QA:** **PASS 2026-07-12** · **Push:** deferred (user pushes)

**Apply trim** now cuts the raw capture WebM with the base MP4: pure `planRawTrimLeg` gate → `applyTrimToWebM` (mediabunny, **audio-only** Opus) → fresh `baseRecording` stamp in the same atomic write. **Post-trim voice re-apply / Change Voice work again.** Raw-leg failure demotes honestly to the v5.9 stamp-drop lock and never fails the MP4 trim. `rawAudio: 'trimmed' | 'dropped' | 'none'`. Zero Voice-panel code — unlock is emergent (H6 stamp + `savedAt` poll).

Authoritative references:

- As-built design: [`docs/v5.10.0-raw-trim-apply-roadmap.md`](docs/v5.10.0-raw-trim-apply-roadmap.md) §10
- Release notes: [`docs/release-notes-v5.10.0.md`](docs/release-notes-v5.10.0.md)
- Prior leg (atomic MP4 apply): [`docs/v5.9.0-trim-apply-roadmap.md`](docs/v5.9.0-trim-apply-roadmap.md); notes *(archived)* [`archive/docs/release-notes-v5.9.0.md`](archive/docs/release-notes-v5.9.0.md)
- Architecture: [`docs/architecture/README.md`](docs/architecture/README.md) — map **v2.8**, extension-points **v1.10**, backlog **v2.6**, ADRs 0001–0005
- Full shipped ledger: [`docs/HISTORY.md`](docs/HISTORY.md)

**Verify (at ship):** timeline **22** · take-manager **34** · Node sweep green · `npm run build` PASS @ 5.10.0 · `tsc` = 3 documented pre-existing. **No post-QA code fixes.**

**QA note (accepted, not a defect):** manual DevTools delete of `rvnLastRecording` can leave the open path stale until a full extension reload — normal users never nuke IDB by hand.

## H13 hardening sprint (2026-07-12) — **CODE COMPLETE · user QA gates merge**

**Branch:** `feature/h13-persist-before-stamp` (on tagged `v5.10.0`) · **Scope:** backlog H13 only.

Persist-before-stamp contract shipped: `saveLastBaseMp4` / `saveLastBakedMp4` / `saveLastRecording` now **throw** on unpersistable size (all bounds exported: `LAST_BASE_MP4_*`, `LAST_BAKED_MP4_*`, `LAST_RECORDING_*`) and **propagate IDB failures**, and return the **authoritative persisted meta** (`savedAt`/`byteLength`/`mimeType`/`durationSeconds`; non-finite duration → 0). The four mutation choke points stamp/signal only from that meta:

- `background.ts` — both save handlers (failed save → honest `ok:false`, no stamp, no `LAST_RECORDING_READY`) + `persistOrphanStudioTranscodeResult`
- `subtitle-bake.ts` — `BAKED_MP4_READY_KEY` + take promotion from returned meta (new optional `TakeBakeResult.savedAt` → `updateFromBake`)
- `voice-reapply.ts` — both commit stamps from returned metas
- `trim-apply.ts` — base stamp from meta; raw-leg **save** failure now demotes to the honest v5.9 stamp-drop (closes I19's IDB-failure half) and never fails the trim

H6 reads untouched — on any failure the old stamp still describes the old record (IDB rollback) and verifies. Bonus: fixed the pre-existing `background.ts(217)` TS2345 (orphan path passed `number | undefined`).

**Verify:** new `scripts/test-artifact-store-writes.mjs` **28/28** (boundaries ×3 stores, meta authority, stamp-from-meta passes H6, injected IDB failure leaves prior record+stamp intact) · full Node sweep green (take-manager 34 · timeline 22 · take-deck 12 · all others) · `npm run build` PASS · `tsc` **3 → 2** documented pre-existing.

**Docs:** backlog **v2.7** (H13 RESOLVED + R13 mitigated) · map **v2.9** · extension-points **v1.11** (storage rule ENFORCED) · README/TODO refreshed.

**Merge gate (user):** real-browser regression — record→bake→attach, voice re-apply (base-only + baked), trim apply (raw leg happy path + store-mismatch fallback), Download CTA, recovery (tab close mid-processing).

## Docs-archiving Refresh #3 (2026-07-12) — **DONE**

- Snapshot: [`archive/progress/claude-progress-through-v5.10.0.md`](archive/progress/claude-progress-through-v5.10.0.md)
- Archived release notes: `docs/release-notes-v5.9.0.md` → [`archive/docs/release-notes-v5.9.0.md`](archive/docs/release-notes-v5.9.0.md)
- Living release notes remain: [`docs/release-notes-v5.10.0.md`](docs/release-notes-v5.10.0.md)
- Design/as-built docs stay living (architecture skill will refresh map/seams/backlog separately)

### Other open work

1. Scope the **v6.0 “Polish & Visual Maturity”** arc from [`docs/v5.9.0-trim-apply-roadmap.md`](docs/v5.9.0-trim-apply-roadmap.md) §9 (also listed in v5.10 roadmap deferred).
2. Architecture **H8** (recovery voice provenance) — H13 resolved 2026-07-12 (see sprint entry above; user QA gates merge).
### Architecture hardening — v5.9→v5.10 incremental refresh (2026-07-12) — **DONE**

Map **v2.8** · extension-points **v1.10** · backlog **v2.6**. Re-verified raw-WebM trim against code after QA PASS; confidence High (single machine); H13 still open (partial at trim raw leg); no new ADR/context/message/store. Carry-forward blocks updated in all three living arch docs + README.

Use [`TODO.md`](TODO.md) as the compact task ledger. Start any implementation as its own sprint/branch.
