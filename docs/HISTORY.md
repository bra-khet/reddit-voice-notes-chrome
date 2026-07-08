# Project History — Reddit Voice Notes

**Living milestone index.** Updated **2026-07-08** · Current milestone: **v5.7.0 — Partial re-bake splice (Phase 2b)** · Stable: **v5.6.0**.

This is the go-to orientation doc: it indexes every major milestone and points to both the **living** documents (current work) and their **archived** history. Read this first when you need to know "what happened before the current feature branch?" — then follow a pointer into [`archive/`](../archive/) only if you need the full detail.

- **Current session log (living):** [`claude-progress.md`](../claude-progress.md) — v5.5.0 + v5.4.0 handoff context.
- **Full pre-v5.4.0 log (archived):** [`archive/progress/claude-progress-pre-v5.4.0.md`](../archive/progress/claude-progress-pre-v5.4.0.md).
- **Architecture (living):** [`architecture/README.md`](architecture/README.md) — map v2.1, extension-points v1.4, hardening backlog v2.1, ADRs 0001–0003.

---

## Major milestones

Newest first. **Tag** = git tag on `main`. Docs marked *(archived)* live under [`archive/docs/`](../archive/docs/); all others are living in [`docs/`](.).

| Version | Date | Focus / outcome | Notes |
|---------|------|-----------------|-------|
| **v5.6.0** | 2026-07-08 | **Audio decoupling & voice re-apply** — `TakeVoiceStamp`, Dulcet II re-render, stream-copy remux (visuals bit-exact); editing backend scaffolds (timeline, dirty tracker, partial-rebake planner, trim backend). **Tagged `v5.6.0`**. | [`release-notes-v5.6.0.md`](release-notes-v5.6.0.md), [`v5.6.0-audio-decoupling.md`](v5.6.0-audio-decoupling.md), [ADR-0004](architecture/adr/0004-audio-decoupling-voice-reapply.md) |
| **v5.5.1** | 2026-07-07 | **Browser composite default-on** — `experimental.browserComposite` true by default + rollout migration (Overlay Lab dev-only made v5.5.0 opt-in unreachable in production). **Tagged `v5.5.1`**. | [`release-notes-v5.5.1.md`](release-notes-v5.5.1.md) |
| **v5.5.0** | 2026-07-07 | **Browser-side Full Composite** — mediabunny in-page decode/blend/encode/mux eliminates FFmpeg alphamerge wall; QA hardening (AAC PTS, cue editor, unfocused cap-stop). **Tagged `v5.5.0`**. | [`release-notes-v5.5.0.md`](release-notes-v5.5.0.md), [`v5.5.0-browser-composite-migration.md`](v5.5.0-browser-composite-migration.md), [ADR-0003](architecture/adr/0003-composite-stage-elimination.md) |
| **v5.4.0** | 2026-07-06 | **Design Studio First** — Studio becomes the standalone recording suite; Take lifecycle (`rvn.take.current`), live WYSIWYG capture, Reddit attach mode, WebCodecs bake default-on, H6 crash-safety. **Tagged `v5.4.0`**. | Living: [`release-notes-v5.4.0.md`](release-notes-v5.4.0.md), [`5.4.0-…-roadmap.md`](5.4.0-design-studio-first-standalone-voice-notes-suite-roadmap.md), [ADR-0002](architecture/adr/0002-take-lifecycle-storage-sync.md) |
| **v5.3.10** | 2026-07-05 | **WebCodecs Per-Chunk Encoding** — dual color+alpha VP8 streams; normalize stage eliminated by construction. | Living: [`release-notes-v5.3.10.md`](release-notes-v5.3.10.md), [`5.3.10-webcodecs-per-chunk-encoding.md`](5.3.10-webcodecs-per-chunk-encoding.md), [ADR-0001](architecture/adr/0001-webcodecs-encoding-backbone.md) |
| **v5.3.9** | 2026-07-04 | **Parallel Chunked Bake (Phase 3)** — N concurrent MediaRecorder capture loops; perf regression found + fixed same day (5.3.9.1). | Living: [`release-notes-v5.3.9.md`](release-notes-v5.3.9.md), [`5.3.9-worker-and-chunked-parallelization-design.md`](5.3.9-worker-and-chunked-parallelization-design.md) |
| **v5.3.8** | 2026-07-04 | **Oklch Perceptual Hue Rotation (Phase 2)** — perceptually-uniform rainbow color math. | Notes *(archived)*; design living: [`5.3.8-oklch-…-design.md`](5.3.8-oklch-rainbow-perceptual-uniformity-design.md) |
| **v5.3.7** | 2026-07 | **Editor Intelligence (Phase 1)** — segment editor smarts. | Notes *(archived)* |
| **v5.3.6** | 2026-07-04 | **Smart Split relaxation** — font-size headroom, measurement edge-cases. | Notes *(archived)*; designs living (`5.3.6-*.md`) |
| **v5.3.5** | 2026-07-04 | **Cue-stable overlay caching** — `ImageBitmap` cache, ~99% hit on sparse cues. | Notes *(archived)*; design living: [`5.3.5-cue-stable-overlay-caching-design.md`](5.3.5-cue-stable-overlay-caching-design.md) |
| **v5.3.4** | 2026-07-03 | **Canvas subtitle overlay** — canvas overlay bake path alongside drawtext. | Notes *(archived)*; design living: [`v5.3.4-subtitle-canvas-overlay.md`](v5.3.4-subtitle-canvas-overlay.md) |
| **v5.3.2** | 2026-07 | **One-Time Test cold-start fix**. | Notes *(archived)* |
| **v5.3.1** | 2026-07 | **Voice live-mic preview** — "Test with my voice". | Notes *(archived)*; design living: [`v5.3.1-voice-live-mic-preview-design-document.md`](v5.3.1-voice-live-mic-preview-design-document.md) |
| **v5.3.0** | 2026-07 | **Subtitle QoL** — graceful Vosk failure→scaffold, Smart Split, per-cue delete, burn-in budget. | Notes *(archived)*; design living: [`v5.3.0-subtitle-qol-design-document.md`](v5.3.0-subtitle-qol-design-document.md) |
| **v5.2.0** | 2026-06-26 | **Voice QoL** — character lock + clipboard backup. | Design living: [`v5.2.0-voice-qol-lock-clipboard.md`](v5.2.0-voice-qol-lock-clipboard.md) |
| **v5.1.x** | 2026-06-26 | Animated GIF backgrounds (5.1.0); character copy/paste (5.1.1); character lockout (5.1.2). | Designs living: [`v5.1.1-QOL-charactercopypaste.md`](v5.1.1-QOL-charactercopypaste.md), [`v5.1.2-QOL-characterlockout.md`](v5.1.2-QOL-characterlockout.md), [`gif-animation-design-implementation.md`](gif-animation-design-implementation.md) |
| **v5.0.0** | 2026-06-25 | **Dulcet II** — graph-native DSP voice rebuild; 21 `StylizedGraph` primitives, character presets, analog sliders. | Notes *(archived)*; living: [`v5-development-roadmap.md`](v5-development-roadmap.md), [`v5-implementation-notes.md`](v5-implementation-notes.md), [`dsp-foundation-design.md`](dsp-foundation-design.md) |
| **v4.0.0** | 2026-06-24 | **Eloquent I** — subtitle pipeline + Design Studio v4 (stable). | Notes *(archived)*; principles living: [`v4-development-principles.md`](v4-development-principles.md) |
| **v3.7.0** | 2026-06-23 | **Design Studio v4 UI shell** — hero preview, cards, sub-panels, bezel. | Notes *(archived)* |
| **v3.6.0** | 2026-06-22 | Eloquent subtitle pipeline hardened (edit-before-bake, burn-in export). | See archived progress log |
| **v3.1.0** | 2026-06-21 | Studio UX polish — collapsible panels, single Live preview. | Notes *(archived)* |
| **v3.0.0** | 2026-06 | **Dulcet** — voice-effects engine (first). | See [`archive/progress/dulcet-branch.md`](../archive/progress/dulcet-branch.md) |
| **v2.0.0** | 2026-06-21 | **Design Studio + personalization** — bar style, personal backgrounds. | See [`archive/progress/pretty-branch.md`](../archive/progress/pretty-branch.md) |
| **v1.0.0** | 2026-06 | **MVP** — Reddit voice-note recorder. | See archived progress log |

