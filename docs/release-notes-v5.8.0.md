# Release notes — v5.8.0 **Timeline Visual Subtitle Editor** (Phase 3 Trim UI)

**Tag:** `v5.8.0` · **Date:** 2026-07-10  
**Prior stable:** `v5.7.0`  
**Branch:** merged `feature/v5.8.0-trim-ui-visual-subtitle-editor` → `main`  
**Design (authoritative, as-built):** [`v5.8.0-trim-ui-visual-subtitle-editor.md`](v5.8.0-trim-ui-visual-subtitle-editor.md) · **Scope card:** [`v5.8.0-scope.md`](v5.8.0-scope.md)  
**Restore:** `git checkout main && npm install && npm run dev`

---

> **The headline:** the flat cue-list modal is now a professional timeline editor — drag/resize cue bars on a zoomable stage over a live audio waveform, with every fix suggestion surfaced *where the problem is* and a non-destructive trim mode that previews the cut before anything is stored. Every prior affordance survives (§7 parity gate), the List view remains one toggle away, and the bake path is untouched — small edits still splice partially (v5.7.0) with zero behavior change.

---

## What shipped

### The timeline stage
- **DOM + CSS-transform cue bars** (design §3B — not canvas): body-drag to move, 16 px edge handles to resize (outboard "ears" below 44 px), clamp-to-neighbor overlap policy, frame-exact snapping through `timeline.ts` (preview=bake, I11).
- **Stage-mode modal** (§16.1): Timeline view expands the dialog to a landscape stage (~300 ms settle; instant under reduced-motion) with a docked inspector rail (numeric Start/End, live text, fit status, actions) and a transport bar (▶ selected cue · mono timecode · + Cue · ✂ Trim · zoom cluster).
- **Log-zoom view window** (§16.2): 1× fit → 4-frame cap; anchored Ctrl+wheel zoom, wheel pan, Fit/Sel/±/slider, minimap with draggable lens + selected-cue highlights. All sec↔px flows through the window, so **snap precision scales with zoom automatically**.
- **Feel pass** (§16.3–16.4, §16.6): hysteresis snapping (magnets hold until a deliberate pull) with snap guides + acquisition flash, Esc cancels any gesture, auto-pan at the track edges, grab-lift with spring settle, teardrop playhead cap, high-contrast mono ruler.
- **Waveform lane** (§16.5): 48 px canvas painted from the **same decoded AudioBuffer the ▶ preview plays** (zero extra decode) via the pure `waveform-peaks.ts` leaf — pyramid resample at low zoom, exact range peaks at deep zoom, view-only gain normalizing quiet voice takes, repaint only when the view/source changes. Element-mode fallback = quiet line.

### Parity, keyboard, undo, multi-select (§7 + §16.7)
- ⚠ LONG / ⚠ OOB pills and warning tints on bars from the **same** fit cache/heuristics as the list rows; live fit-status line (canvas/estimate) in the inspector; ✂ Split (same >1-chunk rule), 🗑 delete, **+ Cue at the playhead**; scaffold ghosts; unsaved guard unchanged.
- Keyboard: ←/→ rove (view follows), ↑/↓ frame-nudge (hold accelerates), Space play, Enter → text, Del delete — with `aria-live` announcements.
- **Modal-session undo/redo** (Ctrl+Z / Ctrl+Y): bounded snapshot stack at discrete gesture starts — one undo reverts one perceived action.
- **Multi-select**: Ctrl-click toggle, Shift-click range (resolved on pointer-up); batch nudge/delete; zoom-to-selection frames the whole selection.

### Smart integration (§8)
- Cues needing attention (overflow / OOB) get the **amber attention halo + numbered priority dot** (§4.1 amber-action family, matching the Smart Adjust affordance) — one-word-shift-fixable overflow ranks first. Detection reuses the existing pure logic only.
- Inspector callout: **⚡ Apply minimal fix** (proposal re-derived fresh per click; flows through `applySmartAdjustProposal`, one Ctrl+Z reverts) and **Smart Adjust…** pre-contextualized to the cue. **Validate all** paints fresh canvas verdicts onto the bars.

