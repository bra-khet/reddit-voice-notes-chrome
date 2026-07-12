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
- Architecture: [`docs/architecture/README.md`](docs/architecture/README.md) — map v2.5, extension-points v1.7, backlog v2.4, ADRs 0001–0005
- Full shipped ledger: [`docs/HISTORY.md`](docs/HISTORY.md)

## Open work

1. **Trim the raw capture WebM** so post-trim voice changes can be restored without desynchronizing audio and video.
2. Consider unique **voice locked after trim** copy only if the current gray-out UX is reworked; present behavior is correct.
3. Scope the **v6.0 “Polish & Visual Maturity”** arc from [`docs/v5.9.0-trim-apply-roadmap.md`](docs/v5.9.0-trim-apply-roadmap.md) §9.

Use [`TODO.md`](TODO.md) as the compact task ledger. Start any implementation as its own sprint/branch; re-run `/architecture-hardening` before a major refactor or a new execution context, message family, storage class, or pipeline.
