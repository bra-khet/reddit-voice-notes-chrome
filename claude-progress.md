# Reddit Voice Notes — Current Handoff

<!--
CHANGED: Reduced the living progress log to the post-v6.0.0 continuation boundary.
WHY: Completed sprint chronology is preserved in archive/progress and should not occupy default context.
-->

## Archive Notice (Living Document)

This file describes only the current stable baseline and the next open choices. The ship-time version is preserved at [`archive/progress/claude-progress-at-v6.0.0-stable.md`](archive/progress/claude-progress-at-v6.0.0-stable.md); earlier snapshots are indexed by [`docs/HISTORY.md`](docs/HISTORY.md).

## Stable baseline

- `main@e3cd4b687e9854ae1fd4cd4ffc05eb487bf82179`
- package/tag `6.0.0` / `v6.0.0`
- v6 Tracks A/B/C/D and the Field Guide are shipped
- six extension execution contexts remain; hosted Design Studio is a second host, not a seventh context
- `USER_PREFS_VERSION` remains 1
- canonical release detail: [`docs/release-notes-v6.0.0.md`](docs/release-notes-v6.0.0.md)

## Continue from here

1. Choose one post-v6 item from [`TODO.md`](TODO.md) or [`docs/future-ideas.md`](docs/future-ideas.md).
2. Read [`docs/HISTORY.md`](docs/HISTORY.md), then only the relevant living subsystem doc.
3. Check [`docs/architecture/extension-points.md`](docs/architecture/extension-points.md) before changing a pipeline, context, store, preference, visual renderer, or host seam.
4. Keep `npm run compile` at zero errors and preserve host-neutrality for shared Studio code.

## Current residuals

- Profile-actions menu and reset-to-default/blank UX are the clearest user-requested polish candidates.
- Encoder fallback observability remains deliberately deferred until a real silent-fallback report.
- Conway long-horizon corner parking and the optional real-extension popup appearance check are non-blocking.

## Cold-session seed

```text
Reddit Voice Notes is stable at v6.0.0. Start with docs/HISTORY.md and TODO.md.
Treat all completed pre-v6 and v6 track roadmaps as archive history, not active plans.
```
