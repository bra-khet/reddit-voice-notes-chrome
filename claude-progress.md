# Reddit Voice Notes — Session Progress

## Archive Notice (Living Document)

This is the **living** progress file, focused on work after **v5.9.0 (Atomic Trim Apply)**. Completed sprint-by-sprint history is preserved verbatim:

- v5.8.0 → v5.9.0 timeline-and-trim arc: [`archive/progress/claude-progress-through-v5.9.0.md`](archive/progress/claude-progress-through-v5.9.0.md)
- v5.4.0 → v5.7.0 editing-suite arc: [`archive/progress/claude-progress-pre-v5.8.0.md`](archive/progress/claude-progress-pre-v5.8.0.md)
- v1.0.0 → v5.3.10 history: [`archive/progress/claude-progress-pre-v5.4.0.md`](archive/progress/claude-progress-pre-v5.4.0.md)
- Milestone index: [`docs/HISTORY.md`](docs/HISTORY.md)

The full prior content is intact so this file can stay small and actionable. Add new session entries below the current-work section; run `/docs-archiving` (Refresh) after the next tagged milestone or major feature.

## Baseline — v5.9.0 (superseded by v5.10.0 below)

**Stable then:** `v5.9.0` · **Tag:** `v5.9.0` · **Shipped:** 2026-07-11

Atomic trim apply is complete and real-browser QA passed. **Apply trim** now creates a shorter `baseMp4`, shifts both transcript copies with preview-identical cue math, clears the trim intent, writes a new H6 base stamp, and drops stale `bakedMp4` / `baseRecording` stamps. The next subtitle bake is therefore a correct full composite, and post-trim voice re-apply stays honestly locked until the raw capture can be trimmed too.

Authoritative references:

- As-built design: [`docs/v5.9.0-trim-apply-roadmap.md`](docs/v5.9.0-trim-apply-roadmap.md) §10
- Release notes: [`docs/release-notes-v5.9.0.md`](docs/release-notes-v5.9.0.md)
- Architecture: [`docs/architecture/README.md`](docs/architecture/README.md) — map v2.6, extension-points v1.8, backlog v2.5, ADRs 0001–0005
- Full shipped ledger: [`docs/HISTORY.md`](docs/HISTORY.md)

## v5.10.0 — Raw Trim Apply (2026-07-11) — **CODE COMPLETE, TAGGED; real-browser QA gate OPEN**

**As-built:** [`docs/v5.10.0-raw-trim-apply-roadmap.md`](docs/v5.10.0-raw-trim-apply-roadmap.md) §10 · **Release notes:** [`docs/release-notes-v5.10.0.md`](docs/release-notes-v5.10.0.md) · **Package:** `5.10.0` · merged `feature/v5.10.0-raw-trim-apply` → `main`, tag `v5.10.0` (push deferred).

Apply trim now cuts the raw capture WebM with the base MP4: pure `planRawTrimLeg` gate (H6 vocabulary) → `applyTrimToWebM` (mediabunny `WebMOutputFormat`, **audio-only** — VP8 canvas track discarded by design, sample-accurate Opus) → fresh `baseRecording` stamp in the SAME `updateCurrentTake` write. **Post-trim voice re-apply / Change Voice work again**; any raw-leg failure (no stamp, H6 mismatch, conversion error, un-persistable size vs the now-exported `LAST_RECORDING_MIN/MAX_BYTES` — H13 pre-check) demotes honestly to the v5.9 stamp-drop lock and never fails the trim. `voiceLocked` outcome → tri-state `rawAudio`. Zero changes to voice-reapply/UI — the unlock is emergent (stamp gate + `savedAt` poll).

Phase 0 gap worth remembering: the planning doc named a nonexistent `saveLastBaseRecording` API — the real store is `rvnLastRecording` / `saveLastRecording` with silent out-of-bounds no-op (H13).

**Verify:** timeline **22** · take-manager **34** · full Node regression sweep green · `npm run build` PASS @ 5.10.0 · `tsc` = 3 documented pre-existing. Docs: map **v2.7**, extension-points **v1.9**, Trace E extended, I19 added.

**⚠ Open gate:** real-browser QA (release notes checklist — trim → Change Voice → audition → re-bake, no desync; raw-leg fallback; regressions) before push/distribution.

### Other open work

1. Run `/docs-archiving` **Refresh #3** after v5.10.0 QA sign-off.
2. Scope the **v6.0 “Polish & Visual Maturity”** arc from [`docs/v5.9.0-trim-apply-roadmap.md`](docs/v5.9.0-trim-apply-roadmap.md) §9.
3. Architecture **H13** (persist-before-stamp — v5.10 added a bounds pre-check at the trim raw leg only; the general contract is still open) and **H8** (recovery voice provenance).

## Architecture hardening — full v5.9.0 refresh (2026-07-11)

All four `/architecture-hardening` phases completed against `main` @ tagged `v5.9.0`. Living artifacts: map **v2.6**, extension points **v1.8**, backlog **v2.5**; canonical Studio/transcription owners were corrected in place. No new context, message family, store, writer, or ADR.

- **H13 OPEN (High/S):** base/baked store writes must return persisted metadata or throw before callers publish stamps/signals.
- **H8 OPEN (Med/S):** interrupted recovery still uses resume-time voice; `TakeVoiceStamp` lands only after successful transcode and does not subsume this.
- **H12 RESOLVED:** Studio pipeline progress is the direct offscreen runtime broadcast; background skip-tab maps suppress only the Reddit relay duplicate.
- **R16:** atomic trim's final base/transcript/take writes span independent stores; the superseded guard + H6 protect the base, while transcript ownership remains a narrow concurrency risk to monitor.

Use [`TODO.md`](TODO.md) as the compact task ledger. Start any implementation as its own sprint/branch; re-run `/architecture-hardening` before a major refactor or a new execution context, message family, storage class, or pipeline.
