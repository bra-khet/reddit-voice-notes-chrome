# Reddit Voice Notes — Session Progress

## Archive Notice (Living Document)

This is the **living** progress file, focused on work after **v5.9.0 (Atomic Trim Apply)**. Completed sprint-by-sprint history is preserved verbatim:

- v5.8.0 → v5.9.0 timeline-and-trim arc: [`archive/progress/claude-progress-through-v5.9.0.md`](archive/progress/claude-progress-through-v5.9.0.md)
- v5.4.0 → v5.7.0 editing-suite arc: [`archive/progress/claude-progress-pre-v5.8.0.md`](archive/progress/claude-progress-pre-v5.8.0.md)
- v1.0.0 → v5.3.10 history: [`archive/progress/claude-progress-pre-v5.4.0.md`](archive/progress/claude-progress-pre-v5.4.0.md)
- Milestone index: [`docs/HISTORY.md`](docs/HISTORY.md)

The full prior content is intact so this file can stay small and actionable. Add new session entries below the current-work section; run `/docs-archiving` (Refresh) after the next tagged milestone or major feature.

## Current baseline — post-v5.9.0

**Stable:** `v5.9.0` · **Package:** `5.9.0` · **Branch:** `main` · **Tag:** `v5.9.0` · **Shipped:** 2026-07-11

Atomic trim apply is complete and real-browser QA passed. **Apply trim** now creates a shorter `baseMp4`, shifts both transcript copies with preview-identical cue math, clears the trim intent, writes a new H6 base stamp, and drops stale `bakedMp4` / `baseRecording` stamps. The next subtitle bake is therefore a correct full composite, and post-trim voice re-apply stays honestly locked until the raw capture can be trimmed too.

Authoritative references:

- As-built design: [`docs/v5.9.0-trim-apply-roadmap.md`](docs/v5.9.0-trim-apply-roadmap.md) §10
- Release notes: [`docs/release-notes-v5.9.0.md`](docs/release-notes-v5.9.0.md)
- Architecture: [`docs/architecture/README.md`](docs/architecture/README.md) — map v2.6, extension-points v1.8, backlog v2.5, ADRs 0001–0005
- Full shipped ledger: [`docs/HISTORY.md`](docs/HISTORY.md)

## Next phase — v5.10.0 (planning only)

**Design committed:** [`docs/v5.10.0-raw-trim-apply-roadmap.md`](docs/v5.10.0-raw-trim-apply-roadmap.md)  
**Status:** planning on `main`; **no feature branch / no implementation yet.**  
**Intent:** extend atomic trim apply so the raw capture WebM is trimmed with the base MP4, restoring post-trim voice re-apply and Change Voice (v5.9 correctly locked voice by dropping `baseRecording`).

### Other open work

1. Unique **voice locked after trim** copy only if the gray-out UX is reworked; present behavior is correct.
2. Scope the **v6.0 “Polish & Visual Maturity”** arc from [`docs/v5.9.0-trim-apply-roadmap.md`](docs/v5.9.0-trim-apply-roadmap.md) §9.
3. Architecture **H13** (persist-before-stamp) and **H8** (recovery voice provenance) — ranked in the hardening backlog; not blocked by v5.10 planning.

## Architecture hardening — full v5.9.0 refresh (2026-07-11)

All four `/architecture-hardening` phases completed against `main` @ tagged `v5.9.0`. Living artifacts: map **v2.6**, extension points **v1.8**, backlog **v2.5**; canonical Studio/transcription owners were corrected in place. No new context, message family, store, writer, or ADR.

- **H13 OPEN (High/S):** base/baked store writes must return persisted metadata or throw before callers publish stamps/signals.
- **H8 OPEN (Med/S):** interrupted recovery still uses resume-time voice; `TakeVoiceStamp` lands only after successful transcode and does not subsume this.
- **H12 RESOLVED:** Studio pipeline progress is the direct offscreen runtime broadcast; background skip-tab maps suppress only the Reddit relay duplicate.
- **R16:** atomic trim's final base/transcript/take writes span independent stores; the superseded guard + H6 protect the base, while transcript ownership remains a narrow concurrency risk to monitor.

Use [`TODO.md`](TODO.md) as the compact task ledger. Start any implementation as its own sprint/branch; re-run `/architecture-hardening` before a major refactor or a new execution context, message family, storage class, or pipeline.
