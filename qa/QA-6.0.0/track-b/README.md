# Track B — background layout QA (**open · Phase 0–5 DONE**)

**Status:** **OPEN** — Phase 0–5 landed; **operator Phase 1–4 QA PASS**; Phase 5 operator QA, Phase 6–7, and full merge gate still ahead<br>
**Branch:** `feature/v6.0.0-background-panel-refactor`  
**Commits:** Phase 0 `08a2de5` · Phase 1 `1e3118f` · Phase 2 `b129713` · Phase 3 `844a81f` · Phase 4 `1166d51` · Phase 5 `16e3dd0` (baseline was `main@2b42db5`)<br>
**Baseline package:** v5.11.0 · Track A confidence PASS · Track C agent gate PASS  
**Roadmap:** [`docs/v6.0.0-background-panel-refactor.md`](../../../docs/v6.0.0-background-panel-refactor.md)  
**ADR:** [0008 — background direct-manipulation layout](../../../docs/architecture/adr/0008-background-direct-manipulation-layout.md)  
**Checklist:** [`qa-checklist.md`](qa-checklist.md) · evidence under `logs/` · `screenshot/` · `artifacts/`

```
track-b/
  README.md           # this file
  qa-checklist.md     # committed gate (Phase 0–5 partial; full gate open)
  logs/               # gitignored evidence
  screenshot/         # gitignored evidence
  artifacts/          # gitignored evidence (size/parity packets when needed)
```

## Framing (load-bearing)

Background is painted at **record time** (`drawImageBackground` → `captureStream` → `baseRecording`). Bake never re-renders it (**I3**). Direct manipulation is a **Design-phase pre-capture** surface on the Studio hero (`renderThemePreview`): WYSIWYG means **"arranges the next recording"** (**I1**). You cannot re-position an already-recorded take.

## What shipped so far

| Phase | Status | What you should see |
|-------|--------|---------------------|
| **0** layout-core | **DONE** | Under the hood only — nested layout, normalize, draw path. Old 9-grid still the side panel. |
| **1** direct-drag | **DONE · operator QA PASS** | Click/drag personal background on the **main live preview**. |
| **2** precision-widget | **DONE · operator behavior PASS** | Background subpanel mini frame, X/Y readouts, and ±0.01/±0.05 nudges sync with hero. |
| **3** interaction-utils | **DONE · operator QA PASS** | Spatial X/Y console, single/double chevrons, physical sliders, cursor-anchored zoom, sticky guides, caption-safe lock, and isolated undo/redo. |
| **4** presets | **DONE · operator QA PASS** | Four Aurora/Warm Glow image-layout recipes; hover/focus auditions without saving; selection + Apply persists. Capture now restores and locks auditions before recording. |
| **5** properties/effects | **DONE · operator QA pending** | Darkroom dim/blur/blend controls, GIF speed/voice response, and permission-free preview-canvas eye-dropper. |
| **6+** | Not started | Crop guides, compare, keyboard/ARIA/variants, confidence polish |

**Automated (Phase 0–5):** focused layout/interaction/UI set **69/69** (layout 11 · direct-manip 8 · precision 5 · interaction utils 6 · control UI 10 · presets 5 · canvas sampler 5 · caption geometry 7 · prefs storage 12) · UI tokens PASS · visual-size gate logic 5/5 · `npm run build` **PASS** · compile only the same 2 pre-existing subtitle diagnostics.

## Scope reminder

| In | Out |
|----|-----|
| Direct drag / zoom / snap on hero preview | Post-capture background re-position |
| `customPosition` + `manualScale` + field `dim` | Multi-format (9:16/1:1) **export** |
| Precision widget, presets, blur/blend/GIF props | Video backgrounds, new deps/WASM |
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
| **5** | Properties/effects + eye-dropper | **DONE** `16e3dd0` · operator QA pending |
| **6** | Multi-aspect crop guides + compare | pending |
| **7** | Keyboard, ARIA, variants, confidence QA | pending |

**Immediate next:** operator-check Phase 5 checklist §6–§7, including recording-safe hover lockout and the real 120 s blur+GIF size case; then implement Phase 6 framing aids.

Workspace ledger: [`../TODO-6.0.0.md`](../TODO-6.0.0.md) · session log: [`../progress-QA-6.0.0.md`](../progress-QA-6.0.0.md).
