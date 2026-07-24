# Reddit Voice Notes — Current Handoff

<!--
CHANGED: Recorded the completed Background/Style reset semantics and advanced the ordered queue to import merge/union.
WHY: Fresh sessions need the verified reset/storage baseline, its proof, and the exact next bounded slice.
-->

## Archive Notice (Living Document)

This file describes only the current stable baseline and the next open choices. The ship-time version is preserved at [`archive/progress/claude-progress-at-v6.0.0-stable.md`](archive/progress/claude-progress-at-v6.0.0-stable.md); earlier snapshots are indexed by [`docs/HISTORY.md`](docs/HISTORY.md).

## Stable baseline

- post-`v6.0.0` main with Smart Adjust adjacency, Profile actions, and Background/Style reset polish complete
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
| **3** | ✅ Done | **Reset to default / blank** — Background + Style |
| **4** | **Next** | **Prefs Import merge/union** |
| **5** | Queued | Hosted orientation sticky **Warming up** modal after Back |

Full acceptance criteria: [`TODO.md`](TODO.md). Product background: [`docs/future-ideas.md`](docs/future-ideas.md).

### Smart Adjust adjacency (delivered)

`WORD_SHIFT_MAX_GAP_SECONDS = 0.2` now gates `proposeShiftLastWordToNext` and `proposeShiftFirstWordToPrevious` before they feed minimal-fix ranking. Zero/overlap/exact-threshold gaps remain eligible; larger gaps suppress word-shift while re-splice stays available. Proof: `node scripts/test-smart-adjust.mjs` **9/9** and `npm run compile` zero errors.

### Profile actions control deck (delivered)

The Profile/Status selector now anchors one host-neutral, responsive Cividis menu: Add current/default, Import full-replace JSON, identity-preserving Rename, clean Clone or dirty Save as new, Export full preferences, and confirmed Delete. Add/Rename/Clone/Delete share an accessible dialog; copy names choose the first free positive integer. Dirty **Save changes** stays outside the menu in a reserved slot. New default creation and rename serialize through the existing preference writer. Proof: `npm run test:profile-actions` **7/7**, `node scripts/test-user-prefs-storage.mjs` **14/14**, `npm run test:host-neutrality` **15/15**, `npm run compile` zero errors, plus desktop/800 px/390 px hosted interaction checks with no console errors.

### Reset semantics (delivered)

The canonical inventory in `docs/reset-semantics.md` now covers both families with distinct destinations. Background restores product layout while retaining selected media, or reveals the active theme without deleting the upload. Style restores a saved snapshot/Custom starter, or detaches the custom layer and clears overrides without deleting the saved Style. Both use one host-neutral native choice sheet, normalized appearance writes, existing dirty comparators, and scope-preserving copy. Voice/Subtitle appearance remain single-action candidates because blank normalizes to their effective defaults; transcript and media deletion remain separate domains. Proof: `npm run test:settings-reset` **7/7**, `npm run test:style-control-center` **6/6**, `node scripts/test-background-control-ui.mjs` **16/16**, `node scripts/test-user-prefs-storage.mjs` **14/14**, `npm run test:host-neutrality` **15/15**, and `npm run compile`.

The Profile row compression defect remains fixed: dirty **Save changes** stays to the selector’s right with a 124 px minimum (112 px only in the narrowest container).

## Continue from here

1. Open [`TODO.md`](TODO.md) and continue **only queue item #4** unless the user names another.
2. Read [`docs/HISTORY.md`](docs/HISTORY.md), [`docs/design-studio.md`](docs/design-studio.md), and the archived prefs-storage contract linked from TODO; define merge conflict rules before changing Import UI.
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
Background/Style reset semantics are complete; saved sources, unrelated state, and keyboard return paths are preserved.
Next implementable slice: Preferences Import merge/union with explicit conflict rules beside full replace.
Treat completed pre-v6 and v6 track roadmaps as archive history, not active plans.
```
