# Project History — Reddit Voice Notes

<!--
CHANGED: Rebased the milestone index and living-document routes on the v6.0.0 stable checkpoint.
WHY: Fresh sessions need current canon first; completed plans now belong to the archive layer.
-->

## Archive Notice (Living Document)

This is the compact milestone and routing index for post-v6 development. The complete pre-refresh version is preserved at [`archive/docs/v6.0.0-checkpoint/living-snapshots/HISTORY.md`](../archive/docs/v6.0.0-checkpoint/living-snapshots/HISTORY.md); the archive-wide source-to-destination map is [`archive/docs/MANIFEST.md`](../archive/docs/MANIFEST.md).

## Current baseline

| Item | Stable value |
|------|--------------|
| Product | Reddit Voice Notes `6.0.0` |
| Checkpoint | `main@e3cd4b687e9854ae1fd4cd4ffc05eb487bf82179` · tag `v6.0.0` |
| Product posture | Feature-complete stable baseline; next work is polish, resilience, and carefully-scoped extension |
| Architecture | [Map](architecture/architecture-map.md) · [extension points](architecture/extension-points.md) · [hardening backlog](architecture/hardening-backlog.md) · ADR-0001–0010 |
| Latest release | [v6.0.0 notes](release-notes-v6.0.0.md) |
| Active work | [`TODO.md`](../TODO.md) · [`future-ideas.md`](future-ideas.md) · [`deferred-issues.md`](deferred-issues.md) |

## Major milestones

Newest first. Release notes through v5.11 and all completed design/roadmap documents are archived; follow the archive column only when implementation history or original rationale is needed.

| Version | Date | Durable outcome | Detail |
|---------|------|-----------------|--------|
| **v6.0.0** | **2026-07-23** | Polish & Visual Maturity: audio-reactive catalog + Style governor, Background Layout v2, popup Cividis refresh, full hosted Design Studio, and one Field Guide source. `USER_PREFS_VERSION` remains 1. | [Release notes](release-notes-v6.0.0.md) · [completed track roadmaps](../archive/docs/v6.0.0-checkpoint/track-roadmaps/) |
| **v5.11.0** | 2026-07-13 | Preferences moved fully to IndexedDB with migration, relay, Export/Import, and size telemetry. | [Notes](../archive/docs/release-notes-v5.11.0.md) · [design](../archive/docs/pre-v6.0.0/designs/v5.11.0-prefs-storage-refactor.md) · [ADR-0006](architecture/adr/0006-user-preferences-full-idb.md) |
| **v5.10.0** | 2026-07-12 | Atomic raw-WebM trim restored post-trim voice re-apply. | [Notes](../archive/docs/release-notes-v5.10.0.md) · [design](../archive/docs/pre-v6.0.0/designs/v5.10.0-raw-trim-apply-roadmap.md) |
| **v5.9.0** | 2026-07-11 | Trim Apply made clip shortening, cue shift, and artifact invalidation atomic. | [Notes](../archive/docs/release-notes-v5.9.0.md) · [design](../archive/docs/pre-v6.0.0/designs/v5.9.0-trim-apply-roadmap.md) |
| **v5.8.0** | 2026-07-10 | Timeline visual subtitle editor with waveform, snapping, cue manipulation, undo, and trim intent. | [Notes](../archive/docs/release-notes-v5.8.0.md) · [design](../archive/docs/pre-v6.0.0/designs/v5.8.0-trim-ui-visual-subtitle-editor.md) |
| **v5.7.0** | 2026-07-08 | Verified keyframe-aligned partial re-bake splice became default-on. | [Notes](../archive/docs/release-notes-v5.7.0.md) · [ADR-0005](architecture/adr/0005-partial-rebake-splice.md) |
| **v5.6.0** | 2026-07-08 | Voice provenance, re-apply, stream-copy remux, and editing-suite backend. | [Notes](../archive/docs/release-notes-v5.6.0.md) · [design](../archive/docs/pre-v6.0.0/designs/v5.6.0-audio-decoupling.md) · [ADR-0004](architecture/adr/0004-audio-decoupling-voice-reapply.md) |
| **v5.5.x** | 2026-07-07 | Browser-side composite eliminated the default FFmpeg composite wall. | [v5.5.0](../archive/docs/release-notes-v5.5.0.md) · [v5.5.1](../archive/docs/release-notes-v5.5.1.md) · [ADR-0003](architecture/adr/0003-composite-stage-elimination.md) |
| **v5.4.0** | 2026-07-06 | Design Studio became the standalone recording suite with durable take lifecycle. | [Notes](../archive/docs/release-notes-v5.4.0.md) · [roadmap](../archive/docs/pre-v6.0.0/designs/5.4.0-design-studio-first-standalone-voice-notes-suite-roadmap.md) · [ADR-0002](architecture/adr/0002-take-lifecycle-storage-sync.md) |
| **v5.3.0–v5.3.10** | 2026-07-01–05 | Subtitle QoL, rich canvas overlay, cue cache, perceptual color, parallel capture, and dual-stream WebCodecs backbone. | [Design cluster](../archive/docs/pre-v6.0.0/designs/) · [ADR-0001](architecture/adr/0001-webcodecs-encoding-backbone.md) |
| **v5.0.0–v5.2.0** | 2026-06-25–26 | Dulcet II graph-native voice DSP, character backup, and character lock. | [Design cluster](../archive/docs/pre-v6.0.0/designs/) · [current DSP contract](dsp-foundation-design.md) |
| **v4.0.0** | 2026-06-24 | Eloquent subtitle pipeline and stable Design Studio shell. | [Notes](../archive/docs/release-notes-v4.0.0.md) · [progress](../archive/progress/eloquent-branch.md) |
| **v3.x** | 2026-06-21–23 | First voice engine, Studio UX, and v4 shell foundations. | [Archived notes](../archive/docs/) · [Dulcet progress](../archive/progress/dulcet-branch.md) |
| **v2.0.0** | 2026-06-21 | Design Studio personalization: bar style and personal backgrounds. | [Progress](../archive/progress/pretty-branch.md) |
| **v1.0.0** | 2026-06 | Reddit voice-note recorder MVP. | [Early progress snapshot](../archive/progress/claude-progress-pre-v5.4.0.md) |

