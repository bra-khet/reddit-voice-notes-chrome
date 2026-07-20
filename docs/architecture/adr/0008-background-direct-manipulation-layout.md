# ADR-0008: Background direct-manipulation layout (Design-phase)

- **Status:** Accepted
- **Date:** 2026-07-14 (proposed) · **Accepted:** 2026-07-20 (Track B branch open / implementation track) · **Amended:** 2026-07-20 (Phase 5 blend plate; Phase 6 framing/live compare)
- **Reflects branch/tag:** `feature/v6.0.0-background-panel-refactor` (fast-forwarded to `main@2b42db5` post Track A + C; v5.11.0 package baseline)
- **Deciders:** v6 planning session (roadmap synthesis) · Track B init (branch open)

## Context

v6 elevates the personal-background control from a 9-direction grid + fit/fill (`src/ui/design-studio/background-layout-controls.ts`) into a tactile direct-manipulation system (drag, precision widget, magnetic snapping, zoom, presets, effects). Trigger: `docs/v6.0.0-background-panel-refactor.md` (from supplemental-A).

The load-bearing constraint the source doc glosses: the background is **captured into the WebM at record time** (`drawImageBackground`, `backgrounds.ts:134` → `captureStream` → `baseRecording`); the bake never re-renders it (I3). So "drag the image and edit the clip" is not a post-capture operation here. Additional facts: dim is currently a **constant** (`USER_BACKGROUND_DIM_OVERLAY`), not a field; the pipeline is **16:9-only**; `timeline-geometry.ts` is pure but 1-D/time-domain; undo is host-owned; `interaction-utils.ts` does not exist; cividis tokens do not exist as CSS vars.

## Decision

Ship direct manipulation as a **Design-phase, pre-capture surface** on the Studio `renderThemePreview` hero canvas: dragging writes a normalized `customPosition {x,y}` that hot-swaps via `setUserBackgroundLayout` and is captured by the *next* recording (WYSIWYG per I1). Extend `UserBackgroundLayout` with `customPosition / manualScale / dim / blur / blendMode / blendPlateSource / blendPlateColor / holo / gifSpeed / gifReactToAudio / lockToSafeText`, all `normalize`-guarded, persisted additively (no version bump). The blend plate is one solid draw-time fill beneath the personal image—not a second image or layer—and defaults to the exact legacy theme underlay. Reuse `timeline-geometry` **math patterns** via a new domain-neutral `src/ui/design-studio/interaction-utils.ts` (Roadmap B owns it); re-implement the ~30-line wheel/undo wiring for 2-D. Multi-aspect ships as **DOM-only crop-guide overlays** on the 16:9 canvas, not multi-format export. Theme-only comparison is transient, keeps the resolved theme/style preview clock alive with only personal media removed, is mutually exclusive with preset audition, never persists, and restores the exact committed layout/media plus decode-gates before capture.

## First-class concern impact

- **Preview ↔ bake:** Direct manipulation edits the *preview*, which is the pre-capture design of the next recording (I1). Crop/thirds overlays remain outside the canvas bitmap; Theme-only compare continues the current theme/style motion while personal media is absent, then restores and waits for background readiness before `MediaRecorder.start()`. No post-capture re-position (would require a bake-time waveform re-render — explicitly out of scope). Subtitles composite live in the preview (`drawSubtitlePreview`), so "position against captions" holds.
- **Effect composition:** No layer reorder. Personal-image order is optional solid blend plate → blended/blurred image (+ opt-in Holo passes) → dim, all within the existing background slot. The legacy source keeps the prior theme underlay exactly.
- **Message contracts:** None. Client-side layout + prefs only.
- **State ownership:** Extends `UserBackgroundLayout` (`types.ts`) + `AppearancePreferences` (recommend a nested `backgroundLayout?`) + `ClipProfile` snapshot; existing IDB prefs (ADR-0006), `normalizeUserBackgroundLayout` guards all; no new store/signal.

## Options considered

1. **Design-phase direct manipulation (this ADR)** — honest to the capture-time architecture, reuses hot-swap + preview, low risk. Cost: reframes the source doc's post-capture expectation; builds a new `interaction-utils.ts`.
2. **Post-capture re-composite** — matches CapCut mental model literally, but requires re-rendering bars+background from stored audio at bake (a new pipeline + fourth-layer risk). Rejected: large, and unnecessary for the voice-note use case.
3. **Keep discrete 9-grid, add only sliders** — cheapest, but misses the "tactile/modern" goal entirely.
4. **Multi-format (9:16/1:1) export** — high effort, pipeline is 16:9-only; rejected in favor of crop-guide framing aids.

## Consequences

- **Positive:** tactile positioning with real hot-swap parity; dim/blur/blend/plate/Holo/GIF controls with bounded Canvas 2D cost and **no bake-size pipeline impact**; a reusable `interaction-utils.ts` seam for future editors; migration-safe (missing fields → legacy discrete + constant dim + legacy plate).
- **Negative / accepted cost:** we deliberately do **not** build post-capture re-positioning or multi-format export; multi-aspect is a preview aid only. We accept re-implementing (not extracting) the ~30-line wheel/undo wiring rather than over-generalizing the timeline editor mid-v6.
- **Follow-ups:** extension-points bump (background layout v2 seam — map was **v3.21** / seams **v1.35** at Track A close) and design-studio.md background-layout section update at Track B merge. The required 120 s blur+GIF size case passed at 23 MiB base / 29 MiB baked. Shared Cividis tokens already landed on Track A.

## References

- Code: `src/theme/backgrounds.ts:134,180,216`, `src/theme/background-layout.ts:39,58`, `src/theme/types.ts:34`, `src/ui/design-studio/background-layout-controls.ts`, `src/ui/design-studio/timeline-geometry.ts` (pure zoom/snap), `src/ui/design-studio/subtitle-timeline-editor.ts:30,1854` (host-undo, wheel), `src/transcription/subtitle-cue-measurement.ts`, `src/settings/user-preferences.ts:105,353`
- Docs: `docs/v6.0.0-background-panel-refactor.md`; architecture-map §3.2/§3.3, I1/I3/I17; `docs/gif-animation-design-implementation.md`; ADR-0006
- Bugs: R18 prefs-gate class (normalize footgun)
