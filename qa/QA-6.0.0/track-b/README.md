# Track B — background layout QA (**open · scaffold ready**)

**Status:** **OPEN** — branch fast-forwarded to current `main` (post Track A + Track C); implementation not started  
**Branch:** `feature/v6.0.0-background-panel-refactor`  
**Baseline:** `main@2b42db5` (v5.11.0 package · Track A confidence PASS · Track C agent gate PASS)  
**Roadmap:** [`docs/v6.0.0-background-panel-refactor.md`](../../../docs/v6.0.0-background-panel-refactor.md)  
**ADR:** [0008 — background direct-manipulation layout](../../../docs/architecture/adr/0008-background-direct-manipulation-layout.md)  
**Checklist:** [`qa-checklist.md`](qa-checklist.md) · evidence under `logs/` · `screenshot/` · `artifacts/`

```
track-b/
  README.md           # this file
  qa-checklist.md     # committed gate (open)
  logs/               # gitignored evidence
  screenshot/         # gitignored evidence
  artifacts/          # gitignored evidence (size/parity packets when needed)
```

## Framing (load-bearing)

Background is painted at **record time** (`drawImageBackground` → `captureStream` → `baseRecording`). Bake never re-renders it (**I3**). Direct manipulation is a **Design-phase pre-capture** surface on the Studio hero (`renderThemePreview`): WYSIWYG means **"arranges the next recording"** (**I1**). You cannot re-position an already-recorded take.

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

| Phase | Focus | Sub-branch hint |
|-------|--------|-----------------|
| **0** | Types + normalize + compute (dim field, `customPosition` path) | `layout-core` |
| **1** | Direct canvas drag + focal affordances | `direct-drag` |
| **2** | Precision widget + bidirectional sync | `precision-widget` |
| **3** | Zoom, sticky snap, undo/redo (`interaction-utils`) | `interaction-utils` |
| **4** | Presets row + live hover preview | `presets` |
| **5** | Properties/effects + eye-dropper | `properties-effects` |
| **6** | Multi-aspect crop guides + compare | `framing-aids` |
| **7** | Keyboard, ARIA, variants, confidence QA | `polish-qa` |

**Immediate next code sprint:** Phase 0 — extend `UserBackgroundLayout`, promote `dim`, `customPosition` offset path, full `normalize*` guards, `test-background-layout.mjs`. Acceptance: **zero visual change** for existing users.

Workspace ledger: [`../TODO-6.0.0.md`](../TODO-6.0.0.md) · session log: [`../progress-QA-6.0.0.md`](../progress-QA-6.0.0.md).
