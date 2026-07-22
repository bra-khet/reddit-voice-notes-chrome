# Architecture docs — Reddit Voice Notes

**Updated:** 2026-07-22 · **Reflects:** `feature/v6.0.0-hosted-design-studio` from `main@a4df9a1` @ package `5.11.0` · **v6 Tracks A/B/C merged; Track D Phases 0 + 1 complete; release boundary pending** · **Map:** v3.26 · **Skill:** `/architecture-hardening`

This directory holds the **living, versioned** architecture index for the extension. It is the cross-cutting view — subsystem internals live in the canonical docs listed below.

**Inbound rule:** Any doc or session touching cross-context design, new pipelines, new storage, or new effects should link here and check the extension-points registry before writing code.

---

## Index

| File | Owns | Version |
|------|------|---------|
| [`architecture-map.md`](architecture-map.md) | Cross-cutting architecture: six contexts, current diagrams, first-class concerns, invariants I1–I23, preference publication/relay, recovery traces, v6 registry visuals, and Background Layout v2 | v3.26 |
| [`extension-points.md`](extension-points.md) | Integration seam registry: Background Layout v2, audio-reactive visuals v20, Style/governor, preference storage v2, message pipelines v3, H13 storage rule, Studio/capture, browser/fallback composite, take/audio editing, splice, timeline, trim, and the **Host adapter** (hosted Pages Studio, incl. the in-page pipeline relay and artifact-commit fallback) | v1.41 |
| [`hardening-backlog.md`](hardening-backlog.md) | Ranked hardening: H8/H13/H14 fully closed (browser QA PASS); R18 prefs gate closed; H10 deferred | v2.13 |
| `adr/` | [0001 WebCodecs backbone](adr/0001-webcodecs-encoding-backbone.md) · [0002 Take lifecycle storage sync](adr/0002-take-lifecycle-storage-sync.md) · [0003 Composite-stage elimination](adr/0003-composite-stage-elimination.md) · [0004 Audio decoupling](adr/0004-audio-decoupling-voice-reapply.md) · [0005 Partial re-bake splice](adr/0005-partial-rebake-splice.md) · [0006 Full-IDB preferences](adr/0006-user-preferences-full-idb.md) · [0007 Audio-reactive core](adr/0007-audio-reactive-visualizer-core.md) · [0008 Background layout](adr/0008-background-direct-manipulation-layout.md) · [0009 Registry-native Sparkle/Bokeh](adr/0009-registry-native-sparkle-bokeh.md) · [0010 Bubbles label / stable key](adr/0010-bubbles-label-stable-bokeh-id.md) | 0001–0010 Accepted |

---

## Canonical docs (win on their topic — never duplicated here)

| Doc | Owns |
|-----|------|
| `docs/design-studio.md` | Studio semantics through merged v6 tracks: native capture, Style, Background Layout v2, preview=bake, timeline/trim + raw WebM, dirty layers, storage map, outbound index |
| `docs/transcription-architecture.md` | Vosk sandbox CSP stack + current browser-composite / FFmpeg fallback bake ladder |
| `docs/engineering-principles.md` | Semantic health, save pathways, ImageDB, pipeline-native effects |
| `docs/bug-archive.md` | `BUG-###` history (Phase-3 raw material) |
| `docs/v4-development-principles.md` | Branch model, compositing, WASM queues, sprint hygiene |
| `docs/5.4.0-design-studio-first-standalone-voice-notes-suite-roadmap.md` | v5.4.0 Phase 0 as-built (TakeManager) |
| `docs/5.3.10-webcodecs-per-chunk-encoding.md` | WebCodecs backbone as-built (§0) |
| `docs/v5.6.0-audio-decoupling.md` | Audio decoupling + editing/timeline backend + partial-splice contract (§4.2, §13) |
| `docs/v5.8.0-trim-ui-visual-subtitle-editor.md` | Timeline visual subtitle editor as-built (v5.8.0) |
| `docs/v5.9.0-trim-apply-roadmap.md` | Atomic trim apply as-built (v5.9.0) |
| `docs/v5.10.0-raw-trim-apply-roadmap.md` | Raw-WebM trim as-built (v5.10.0) — post-trim voice re-apply restored; real-browser QA PASS 2026-07-12 |
| `docs/v5.11.0-prefs-storage-refactor.md` | Full-IDB preference migration + relay + Export/Import — **browser QA PASS 2026-07-13 · merge-ready** |
| `docs/v6.0.0-custom-styles-refactor.md` | **v6 merged** — complete audio-reactive catalog + Style Control Center/governor (ADR-0007/0009/0010) |
| `docs/v6.0.0-background-panel-refactor.md` | **v6 merged · full QA PASS** — direct-manipulation Background Layout v2 (Design-phase; ADR-0008) |
| `docs/v6.0.0-hosted-design-studio.md` | **v6 Track D · Phase 0 landed** — hosted GitHub Pages Design Studio: `browser` global shim, in-page pipeline host, first-load budget/chronos gate, hub positioning |
| `docs/static-voice-studio-design.md` | The existing Pages demo (Voice Lab, formerly "Voice Studio") + GitHub Actions deploy pattern; hub/nav-banner WIP markers now Track D-owned |
| `docs/release-notes-v5.11.0.md` | Latest tagged release notes (prior versions under `archive/docs/`); v6 release notes remain the next explicit release sprint |
| `src/session/take-manager.ts` (header) | Take lifecycle contract |
| `claude-progress.md` | Session timeline + release tags |

---

## Update triggers (when to re-run `/architecture-hardening`)

