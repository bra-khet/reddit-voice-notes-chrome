# Reddit Voice Notes — Current Handoff

<!--
CHANGED: Recorded the completed Profile actions control deck and advanced the ordered queue to reset semantics.
WHY: Fresh sessions need the verified UI/storage baseline, its proof, and the exact next bounded slice.
-->

## Archive Notice (Living Document)

This file describes only the current stable baseline and the next open choices. The ship-time version is preserved at [`archive/progress/claude-progress-at-v6.0.0-stable.md`](archive/progress/claude-progress-at-v6.0.0-stable.md); earlier snapshots are indexed by [`docs/HISTORY.md`](docs/HISTORY.md).

## Stable baseline

- post-`v6.0.0` main with the Smart Adjust cue-adjacency and Profile actions polish sprints complete
- package/tag `6.0.0` / `v6.0.0`
- v6 Tracks A/B/C/D and the Field Guide are shipped
- six extension execution contexts remain; hosted Design Studio is a second host, not a seventh context
- `USER_PREFS_VERSION` remains 1
- canonical release detail: [`docs/release-notes-v6.0.0.md`](docs/release-notes-v6.0.0.md)

## Ordered next work (see TODO.md)

| Order | Status | Item |
|-------|--------|------|
| **1** | ✅ Done | Smart Adjust word-shift **cue-adjacency gate** |
| **2** | ✅ Done | **Profile actions menu** |
| **3** | **In progress** | **Reset to default / blank** — Background slice shipped; Style next |
| **4** | Queued | **Prefs Import merge/union** |
| **5** | Queued | Hosted orientation sticky **Warming up** modal after Back |

Full acceptance criteria: [`TODO.md`](TODO.md). Product background: [`docs/future-ideas.md`](docs/future-ideas.md).

### Smart Adjust adjacency (delivered)

`WORD_SHIFT_MAX_GAP_SECONDS = 0.2` now gates `proposeShiftLastWordToNext` and `proposeShiftFirstWordToPrevious` before they feed minimal-fix ranking. Zero/overlap/exact-threshold gaps remain eligible; larger gaps suppress word-shift while re-splice stays available. Proof: `node scripts/test-smart-adjust.mjs` **9/9** and `npm run compile` zero errors.

### Profile actions control deck (delivered)

The Profile/Status selector now anchors one host-neutral, responsive Cividis menu: Add current/default, Import full-replace JSON, identity-preserving Rename, clean Clone or dirty Save as new, Export full preferences, and confirmed Delete. Add/Rename/Clone/Delete share an accessible dialog; copy names choose the first free positive integer. Dirty **Save changes** stays outside the menu in a reserved slot. New default creation and rename serialize through the existing preference writer. Proof: `npm run test:profile-actions` **7/7**, `node scripts/test-user-prefs-storage.mjs` **14/14**, `npm run test:host-neutrality` **15/15**, `npm run compile` zero errors, plus desktop/800 px/390 px hosted interaction checks with no console errors.

### Reset semantics (Background slice delivered)

The reset inventory is now canonical in `docs/reset-semantics.md`. Background ships the first host-neutral choice sheet: restore the product layout while keeping selected media, or clear the personal-background override to reveal the active theme while retaining the upload in ImageDB. Both paths normalize and persist through the existing appearance writer, update dirty state, and leave profile identity, transcript, take, and unrelated preferences untouched. The Profile row compression defect is also fixed: dirty **Save changes** remains to the selector’s right with a 124 px minimum (112 px only in the narrowest container).

## Continue from here

1. Open [`TODO.md`](TODO.md) and continue **only queue item #3** unless the user names another.
2. Read [`docs/HISTORY.md`](docs/HISTORY.md) and [`docs/reset-semantics.md`](docs/reset-semantics.md); the next candidate is the Style family’s saved/preset default vs optional override inheritance.
3. Check [`docs/architecture/extension-points.md`](docs/architecture/extension-points.md) before changing a pipeline, context, store, preference, visual renderer, or host seam.
4. Keep `npm run compile` at zero errors and preserve host-neutrality for shared Studio code.
5. After a meaningful slice: commit as `Sprint: <brief description>`; leave optional residuals documented, not expanded mid-sprint.

## Current residuals (unscheduled)

- Smart Adjust **trust UI** (preview / overflow map) — separate from adjacency gate.
- Conway long-horizon corner parking; optional real-extension popup appearance check.
- Encoder fallback observability — deferred until a real silent-fallback report.

## Cold-session seed

```text
Reddit Voice Notes is stable at v6.0.0 (docs baseline main@044327c).
Start with docs/HISTORY.md and TODO.md ordered polish queue.
Smart Adjust cue-adjacency and the responsive Profile actions control deck are complete.
Next implementable slice: extend the reset choice pattern to Style without collapsing saved-style restore and theme inheritance.
Treat completed pre-v6 and v6 track roadmaps as archive history, not active plans.
```