> Subtitle-pipeline lineage (v4 subtitles) is captured in [`archive/progress/eloquent-branch.md`](../archive/progress/eloquent-branch.md); `BUG-###` history lives in the living [`bug-archive.md`](bug-archive.md).

---

## How the archive works (conditional disclosure)

The project keeps two tiers so living docs stay small without losing anything:

1. **Living layer** — root `claude-progress.md`, the canonical reference docs in `docs/`, `docs/architecture/`, and this index. Kept slim and link-correct.
2. **Archive layer** — [`archive/`](../archive/), initialized at v5.4.0. Immutable, full-detail history. See [`archive/README.md`](../archive/README.md).

Living documents carry a short **Archive Notice** and link into the archive only where deeper history is needed. A fresh agent (or human) should be able to understand current state and continue work from the living layer alone, following an archive pointer only on demand.

**Design docs vs. release notes:** design/spec docs for shipped features were kept **living** (the architecture docs cite them as active canon); only inert records — per-version release notes, branch logs, and resolved checkpoints — were archived.

## Where current work lives

| Looking for… | Go to (living) |
|--------------|----------------|
| Cross-cutting architecture, invariants, diagrams | [`architecture/architecture-map.md`](architecture/architecture-map.md) |
| Integration seams (new effect / pipeline / storage) | [`architecture/extension-points.md`](architecture/extension-points.md) |
| Ranked tech-debt / hardening items | [`architecture/hardening-backlog.md`](architecture/hardening-backlog.md) |
| Design Studio semantics, preview=bake, storage map | [`design-studio.md`](design-studio.md) |
| Vosk / transcription / overlay bake paths | [`transcription-architecture.md`](transcription-architecture.md) |
| Engineering principles & save pathways | [`engineering-principles.md`](engineering-principles.md) |
| Voice DSP (Dulcet II, in progress) | [`v5-development-roadmap.md`](v5-development-roadmap.md), [`dsp-foundation-design.md`](dsp-foundation-design.md) |
| Open issues / future ideas | [`deferred-issues.md`](deferred-issues.md), [`future-ideas.md`](future-ideas.md) |
| Bug history (`BUG-###`) | [`bug-archive.md`](bug-archive.md) |

---

## Maintenance

Run `/docs-archiving` in **Refresh** mode after the next milestone (tag or major feature). It will snapshot the then-current progress into a new dated `archive/progress/…` file, re-slim the living `claude-progress.md`, repoint any newly-archived references, and add a row to this table. See the skill's Refresh mode for the exact steps.
