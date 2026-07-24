# Engineering Principles — Post-v6 Baseline

<!--
CHANGED: Replaced pre-v6 branch examples with the durable engineering constraints of the shipped product.
WHY: This file should guide new work without requiring agents to reconstruct lessons from old sprints.
-->

## Archive Notice (Living Document)

The full pre-v6 examples and original review-gate document are preserved at:

- [`archive/docs/v6.0.0-checkpoint/living-snapshots/engineering-principles.md`](../archive/docs/v6.0.0-checkpoint/living-snapshots/engineering-principles.md)
- [`archive/docs/pre-v6.0.0/operations/code-review.md`](../archive/docs/pre-v6.0.0/operations/code-review.md)

Milestone context is indexed by [`HISTORY.md`](HISTORY.md).

## Permanent constraints

### 1. Verify semantic health

Success means the expected artifact or state exists and is usable—not merely that an API resolved.

- Validate blobs, decoded media, model readiness, frame/packet counts, duration, and terminal state.
- Heartbeats prove liveness, not progress.
- Record an explicit reason when falling back or degrading.
- Timeouts must be owned by a context that survives the initiating UI.

Reference classes: BUG-001–007, BUG-025, BUG-034, BUG-038 in [`bug-archive.md`](bug-archive.md).

### 2. Keep one owner per durable truth

| Truth | Owner |
|-------|-------|
| Normalized preferences | `rvnUserPrefs` IndexedDB through `user-preferences.ts` |
| Preference publication | `rvnUserPrefs.v2` signal after IDB commit |
| Current take snapshot | `TakeManager` / `rvn.take.current` |
| Media artifacts | Single-slot artifact stores, referenced by verified stamps |
| Session transcript | `rvnSessionTranscript` IndexedDB |
| Pipeline wire contract | `src/messaging/types.ts` |

Do not create a second cache, store, message family, or writer to avoid using an existing seam.

### 3. Persist before publishing

Artifact and preference commits complete before stamps, readiness keys, or revision signals are emitted. Never let a consumer observe a durable-state signal for bytes that are still in flight. H13 and ADR-0006 are the precedents.

### 4. Preview must equal output

- Record-time visuals use the same resolve/draw functions in Studio preview and capture.
- Background layout is Design-phase and becomes base-video pixels at capture.
- Subtitle preview/bake share the painter and frame grid; trim ghost math equals Apply math.
- Voice audition and export resolve the same graph and render through the same FFmpeg graph builder.

Any deliberate fidelity gap must be named, bounded, and visible in the UI.

### 5. Normalize at every persisted boundary

Preference and profile input is untrusted even when it came from this extension.

- Use existing `normalize*` functions.
- Treat unknown IDs as fallbacks, not fatal states.
- Additive optional fields are preferred.
- Do not bump `USER_PREFS_VERSION` unless an old reader cannot safely ignore or normalize the change.
- Keep profile payloads free of session transcript text and binary media.

### 6. Shared Studio code is host-neutral

The extension and Pages host execute the same Studio source.

- Use `isOwnStorageOrigin()`; never infer ownership from protocol or pathname.
- Resolve packaged assets with `browser.runtime.getURL()`.
- Keep `browser.*` calls inside function bodies in shared modules.
- Vendor multi-file runtime assets as complete trees.
- Do not rely on a faithfully resolving shim to prove that a background handler performed work.
- Run the host-neutrality gate before a hosted build.

The authoritative seam is [`architecture/extension-points.md`](architecture/extension-points.md).

### 7. Bound expensive work

Every visual or media feature needs explicit cost bounds: element count, queue depth, duration, memory, retries, or time.

- Prefer fixed-cap pools and deterministic reuse.
- Keep reduced-motion and High Contrast behavior explicit.
- Preserve the fallback ladder.
- Never make a hidden “quality” feature unbounded on the 2:00 recording cap.

### 8. Degrade honestly

The user should see a usable lower-fidelity result or a specific failure—not a silent success.

Examples: browser composite → WebCodecs/FFmpeg → MediaRecorder/FFmpeg → drawtext; missing personal background → theme; failed transcription → classified scaffold.

### 9. Preserve branching save pathways

Named profiles/styles distinguish first save, update-with-confirmation, clean clone, and dirty fork. Session text and profile style are separate dirty layers. New UI must reuse the Studio’s modal/save primitives instead of adding isolated `window.confirm` flows.

### 10. Change one bounded seam at a time

- Name the stable fallback tag before high-risk work.
- Keep compile and focused tests green after each slice.
- Update the architecture map only when topology/ownership changes; update extension points when a seam or sync point changes.
- Add an ADR only for a durable structural decision.
- Prefer an archive pointer over copying shipped rationale into a living doc.

## Review gate

Before merging a meaningful change, answer:

1. Which living contract owns this area?
2. Which state owner, execution context, and message/storage seams are touched?
3. Does preview still equal output?
4. Is persistence acknowledged before publication?
5. Are prefs normalized without a casual schema bump?
6. Does shared Studio code still build on both hosts?
7. What is the bounded cost and fallback?
8. Which focused tests and one real money-path check prove the change?

If any answer is unclear, stop at the seam and update the design before widening the patch.
