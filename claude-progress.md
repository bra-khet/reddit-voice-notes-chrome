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
- Architecture: [`docs/architecture/README.md`](docs/architecture/README.md) — map **v2.7**, extension-points **v1.9**, backlog **v2.5**, ADRs 0001–0005 (full re-run deferred; user will refresh arch docs separately)
- Full shipped ledger: [`docs/HISTORY.md`](docs/HISTORY.md)

**Verify (at ship):** timeline **22** · take-manager **34** · Node sweep green · `npm run build` PASS @ 5.10.0 · `tsc` = 3 documented pre-existing. **No post-QA code fixes.**

**QA note (accepted, not a defect):** manual DevTools delete of `rvnLastRecording` can leave the open path stale until a full extension reload — normal users never nuke IDB by hand.

## Docs-archiving Refresh #3 (2026-07-12) — **DONE**

- Snapshot: [`archive/progress/claude-progress-through-v5.10.0.md`](archive/progress/claude-progress-through-v5.10.0.md)
- Archived release notes: `docs/release-notes-v5.9.0.md` → [`archive/docs/release-notes-v5.9.0.md`](archive/docs/release-notes-v5.9.0.md)
- Living release notes remain: [`docs/release-notes-v5.10.0.md`](docs/release-notes-v5.10.0.md)
- Design/as-built docs stay living (architecture skill will refresh map/seams/backlog separately)

### Other open work

1. Scope the **v6.0 “Polish & Visual Maturity”** arc from [`docs/v5.9.0-trim-apply-roadmap.md`](docs/v5.9.0-trim-apply-roadmap.md) §9 (also listed in v5.10 roadmap deferred).
2. Architecture **H13** (persist-before-stamp — v5.10 added a bounds pre-check at the trim raw leg only; general contract still open) and **H8** (recovery voice provenance).
3. Optional: `/architecture-hardening` pass when ready (user deferred after this refresh).

Use [`TODO.md`](TODO.md) as the compact task ledger. Start any implementation as its own sprint/branch.
