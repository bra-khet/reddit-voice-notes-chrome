# Future Ideas — Post-v6

<!--
CHANGED: Converted the mixed shipped/future log into a short register of genuinely open product ideas.
WHY: Superseded performance plans and the now-shipped hosted Voice Lab no longer belong in active context.
-->

## Archive Notice (Living Document)

The complete prior log—including shipped-state analysis and the user’s original profile-menu/reset note—is preserved at [`archive/docs/v6.0.0-checkpoint/living-snapshots/future-ideas.md`](../archive/docs/v6.0.0-checkpoint/living-snapshots/future-ideas.md). Historical design sources are indexed by [`archive/docs/MANIFEST.md`](../archive/docs/MANIFEST.md); milestones live in [`HISTORY.md`](HISTORY.md).

Ideas here are unscheduled. Promote one bounded slice to [`TODO.md`](../TODO.md) before implementation.

## Profile actions menu

**Priority:** Medium · **Area:** Design Studio UI polish

Consolidate profile management into one accessible, Cividis-aligned actions menu:

- Add blank/default profile
- Import JSON
- Rename
- Clone
- Export JSON
- Delete with an emphasized second-step confirmation

Rename and Clone should share one modal primitive. Clone pre-fills the current name as `<name> (copy N)` using the first available positive integer.

Keep **Save Changes** outside the menu. Reveal it only while dirty, use the same second-step confirmation language as other updates, and reserve its layout space so the UI does not jump.

## Reset to default / reset to blank

**Priority:** Medium · **Area:** Cross-panel usability

Many selected or filled settings are difficult to clear without manually editing values or switching profiles. Define two explicit operations where both are meaningful:

- **Reset to default:** restore the product/preset-derived value.
- **Reset to blank:** remove the optional override and let normal fallback resolution run.

Requirements:

- central semantics and copy; no panel-specific interpretation drift;
- one reusable confirmation/modal pattern;
- normalization after reset;
- correct dirty-state integration;
- no reset of unrelated profile, transcript, or media state.

Start with an inventory of fields whose “blank” and “default” meanings are distinct.

## Preferences Import merge / union

**Priority:** Low · **Effort:** Small–Medium

Add an explicit strategy beside today’s verified full-replace import. Merge keeps existing profiles/styles not present in the imported snapshot and adds or overwrites incoming entities under documented conflict rules.

Keep the versioned envelope, normalizers, `enqueuePrefsOp`, entity caps, and atomic IDB replace path. Do not turn this into cloud sync or a CRDT.

Historical contract: [`archive/docs/pre-v6.0.0/designs/v5.11.0-prefs-storage-refactor.md`](../archive/docs/pre-v6.0.0/designs/v5.11.0-prefs-storage-refactor.md).

## Smart Adjust trust UI

**Priority:** Medium · **Area:** Subtitle editor

Core proposal logic works; presentation needs stronger trust cues:

- before/after cue preview;
- visual overflow/near-edge map;
- one ranked Recommended proposal;
- integration into a unified subtitle-health surface.

Do not fork measurement or re-splice logic to build the presentation.

## Subtitle visual controls

**Priority:** Low–Medium

Potential user-facing controls already supported by the canvas path:

- text-gradient wave speed and width;
- glow hue-rotation speed/direction/anchor;
- clear indication when an effect is canvas-only;
- preview parity for any newly exposed control.

Keep drawtext as a bounded fallback; do not promise parity it cannot render.

## Production fallback explanation / chronos

**Priority:** Deferred until evidence

If a real silent WebCodecs fallback is reported, surface the chosen strategy and cause beside the existing progress/chronos UI. Thread optional timing/reason fields through the existing message family; do not add telemetry or a new pipeline.

Architecture owner: [`architecture/hardening-backlog.md`](architecture/hardening-backlog.md) H10.

## Visual polish residuals

- Conway Life long-horizon corner parking: fix only with a bounded rule that preserves dead-edge B3/S23 behavior.
- Optional real-extension popup appearance check after future popup changes.
- Free-form style composition beyond the current curated atmosphere + up-to-three ordered accents, only if a concrete workflow justifies the added complexity.