### Non-destructive trim (§10 — intent only)
- **✂ Trim mode**: draggable/keyboardable in/out markers (cue-edge magnetism, frame snap, 1 s minimum keep), warning-striped veils over the cut regions, **ghost bars previewing each surviving cue at its post-trim position** (live during marker *and* cue drags), amber overhang warnings on cues outside the kept region, `Keep N.Ns · Δ −N.Ns` readout.
- **Save trim** validates through the existing `planTrim` gate and stores `edits.trim` on the take; **Clear** removes it; markers re-seed from stored intent on reopen. **Nothing is cut** — the baked output is byte-identical until the apply follow-up.

### Fixes along the way
- **R1** — bar labels end in a gradient fade mask (no mid-glyph clipping / repeated text).
- **List-view scrollbar regression** — the Sprint-2 view-toggle wrapper broke the dialog flex chain; wrapper is now a flex conduit (`a5a2a3f`).
- **Waveform contrast** — figure/ground swap + display gain + taller lane after QA (`300bd84`).
- **BUG-037** — Vite no longer watches `.ignore/` (Windows EBUSY dev-server crash on Explorer paste).
- **Version drift** — `src/utils/version.ts` `APP_VERSION` was still `5.6.0` (missed in the v5.7.0 bump; manifest reads package.json so shipped builds were unaffected). Now `5.8.0`.

## Unchanged

- **Bake path** — zero changes. Dirty tracking → partial-rebake plan → splice/full decision all pre-existing (v5.6/v5.7); the UI never claims "partial", the fidelity gate does.
- **`SegmentEditorHandle` / `SegmentEditorHandlers`** — preserved verbatim; the `subtitle-controls.ts` mount is untouched (branch diff confirms).
- **No new seams** — no message family, no storage key, no take writer. Trim intent uses the existing `edits.trim` field (v5.6.0).
- **List view** — full editor retained as a lossless toggle (same draft) and keyboard/screen-reader fallback.

## Real-browser QA sign-off

Windows / Chrome, single machine. Evidence: `.ignore/QA-5.8.0/` (gitignored).

| Sprint | Surface | Result |
|--------|---------|--------|
| 3 | drag/resize + magnetism + inspector sync | **PASS** (2026-07-09) |
| 4 | stage mode + zoom/pan/minimap | **PASS** (2026-07-09) |
| 5 | feel pass (ears, hysteresis, auto-pan, Esc) | **PASS** (2026-07-09) |
| 6 | waveform lane (+ contrast fix re-check) | **PASS** (2026-07-10) |
| 7 | parity + keyboard + undo/redo + multi-select | **PASS** (2026-07-10) |
| 8 | smart suggestions + one-click fixes (+ List-scrollbar fix) | **PASS** (2026-07-10) |
| 9 | trim intent (markers/preview/save/clear; bake unchanged confirmed) | **PASS** (2026-07-10) |

## Verify

```bash
node scripts/test-timeline-geometry.mjs   # 48
node scripts/test-waveform-peaks.mjs      # 10
node scripts/test-timeline.mjs            # 10
node scripts/test-segment-dirty-tracker.mjs # 11
node scripts/test-splice-plan.mjs         # 36
node scripts/test-partial-rebake-plan.mjs # 13
node scripts/test-take-manager.mjs        # 31
npm run build && npx tsc --noEmit         # tsc: 3 documented pre-existing errors only
```

## Not in this release

- **Atomic trim apply** — mutating `baseMp4`/`bakedMp4` + automatic cue shift + H6 re-stamp (backend `applyTrimToMp4` exists; needs its own QA gate). Stored intent is inert until then.
- Word-level editing (visual room reserved), scrub-audio while dragging the playhead, snap-mode selector, DOM windowing (§3B.1 escape hatch — no profiling evidence demanded it).

---

*Push of `main` + tag deferred per repo convention unless you push.*
