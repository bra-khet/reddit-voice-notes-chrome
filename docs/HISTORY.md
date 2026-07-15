# Project History — Reddit Voice Notes

**Living milestone index.** Updated **2026-07-14** · Current stable on `main`: **v5.11.0 — Preferences full-IDB migration** (browser QA PASS · tagged, push deferred) · Current development: **v6.0 Track A audio-reactive visuals, Phase 3 stackables underway** · Post-ship hardening: **H8 + H13 + H14/BUG-038 closed** · Docs-archiving: **Refresh #3 complete**.

This is the go-to orientation doc: it indexes every major milestone and points to both the **living** documents (current work) and their **archived** history. Read this first when you need to know "what happened before the current feature branch?" — then follow a pointer into [`archive/`](../archive/) only if you need the full detail.

- **Current session log (living):** [`claude-progress.md`](../claude-progress.md) — v5.11.0 shipped; v6.0 Track A all six core spectra, five primary overlays, and Rising Ember/Electric Arc/Lightning stackables complete on its feature branch.
- **Archived progress logs:** [`claude-progress-through-v5.10.0.md`](../archive/progress/claude-progress-through-v5.10.0.md) (v5.9.0 → v5.10.0) · [`claude-progress-through-v5.9.0.md`](../archive/progress/claude-progress-through-v5.9.0.md) (v5.8.0 → v5.9.0) · [`claude-progress-pre-v5.8.0.md`](../archive/progress/claude-progress-pre-v5.8.0.md) (v5.7.0 → v5.4.0) · [`claude-progress-pre-v5.4.0.md`](../archive/progress/claude-progress-pre-v5.4.0.md) (v5.3.10 → v1.0.0 MVP).
- **Architecture (living):** [`architecture/README.md`](architecture/README.md) — map **v3.16**, extension-points **v1.30**, hardening backlog **v2.13**, ADRs 0001–0007 + 0009–0010 Accepted.
- **Current development:** the **v6.0 "Polish & Visual Maturity"** arc. Track A audio-reactive visuals ([roadmap](v6.0.0-custom-styles-refactor.md), [ADR-0007](architecture/adr/0007-audio-reactive-visualizer-core.md), [ADR-0009](architecture/adr/0009-registry-native-sparkle-bokeh.md), [ADR-0010](architecture/adr/0010-bubbles-label-stable-bokeh-id.md)) has completed its carrier/runtime, guarded prefs, registry-native Sparkle/Bubbles, all six core spectra, the real-MP4 120-second size harness, five primary simulation overlays through Glitch, and ordered Rising Ember, Electric Arc corona, and sustained Lightning stackables. Conway Life is next on that seam. Track B direct-manipulation background layout ([roadmap](v6.0.0-background-panel-refactor.md), [ADR-0008](architecture/adr/0008-background-direct-manipulation-layout.md)) remains planned on its sibling branch.

---

## Major milestones

Newest first. **Tag** = git tag on `main`. Docs marked *(archived)* live under [`archive/docs/`](../archive/docs/); all others are living in [`docs/`](.).

