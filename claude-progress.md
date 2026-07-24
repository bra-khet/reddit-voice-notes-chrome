# Reddit Voice Notes — Current Handoff

<!--
CHANGED: Recorded the completed Preferences Import merge/union sprint and advanced the next lifecycle bug.
WHY: Fresh sessions need exact transfer conflict rules and should not reopen settled storage/UI policy.
-->

## Archive Notice (Living Document)

This file describes only the current stable baseline and the next open choices. The ship-time version is preserved at [`archive/progress/claude-progress-at-v6.0.0-stable.md`](archive/progress/claude-progress-at-v6.0.0-stable.md); earlier snapshots are indexed by [`docs/HISTORY.md`](docs/HISTORY.md).

## Stable baseline

- post-`v6.0.0` main with Smart Adjust adjacency, Profile actions, resets, dirty recovery, and merge/replace Preferences Import complete
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
| **3.5** | ✅ Done | **Reset dirty profile** |
| **4** | ✅ Done | **Prefs Import merge/union** |
| **5** | **Next** | Hosted orientation sticky **Warming up** modal after Back |

Full acceptance criteria: [`TODO.md`](TODO.md). Product background: [`docs/future-ideas.md`](docs/future-ideas.md).

### Smart Adjust adjacency (delivered)

`WORD_SHIFT_MAX_GAP_SECONDS = 0.2` now gates `proposeShiftLastWordToNext` and `proposeShiftFirstWordToPrevious` before they feed minimal-fix ranking. Zero/overlap/exact-threshold gaps remain eligible; larger gaps suppress word-shift while re-splice stays available. Proof: `node scripts/test-smart-adjust.mjs` **9/9** and `npm run compile` zero errors.

### Profile actions control deck (delivered)

<!--
BUG FIX: Custom (unsaved) profile edits had no primary save action
Fix: The handoff now records the shared primary Save slot and its Add-current first-save pathway.
Sync: docs/design-studio.md; docs/bug-archive.md; TODO.md
-->
The Profile/Status selector now anchors one host-neutral, responsive Cividis menu: Add current/default, strategy-based Import, identity-preserving Rename, clean Clone or dirty Save as new, Export full preferences, and confirmed Delete. Add/Rename/Clone/Delete share an accessible dialog; copy names choose the first free positive integer. **Save changes** stays outside the menu in a reserved slot: dirty saved profiles retain confirmed update, while a changed `Custom (unsaved)` setup opens the existing Add dialog with **Current setup** selected. Clean Custom remains quiet; the 12-profile cap disables but does not hide a saveable unsaved setup. Proof: `npm run test:profile-actions` **11/11**, `node scripts/test-user-prefs-storage.mjs` **16/16**, `npm run test:host-neutrality` **15/15**, `npm run compile` zero errors, plus desktop/800 px/390 px hosted interaction checks with no console errors.

### Dirty profile recovery (delivered)

A compact lavender reset key now occupies a reserved slot between dirty **Save changes** and the Profile Control Deck. It appears only for a dirty saved profile, reuses `studio__settings-reset-glyph`, and reapplies the selected profile through `applyClipProfile()` so Style, Background, Voice, and Subtitle preferences return as one snapshot. It preserves profile identity, session transcript text, take, and media stores; success hides both dirty actions and returns focus to the selector. The row remains one four-column grid—fluid selector, `124px` Save, `38px` reset, `38px` menu—with the existing `112px` narrowest Save fallback.

### Reset semantics (delivered)

The canonical inventory in `docs/reset-semantics.md` now covers both families with distinct destinations. Background restores product layout while retaining selected media, or reveals the active theme without deleting the upload. Style restores a saved snapshot/Custom starter, or detaches the custom layer and clears overrides without deleting the saved Style. Both use one host-neutral native choice sheet, normalized appearance writes, existing dirty comparators, and scope-preserving copy. Voice/Subtitle appearance remain single-action candidates because blank normalizes to their effective defaults; transcript and media deletion remain separate domains. Proof: `npm run test:settings-reset` **7/7**, `npm run test:style-control-center` **6/6**, `node scripts/test-background-control-ui.mjs` **16/16**, `node scripts/test-user-prefs-storage.mjs` **14/14**, `npm run test:host-neutrality` **15/15**, and `npm run compile`.

The Profile row compression defect remains fixed: dirty **Save changes** stays to the selector’s right with a 124 px minimum (112 px only in the narrowest container).

### Preferences Import merge/union (delivered)

Profile Import now opens one keyboard-complete strategy sheet. **Merge with this Studio** applies the imported global/active setup while preserving unmatched local profiles and styles; incoming entities win on stable ID or trimmed case-insensitive name. Styles merge first and retained profile links follow same-name style identity replacement. **Replace all preferences** preserves the original API default and an explicit second-confirmed UI path. Either strategy validates/normalizes the v1 envelope and commits once through `enqueuePrefsOp`; an over-cap union rejects without changing subtitle flags, IDB state, or revision.

## Continue from here

1. Open [`TODO.md`](TODO.md) and continue **only queue item #5** unless the user names another.
2. Reproduce the hosted Back-navigation warm-up defect and keep the fix in the hosted orientation/launch lifecycle owner, not shared Studio modules.
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
Dirty saved profiles now expose adjacent Save and snapshot-reset choices without wrapping the control deck.
Preferences Import now offers deterministic merge beside explicit full replace without changing storage ownership.
Next implementable slice: clear the hosted orientation's stale Warming up modal after Back navigation.
Treat completed pre-v6 and v6 track roadmaps as archive history, not active plans.
```
