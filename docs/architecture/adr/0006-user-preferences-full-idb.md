# ADR-0006: Store user preferences fully in IndexedDB

- **Status:** Accepted · **browser QA PASS 2026-07-13** (merge-ready)
- **Date:** 2026-07-12
- **Reflects branch/tag:** `feature/v5.11.0-prefs-storage-refactor` @ package `5.11.0` (QA build `ebca7cb`)
- **Deciders:** v5.11.0 preferences-storage sprint

## Context

The single `chrome.storage.local['rvnUserPrefs']` object contains global settings, up to 12 profiles, and up to 12 custom styles. Rich profiles embed graph-native `voiceEffectConfig` and profile-safe `transcriptConfig`, making the object difficult to inspect in DevTools and increasingly exposed to single-blob read/modify/write and size footguns. The existing API and BUG-023 `enqueuePrefsOp` serialization boundary must remain unchanged.

The repo already uses thin native IndexedDB wrappers for structured/large extension-origin data (`last-recording-db.ts`, `session-transcript-db.ts`, `image-db.ts`) and enforces H13 persist-before-publish semantics.

## Decision

Store the full preference snapshot in a dedicated `rvnUserPrefs` IndexedDB with atomic `global`, `profiles`, and `customStyles` replacement. Keep `rvnUserPrefs.v2` in `chrome.storage.local` only as a schema marker and revision signal written after the IDB transaction; preserve the public `UserPreferencesV1` model at version 1. Reddit content scripts transparently relay DB load/replace requests to the background extension-origin owner.

## First-class concern impact

- **Preview ↔ bake:** No semantic change. Both paths receive the same normalized in-memory preferences through the preserved API.
- **Effect composition:** No change. Profile rows retain embedded voice and transcript snapshots exactly as before.
- **Message contracts:** Add two bounded request/response operations for content-script DB load/replace. They are not a START/PROGRESS pipeline; `storage.onChanged` remains the change signal.
- **State ownership:** `src/settings/user-preferences.ts` remains the sole mutation choke point. Durable truth moves to IDB; the local coordinator is never a second preference source.

## Options considered

1. **Full IDB + signal-only coordinator (selected)** — one atomic preference truth, clean per-entity DevTools rows, published only after commit; requires async IDB on every load.
2. **Split-local** — keep global/active values in local and only profiles/styles in IDB; faster hot reads, but creates a non-atomic two-source snapshot and rollback/normalization ambiguity.
3. **One IDB blob** — avoids local quota/truncation but retains opaque inspection and whole-record entity coupling.
4. **Do nothing** — keeps the established API but leaves the large-blob footgun and no safe user backup/import workflow.

## Consequences

- **Positive:** Profiles/styles become clean expandable records; the three-store snapshot commits atomically; cross-context listeners observe a post-commit revision; migration and import reuse canonical normalization.
- **Negative / accepted cost:** Every preference load opens/reads IDB, and each save replaces at most 25 small records. Content-script calls serialize the structured snapshot across one background request. A generic storage repository, diff writer, and progress/chunk relay are deliberately rejected because current caps do not justify them.
- **Follow-ups:** Migration fallback, Export/Import, size telemetry, and architecture map/seam updates shipped with implementation. **Manual browser matrix PASS 2026-07-13** (roadmap §9 / `.ignore/QA-5.11.0/`). Optional future: Import merge/union mode (`docs/future-ideas.md`) — not a v5.11 requirement.

## References

- Code: `src/settings/user-preferences.ts`; `src/storage/user-prefs-db.ts`; `src/messaging/types.ts`; `entrypoints/background.ts`
- Docs: `archive/docs/pre-v6.0.0/designs/v5.11.0-prefs-storage-refactor.md`; `docs/design-studio.md` Durable state ownership; `docs/architecture/extension-points.md` Preference storage
- Bugs/invariants: BUG-023; architecture invariant I6; H13 persist-before-publish
