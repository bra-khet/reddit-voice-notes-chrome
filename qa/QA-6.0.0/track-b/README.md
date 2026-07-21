# Track B — background layout QA (**closed · full PASS · merged**)

**Status:** **CLOSED — full operator checklist PASS; merged to `main` at `7d1c649`**<br>
**Branch:** `feature/v6.0.0-background-panel-refactor` (merged; final implementation `bdae9ab`)
**Commits:** Phase 0 `08a2de5` · Phase 1 `1e3118f` · Phase 2 `b129713` · Phase 3 `844a81f` · Phase 4 `1166d51` · Phase 5 `16e3dd0` · Phase 6 `e7346ca` · Phase 7 `3c18b42` · final presentation `7095452` / `bdae9ab`<br>
**Baseline package:** v5.11.0 · Track A confidence PASS · Track C agent gate PASS  
**Roadmap:** [`docs/v6.0.0-background-panel-refactor.md`](../../../docs/v6.0.0-background-panel-refactor.md)  
**ADR:** [0008 — background direct-manipulation layout](../../../docs/architecture/adr/0008-background-direct-manipulation-layout.md)  
**Checklist:** [`qa-checklist.md`](qa-checklist.md) · evidence under `logs/` · `screenshot/` · `artifacts/`

```
track-b/
  README.md           # this file
  qa-checklist.md     # committed full PASS gate
  logs/               # gitignored evidence
  screenshot/         # gitignored evidence
  artifacts/          # gitignored evidence (size/parity packets when needed)
```

## Framing (load-bearing)

Background is painted at **record time** (`drawImageBackground` → `captureStream` → `baseRecording`). Bake never re-renders it (**I3**). Direct manipulation is a **Design-phase pre-capture** surface on the Studio hero (`renderThemePreview`): WYSIWYG means **"arranges the next recording"** (**I1**). You cannot re-position an already-recorded take.

## What shipped so far

| Phase | Status | What you should see |
|-------|--------|---------------------|
| **0** layout-core | **DONE** | Under the hood only — nested layout, normalize, draw path. The old 9-grid remained during Phase 0; final closeout retired its redundant UI while preserving migration fields. |
| **1** direct-drag | **DONE · operator QA PASS** | Click/drag personal background on the **main live preview**. |
| **2** precision-widget | **DONE · operator behavior PASS** | Background subpanel mini frame, X/Y readouts, and ±0.01/±0.05 nudges sync with hero. |
| **3** interaction-utils | **DONE · operator QA PASS** | Spatial X/Y console, single/double chevrons, physical sliders, cursor-anchored zoom, sticky guides, caption-safe lock, and isolated undo/redo. |
| **4** presets | **DONE · operator QA PASS** | Four Aurora/Warm Glow image-layout recipes; hover/focus auditions without saving; selection + Apply persists. Capture now restores and locks auditions before recording. |
| **5** properties/effects | **DONE · operator PASS** | Darkroom effects/GIF, recorder no-flash authority, added blends/Holo, six-source solid blend plate, and hero+precision canvas sampling. |
| **6** framing aids | **DONE · operator PASS** | Native/1:1/9:16 crop lab, independent thirds, live current-look-minus-media compare, hard preset exclusion, and decode-safe recording restore. |
| **7** polish/QA | **DONE · operator PASS** | Responsive Position Preview; focused-frame coarse/fine arrows, +/- zoom and Esc/icon Center; numeric ARIA/live status; session-only next-take A/B framing. Redundant legacy sizing/position groups retired. |

**Automated (final):** focused layout/interaction/UI set **89/89** · UI tokens PASS · visual-size gate logic 5/5 · `npm run build` **PASS** · compile only the same 2 pre-existing subtitle diagnostics. Real blur/GIF gate: **23 MiB base / 29 MiB baked — PASS**.

## Scope reminder

| In | Out |
|----|-----|
| Direct drag / zoom / snap on hero preview | Post-capture background re-position |
| `customPosition` + `manualScale` + field `dim` | Multi-format (9:16/1:1) **export** |
| Precision widget, presets, blur/blend/solid-plate/Holo/GIF props | Video backgrounds, new deps/WASM |
| `interaction-utils.ts` (B owns) | `USER_PREFS_VERSION` bump |
| Crop-guide framing aids on 16:9 canvas | Fourth compositing layer |

**Shared already landed (Track A):** Cividis tokens (`src/ui/tokens.ts` + `--rvn-cividis-*`) · Style Control Center · full audio-reactive catalog.

## Implementation phases (roadmap §7)

| Phase | Focus | Status |
|-------|--------|--------|
| **0** | Types + normalize + compute (dim field, `customPosition` path) | **DONE** `08a2de5` |
| **1** | Direct canvas drag + focal affordances | **DONE** `1e3118f` · operator QA PASS |
| **2** | Precision widget + bidirectional sync | **DONE** `b129713` · operator behavior PASS |
| **3** | Zoom, sticky snap, safe-text lock, undo/redo + positioning-console redesign | **DONE** `844a81f` · operator QA PASS |
| **4** | Presets row + live hover preview | **DONE** `1166d51` · operator QA PASS; recording guard in `16e3dd0` |
| **5** | Properties/effects + eye-dropper | **DONE** `16e3dd0` + follow-ups · operator PASS |
| **6** | Multi-aspect crop guides + compare | **DONE** `e7346ca` + live-compare follow-up · operator PASS |
| **7** | Keyboard, ARIA, variants, confidence QA | **DONE · operator PASS** `3c18b42` + final presentation follow-ups |

**Closeout:** every checklist row passed, including saved-profile load, identity hot-swap, Classic/default, popup coherence, parity, accessibility, and the final Center/precision presentation. Next work is the explicit v6.0.0 release/version/tag sprint; package remains 5.11.0 here.

Workspace ledger: [`../TODO-6.0.0.md`](../TODO-6.0.0.md) · session log: [`../progress-QA-6.0.0.md`](../progress-QA-6.0.0.md).
