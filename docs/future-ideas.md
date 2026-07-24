# Future Ideas — Post-v6

<!--
CHANGED: Recorded the shipped #3.5 dirty-profile reset key without moving the active queue pointer.
WHY: The product register should preserve the added recovery behavior without presenting it as an open idea.
-->

## Archive Notice (Living Document)

The complete prior log—including shipped-state analysis and the user’s original profile-menu/reset note—is preserved at [`archive/docs/v6.0.0-checkpoint/living-snapshots/future-ideas.md`](../archive/docs/v6.0.0-checkpoint/living-snapshots/future-ideas.md). Historical design sources are indexed by [`archive/docs/MANIFEST.md`](../archive/docs/MANIFEST.md); milestones live in [`HISTORY.md`](HISTORY.md).

**Active polish queue** (ordered, implementable): [`TODO.md`](../TODO.md). Promote further ideas here only when they leave the queue or are deliberately unscheduled.

## Promoted to TODO (do not re-implement from this file)

These remain documented for product context; **execute from TODO**:

| Idea | TODO # | Notes |
|------|--------|--------|
| Smart Adjust cue-adjacency gate for word-shift | **1 — Done** | Gap ≤ 0.2s for shift proposals; else prefer split/re-splice. **Not** the trust-UI presentation work below. |
| Profile actions menu | **2 — Done** | Responsive Add / Import / Rename / Clone-or-Save-as-new / Export / confirmed Delete; dirty Save stays outside. |
| Reset to default / reset to blank | **3 — Done** | Background and Style share one normalized, scope-preserving choice sheet; false two-destination families remain intentionally single-action. |
| Reset dirty profile | **3.5 — Done** | A reserved lavender recovery key beside Save reapplies the selected profile snapshot and preserves unrelated session/media state. |
| Preferences Import merge / union | **4 — Next** | Explicit merge beside full-replace; no CRDT. |
| Hosted orientation sticky warm-up modal after Back | **5** | Clear restored launch state without moving hosted lifecycle policy into shared Studio code. |

---

## Smart Adjust trust UI

**Priority:** Medium · **Area:** Subtitle editor · **Status:** Unscheduled (after adjacency gate if desired)

Core proposal logic works (including the completed adjacency gate). Presentation still needs stronger trust cues:

- before/after cue preview;
- visual overflow/near-edge map;
- one ranked Recommended proposal;
- integration into a unified subtitle-health surface.

Do not fork measurement or re-splice logic to build the presentation.

### Adjacency rule (product intent — implemented under TODO #1)

Word-shift minimal fixes must not be preferred when cues are temporally distant:

- **Valid word-shift suggestion** only when the two cues involved are **adjacent or very close** (target: inter-cue gap **≤ 0.2 s**).
- Gaps **> 0.2 s** (including ~1 s+ cases reported in use): **suppress or heavily deprioritize** word-shift as the “smallest fix”; **prefer split / re-splice** so text stays lined up with audio.
- Text-fit alone is insufficient eligibility; timing proximity is required for shift proposals that feed one-click / minimal-fix ranking.

---

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
