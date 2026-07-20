# Track B — background layout QA (**open · Phase 0–2 DONE**)

**Status:** **OPEN** — Phase 0–2 landed; **operator Phase 1 QA PASS**; Phase 2 operator QA + Phase 3–7 and full merge gate still ahead<br>
**Branch:** `feature/v6.0.0-background-panel-refactor`  
**Commits:** Phase 0 `08a2de5` · Phase 1 `1e3118f` · Phase 2 `b129713` (baseline was `main@2b42db5`)<br>
**Baseline package:** v5.11.0 · Track A confidence PASS · Track C agent gate PASS  
**Roadmap:** [`docs/v6.0.0-background-panel-refactor.md`](../../../docs/v6.0.0-background-panel-refactor.md)  
**ADR:** [0008 — background direct-manipulation layout](../../../docs/architecture/adr/0008-background-direct-manipulation-layout.md)  
**Checklist:** [`qa-checklist.md`](qa-checklist.md) · evidence under `logs/` · `screenshot/` · `artifacts/`

```
track-b/
  README.md           # this file
  qa-checklist.md     # committed gate (Phase 0–2 partial; full gate open)
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
| **2** precision-widget | **DONE · operator QA pending** | Background subpanel mini frame, X/Y readouts, and ±0.01/±0.05 nudges sync with hero. |
| **3+** | Not started | Zoom/snap/undo, presets, dim/blur UI, crop guides, polish |

**Automated (Phase 0–2):** layout **10/10** · direct-manip **6/6** · precision **5/5** · prefs storage **12/12** · `npm run build` **PASS**.

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
| **2** | Precision widget + bidirectional sync | **DONE** `b129713` · operator QA pending |
| **3** | Zoom, sticky snap, undo/redo (`interaction-utils`) | pending |
| **4** | Presets row + live hover preview | pending |
| **5** | Properties/effects + eye-dropper | pending |
| **6** | Multi-aspect crop guides + compare | pending |
| **7** | Keyboard, ARIA, variants, confidence QA | pending |

**Immediate next:** operator-check checklist §4, then Phase 3 — zoom, sticky snap, and layout undo/redo.

Workspace ledger: [`../TODO-6.0.0.md`](../TODO-6.0.0.md) · session log: [`../progress-QA-6.0.0.md`](../progress-QA-6.0.0.md).