| Version | Date | Focus / outcome | Notes |
|---------|------|-----------------|-------|
| **v5.11.0** | 2026-07-12 (code) · **2026-07-13 QA** | **Preferences full-IDB migration** — durable `UserPreferencesV1` moves from one large `chrome.storage.local` blob into extension-origin IndexedDB `rvnUserPrefs` (`global` / `profiles` / `customStyles`); `rvnUserPrefs.v2` is signal-only; Reddit content scripts relay load/replace; Studio Export/Import + size telemetry. Public API stays v1. **Real-browser QA PASS**; **tagged `v5.11.0`** 2026-07-13 (merged to `main`, push deferred). | [`release-notes-v5.11.0.md`](release-notes-v5.11.0.md); living: [`v5.11.0-prefs-storage-refactor.md`](v5.11.0-prefs-storage-refactor.md), [ADR-0006](architecture/adr/0006-user-preferences-full-idb.md); checklist `.ignore/QA-5.11.0/` |
| **v5.10.0** | 2026-07-11 (code) · **2026-07-12 QA** | **Raw Trim Apply** — the raw capture WebM is trimmed with the base MP4 (audio-only, sample-accurate Opus via mediabunny) and `baseRecording` re-stamped in the same atomic apply, so **post-trim voice re-apply / Change Voice work again** (v5.9's voice lock is now only the honest fallback when the raw leg can't run). Zero UI code — the Voice panel re-enables emergently. **Real-browser QA PASS**; **tagged `v5.10.0`** (push deferred). | [`release-notes-v5.10.0.md`](release-notes-v5.10.0.md), [`v5.10.0-raw-trim-apply-roadmap.md`](v5.10.0-raw-trim-apply-roadmap.md) |
| **v5.9.0** | 2026-07-11 | **Atomic Trim Apply** — Apply trim materializes the v5.8 intent: shorter `baseMp4`, cue shift (preview=apply, both transcript copies), H6 re-stamp with `bakedMp4`/`baseRecording` dropped (re-bake + voice lock). Post-QA: Reddit panel transcription promote fix; fractional trim OUT. **Tagged `v5.9.0`**. | [`release-notes-v5.9.0.md`](../archive/docs/release-notes-v5.9.0.md) *(archived)*; living: [`v5.9.0-trim-apply-roadmap.md`](v5.9.0-trim-apply-roadmap.md) |
| **v5.8.0** | 2026-07-10 | **Timeline Visual Subtitle Editor (Phase 3 trim UI)** — flat cue-list modal replaced by a DOM timeline editor: draggable/resizable cue bars, stage-mode + log-zoom + minimap, waveform lane, hysteresis snap + guides, keyboard/undo/multi-select, on-bar smart suggestions, and non-destructive ✂ trim **intent** via `planTrim`. Backend (v5.6/v5.7) unchanged; atomic trim apply deferred. **Tagged `v5.8.0`**. | [`release-notes-v5.8.0.md`](../archive/docs/release-notes-v5.8.0.md) *(archived)*; living: [`v5.8.0-trim-ui-visual-subtitle-editor.md`](v5.8.0-trim-ui-visual-subtitle-editor.md), [`v5.8.0-scope.md`](v5.8.0-scope.md) |
| **v5.7.0** | 2026-07-08 | **Partial re-bake splice (Phase 2b)** — cue edits re-encode only keyframe-aligned dirty GOPs from the clean base; self-verifying kept-region pixel-equality gate (the avcC hazard); `experimental.partialRebakeSplice` **default-on** after AVC+VP9 single-machine QA. **Tagged `v5.7.0`**. | [`release-notes-v5.7.0.md`](../archive/docs/release-notes-v5.7.0.md) *(archived)*; living: [`v5.6.0-audio-decoupling.md`](v5.6.0-audio-decoupling.md) §4.2/§13, [ADR-0005](architecture/adr/0005-partial-rebake-splice.md) |
| **v5.6.0** | 2026-07-08 | **Audio decoupling & voice re-apply** — `TakeVoiceStamp`, Dulcet II re-render, stream-copy remux (visuals bit-exact); editing backend scaffolds (timeline, dirty tracker, partial-rebake planner, trim backend). **Tagged `v5.6.0`**. | [`release-notes-v5.6.0.md`](../archive/docs/release-notes-v5.6.0.md) *(archived)*; living: [`v5.6.0-audio-decoupling.md`](v5.6.0-audio-decoupling.md), [ADR-0004](architecture/adr/0004-audio-decoupling-voice-reapply.md) |
| **v5.5.1** | 2026-07-07 | **Browser composite default-on** — `experimental.browserComposite` true by default + rollout migration (Overlay Lab dev-only made v5.5.0 opt-in unreachable in production). **Tagged `v5.5.1`**. | [`release-notes-v5.5.1.md`](../archive/docs/release-notes-v5.5.1.md) *(archived)* |
| **v5.5.0** | 2026-07-07 | **Browser-side Full Composite** — mediabunny in-page decode/blend/encode/mux eliminates FFmpeg alphamerge wall; QA hardening (AAC PTS, cue editor, unfocused cap-stop). **Tagged `v5.5.0`**. | [`release-notes-v5.5.0.md`](../archive/docs/release-notes-v5.5.0.md) *(archived)*; living: [`v5.5.0-browser-composite-migration.md`](v5.5.0-browser-composite-migration.md), [ADR-0003](architecture/adr/0003-composite-stage-elimination.md) |
| **v5.4.0** | 2026-07-06 | **Design Studio First** — Studio becomes the standalone recording suite; Take lifecycle (`rvn.take.current`), live WYSIWYG capture, Reddit attach mode, WebCodecs bake default-on, H6 crash-safety. **Tagged `v5.4.0`**. | [`release-notes-v5.4.0.md`](../archive/docs/release-notes-v5.4.0.md) *(archived)*; living: [`5.4.0-…-roadmap.md`](5.4.0-design-studio-first-standalone-voice-notes-suite-roadmap.md), [ADR-0002](architecture/adr/0002-take-lifecycle-storage-sync.md) |
| **v5.3.10** | 2026-07-05 | **WebCodecs Per-Chunk Encoding** — dual color+alpha VP8 streams; normalize stage eliminated by construction. | [`release-notes-v5.3.10.md`](../archive/docs/release-notes-v5.3.10.md) *(archived)*; living: [`5.3.10-webcodecs-per-chunk-encoding.md`](5.3.10-webcodecs-per-chunk-encoding.md), [ADR-0001](architecture/adr/0001-webcodecs-encoding-backbone.md) |
| **v5.3.9** | 2026-07-04 | **Parallel Chunked Bake (Phase 3)** — N concurrent MediaRecorder capture loops; perf regression found + fixed same day (5.3.9.1). | [`release-notes-v5.3.9.md`](../archive/docs/release-notes-v5.3.9.md) *(archived)*; living: [`5.3.9-worker-and-chunked-parallelization-design.md`](5.3.9-worker-and-chunked-parallelization-design.md) |
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
| Voice DSP (Dulcet II) | [`v5-development-roadmap.md`](v5-development-roadmap.md), [`dsp-foundation-design.md`](dsp-foundation-design.md) |
| Latest ship (preferences full-IDB migration) | [`release-notes-v5.11.0.md`](release-notes-v5.11.0.md), [`v5.11.0-prefs-storage-refactor.md`](v5.11.0-prefs-storage-refactor.md) |
| Open issues / future ideas | [`deferred-issues.md`](deferred-issues.md), [`future-ideas.md`](future-ideas.md) |
| Bug history (`BUG-###`) | [`bug-archive.md`](bug-archive.md) |

---

## Maintenance

Run `/docs-archiving` in **Refresh** mode after the next milestone (tag or major feature). It will snapshot the then-current progress into a new dated `archive/progress/…` file, re-slim the living `claude-progress.md`, repoint any newly-archived references, and add a row to this table. See the skill's Refresh mode for the exact steps.

**Refresh history:** #1 @ v5.8.0 (2026-07-10) · #2 @ v5.9.0 (2026-07-11) · **#3 @ v5.10.0 (2026-07-12)** — progress through v5.10.0 archived; release notes through v5.9.0 archived; living notes = v5.10.0 only.