- New execution context (side panel, options page) or a worker adopted for the encode loop (ADR-0001 named this follow-up).
- A **new host** for existing context code (Track D's Pages Studio), or the host adapter growing past relaying into policy decisions — the latter is the ADR-0011 trigger.
- New `MSG_<NAME>_*` pipeline family or a query message growing lifecycle semantics.
- New IDB store, new `rvn.*` storage key, new `TakeStatus`/`TakeArtifactKind`, or a **fourth take writer**.
- New overlay encoder strategy, or an encoder/parallel flag default flip (rerun the observability check, backlog H10).
- New visual effect touching the preview=bake boundary, or a fourth compositing layer (ADR required).
- A bug class from `docs/bug-archive.md` recurs — indicates a systemic gap.
- Before any major refactor (prefs, relay, offscreen lifecycle, TakeManager writers).
- Before pushing / tagging a release: confirm map version reflects the tag.
- Any artifact save function changing caps/error behavior: re-check H13's persist-before-stamp contract.
- Any recoverable pipeline moving its only COMPLETE handler, timeout, or durable save into a tab: re-check H14/BUG-038's background terminal-owner contract.

## Version policy

- `architecture-map.md`: bump MINOR for additive content, MAJOR when a context/pipeline/storage class is added or removed.
- `extension-points.md`, `hardening-backlog.md`: version independently by seam/sprint.
- Never create `architecture-map-v2.md` — update in place.
- ADRs are immutable once Accepted; supersede with a new ADR instead of editing.

## Standards

- Diagrams embedded inline (Mermaid fenced blocks) — render-checked before commit.
- Each diagram has one sentence above (what it shows + what to verify it against) and the invariant(s) it encodes below.
- Every living doc ends with a carry-forward block for cold-session re-seeding.
- All ADRs use `adr/NNNN-short-title.md` (zero-padded, incrementing — 0011 is next).

## Resume in a new chat (carry-forward)

```
architecture-hardening resume.
Repo: Reddit Voice Notes, branch feature/v6.0.0-hosted-design-studio from main@a4df9a1 @ package 5.11.0; v6 Tracks A/B/C merged, Track D Phase 0 LANDED (hosted Studio mounts), explicit release/tag pending.
Map v3.26 · seams v1.41 · backlog v2.13 · ADRs 0001–0010 Accepted (0011 unallocated); six contexts unchanged.
Track D = hosted Pages Design Studio: real src/ under a `browser` GLOBAL shim (WXT auto-import; zero explicit
imports and zero module-scope browser.* in src/), offscreen module loaded in-page over a loopback bus. Second
HOST, not a 7th context. Seam "Host adapter — v1"; canonical docs/v6.0.0-hosted-design-studio.md.
v5.11 prefs remain rvnUserPrefs IDB truth + signal-only rvnUserPrefs.v2 (I21 High).
H8/H13/H14 remain closed; raw trim + recovery invariants unchanged.
v6 Track A Phase 1 user QA PASS; Sparkle + Bubbles (`bokeh` stability key) are registry-native and capped.
I22: live capture and synthetic preview share normalized energy, 32 bands, optional waveform, clock, and bounded per-canvas visual state.
Composition stays record-time background→overlay→bars; subtitles are the only post-base visual pass (I3).
I23: Background Layout v2 is normalized Design-phase state shared by Studio preview and recorder draw; captured base pixels are never repositioned post-capture.
Classic owns default/fallback; Minimal is the a11y meter; Phosphor is a ≤240-cell CRT; Radial adds a capped mirrored polar ring; Central adds a capped centered organic orb.
Forest Spirits uses ≤48 pooled agents / ≤192 elements. Digital Rain uses a 14×9–32×18 activation grid / ≤577 elements. Inferno uses curl flow + 28–72 lifetime particles / ≤219 elements. Aurora reuses flow/emitter for 100–200 local-geometry ribbon shards / ≤403 elements. Glitch uses 12–36 scanlines + ≤10 source-copy tears / ≤81 elements. Ordered stackables are Rising Ember at 16–44 cinders / ≤132, Electric Arc at 6–18 corona streamers / ≤300, sustained Lightning at 14–30 route points + ≤5 branches / ≤158, Conway Life on a dead-edge 48×16 B3/S23 lattice / ≤769, Layered Smoke at 4–10 plumes × 9 fixed-ring nodes / ≤280, Neon Glow at 3–7 continuous 18-point tubes + two charge knots / ≤49, and Particle Burst at 14–28 onset shards × ≤3 blooms / ≤261. Track A focused gates are 226/226.
Automated artifact harness: npm run qa:visual-size -- --preset <id> --base <base.mp4> --baked <baked.mp4>.
Size ceiling for novel effects: base ≤25 MB / baked ≤30 MB on 120 s QA.
Background Layout v2: prefs → hero/precision/presets/treatments → recorder hot-swap/relay → one personal-image slot; crop/compare/A-B transient. Track B full operator checklist + focused 89/89 + blur/GIF 23/29 MiB PASS.
Read architecture-map.md, extension-points.md, ADR-0007/0008/0009/0010, and the v6 roadmaps (A/B/C + Track D).
Phase 0 as-built: demo `@` alias -> repo root (12 duplicate DSP modules deleted), demo/design-studio/host/
shim, Studio assets vendored whole-tree, deploy workflow watches src/**. HOST-NEUTRALITY RULES now binding:
use src/utils/host-origin.ts isOwnStorageOrigin() (never location.protocol); reach packaged assets via
browser.runtime.getURL() (never '/assets/...'); keep browser.* in function bodies; root tsconfig EXCLUDES
demo/; npm run compile must stay zero-error because demo's build gates on tsc.
Next: Track D Phase 1 (record + take lifecycle over the in-page loopback pipeline; check C1 lands there),
then the explicit v6.0.0 package/release-notes/tag sprint; push remains user-owned.
```
