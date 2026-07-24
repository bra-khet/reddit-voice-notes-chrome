# Architecture Docs — Reddit Voice Notes

<!--
CHANGED: Rebased the architecture index on the stable v6.0.0 product and removed completed-roadmap pointers.
WHY: Architecture docs are now the primary living technical surface; shipped plans belong to the archive.
-->

**Baseline:** `main@e3cd4b687e9854ae1fd4cd4ffc05eb487bf82179` · package/tag `6.0.0` / `v6.0.0` · updated 2026-07-23

## Archive Notice (Living Document)

The pre-refresh architecture index is preserved at [`archive/docs/v6.0.0-checkpoint/living-snapshots/architecture/README.md`](../../archive/docs/v6.0.0-checkpoint/living-snapshots/architecture/README.md). Completed design sources are mapped by [`archive/docs/MANIFEST.md`](../../archive/docs/MANIFEST.md).

## Primary architecture surface

| File | Owns |
|------|------|
| [`architecture-map.md`](architecture-map.md) | Six extension contexts, hosted second-host model, diagrams, state ownership, invariants I1–I23, money paths, and confidence |
| [`extension-points.md`](extension-points.md) | Exact integration seams, files, sync points, preview/output requirements, host-neutrality rules, and extension checklist |
| [`hardening-backlog.md`](hardening-backlog.md) | Open/deferred hardening and current residual-risk register |
| [`adr/`](adr/) | Accepted structural decisions ADR-0001–0010; ADR-0011 is next |

## Canonical subsystem docs

| Topic | Living owner |
|-------|--------------|
| Studio workflow, panels, storage, dirty state | [`../design-studio.md`](../design-studio.md) |
| Voice graph / audition-export parity | [`../dsp-foundation-design.md`](../dsp-foundation-design.md) |
| Vosk, cues, bake ladder, trim timing | [`../transcription-architecture.md`](../transcription-architecture.md) |
| Hosted surfaces and deployment | [`../static-voice-studio-design.md`](../static-voice-studio-design.md) |
| Engineering/review constraints | [`../engineering-principles.md`](../engineering-principles.md) |
| Bug prevention and recurrence lookup | [`../bug-archive.md`](../bug-archive.md) |
| Active deferrals / ideas | [`../deferred-issues.md`](../deferred-issues.md) · [`../future-ideas.md`](../future-ideas.md) |
| Release boundary and milestones | [`../release-notes-v6.0.0.md`](../release-notes-v6.0.0.md) · [`../HISTORY.md`](../HISTORY.md) |

## When to update

Update the map and re-run architecture hardening when work adds or changes:

- an execution context or host;
- a message family or terminal owner;
- a store, durable key, writer, or artifact kind;
- a compositing layer or default media strategy;
- a shared visual renderer/performance policy;
- preference schema behavior that normalization cannot absorb;
- a host-neutrality rule;
- a systemic bug-class recurrence.

Update only extension points when an existing seam gains a file, sync point, or verification requirement. Add an ADR for durable structural decisions, not normal additive use of an accepted seam.

## Standards

- Living links must resolve; archived links may reflect archive-time state.
- Diagrams stay inline and describe current topology.
- Accepted ADR decisions are immutable; reference-link maintenance may repoint them into the archive without changing the decision.
- Never duplicate subsystem detail into the map.
- Cold-session orientation starts at [`../HISTORY.md`](../HISTORY.md), then this index and the one relevant subsystem owner.