## Where current work lives

| Looking for… | Living source |
|--------------|---------------|
| System topology, state ownership, invariants, money paths | [`architecture/architecture-map.md`](architecture/architecture-map.md) |
| Exact integration seams and sync points | [`architecture/extension-points.md`](architecture/extension-points.md) |
| Open resilience work and current risk | [`architecture/hardening-backlog.md`](architecture/hardening-backlog.md) |
| Accepted architecture decisions | [`architecture/adr/`](architecture/adr/) |
| Studio workflow, panels, storage, preview/capture contract | [`design-studio.md`](design-studio.md) |
| Reset-to-default / clear-override semantics and field inventory | [`reset-semantics.md`](reset-semantics.md) |
| Voice graph and preview/bake parity | [`dsp-foundation-design.md`](dsp-foundation-design.md) |
| Vosk and subtitle-bake pipeline | [`transcription-architecture.md`](transcription-architecture.md) |
| Hosted Voice Lab / Design Studio deployment contract | [`static-voice-studio-design.md`](static-voice-studio-design.md) |
| Engineering guardrails and review gate | [`engineering-principles.md`](engineering-principles.md) |
| Current bugs, deferrals, and unscheduled ideas | [`bug-archive.md`](bug-archive.md) · [`deferred-issues.md`](deferred-issues.md) · [`future-ideas.md`](future-ideas.md) |
| Field Guide source location | [`tutorial/README.md`](tutorial/README.md) |

## Archive routing

- Use [`archive/docs/MANIFEST.md`](../archive/docs/MANIFEST.md) to translate an old `docs/...` path into its archived location.
- Use [`archive/progress/`](../archive/progress/) for full session/branch handoffs.
- Archived content is immutable except for provenance headers and index maintenance; its internal links intentionally reflect archive-time state.
- A fresh agent should start with this file, `TODO.md`, and the relevant living subsystem doc—not with the archive.

## Maintenance

Run `/docs-archiving` Refresh after the next tagged release or when a living reference begins accumulating completed-plan narrative.

**Refresh history:** #1 v5.8.0 · #2 v5.9.0 · #3 v5.10.0 · #4 merged v6 tracks · #5 v6.0.0 light ship refresh · **#6 v6.0.0 full-baseline refresh (2026-07-23)**.
