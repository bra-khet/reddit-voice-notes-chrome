# TODO — Post-v6.0.0

<!--
CHANGED: Replaced the shipped-version ledger with a small open-work register.
WHY: Release history belongs in docs/HISTORY.md; TODO should contain only actionable post-v6 work.
-->

## Archive Notice (Living Document)

The v6 ship-time task ledger is preserved at [`archive/progress/TODO-at-v6.0.0-stable.md`](archive/progress/TODO-at-v6.0.0-stable.md). Shipped milestones live in [`docs/HISTORY.md`](docs/HISTORY.md).

## Candidate next sprint

- **Profile actions menu (Medium):** consolidate Add, Import, Rename, Clone, Export, and confirmed Delete into one accessible, Cividis-aligned menu. Keep **Save Changes** outside the menu and reveal it only while dirty without causing layout shift.
- **Reset controls (Medium):** define consistent Reset to default / Reset to blank behavior for settings that are difficult to clear. Reuse one confirmation/modal pattern and preserve normalization.

These are proposals, not a combined sprint. Pick one bounded slice before implementation; product detail is in [`docs/future-ideas.md`](docs/future-ideas.md).

## Other open polish

- Preferences Import merge/union mode.
- Smart Adjust visual trust cues.
- Subtitle gradient/glow controls.
- Conway Life long-horizon corner parking.
- Optional real-extension popup appearance check.

## Deferred engineering

- Encoder fallback reason in the production UI: revive only after a real-world silent fallback.
- Extreme cold-start record/stop spam race: accepted as [`DEF-001`](docs/deferred-issues.md).

## Required guardrails

- Design-phase backgrounds are captured into the base video; do not add post-capture repositioning.
- Reuse normalizers and existing preference/storage paths; do not bump `USER_PREFS_VERSION` casually.
- Shared Studio modules must remain host-neutral.
- `npm run compile` must remain zero-error.
