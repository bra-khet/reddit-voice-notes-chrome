# Release notes — v5.9.0 **Trim Apply** (atomic clip trimming)

**Tag:** `v5.9.0` · **Date:** 2026-07-11  
**Prior stable:** `v5.8.0`  
**Branch:** merged `feature/v5.9.0-trim-apply` → `main`  
**Design (authoritative, as-built):** [`v5.9.0-trim-apply-roadmap.md`](v5.9.0-trim-apply-roadmap.md)  
**Restore:** `git checkout v5.9.0 && npm install && npm run dev`

---

> **The headline:** trim finally cuts. The v5.8.0 trim mode previewed a cut that never happened — markers, veils, and ghost bars over an inert `edits.trim` intent. v5.9.0 adds **Apply trim**: one confirmed click produces a genuinely shorter base MP4, shifts every subtitle cue onto the new timeline exactly where the ghost bars promised, re-stamps the take (H6), and leaves it ready to bake. This completes the v5.6 → v5.9 editing arc: audio decoupling → splice execution → visual editor → **atomic apply**.

---

## What shipped

### Apply trim (the cut)
- **Apply trim** button in the timeline trim strip, next to Save/Clear. Two-click confirm: the first click arms it (`Cut N.Ns — confirm`, negate-palette, status line states the permanence); any marker edit or Esc disarms. The cut is **permanent** — all artifact stores are single-slot, so there is no restore for pre-apply bytes; the ghost-bar preview is the safety *before* the cut.
- **`applyTrimToCurrentTake`** (`src/editing/trim-apply.ts`, new — structurally parallel to voice re-apply): H6-verified base load → the same `planTrim` gate Save uses → mediabunny container trim with live `Cutting… N%` progress → superseded guard → commit-last writes (any earlier failure leaves the take untouched).

### Cue shift (preview = apply)
- Pure **`shiftCuesForTrim`** (`trim.ts`) mirrors the ghost-preview math `projectCueThroughTrim` verbatim — half-open overlap, partial-overlap clamping, boundary cues (`end == in`, `start == out`) dropped, **no frame-snapping of cue times** (only the range snaps, via `planTrim`). Bars land where the ghosts said.
- The shift consumes the **live modal draft** (unsaved edits ride along), and **both** session-transcript copies are re-based: "Revert edits" after an apply restores *shifted* baseline cues, never pre-trim times. The modal undo stack resets — Ctrl+Z cannot cross a cut.

### Take consistency
- One atomic take update: fresh `baseMp4` stamp + new duration + intent cleared + **`bakedMp4` and `baseRecording` stamps dropped** + status `baked → ready` + honest note (take-manager patch evolution: `null` = stamp delete).
- **Re-bake is the affordance** — the existing bake button burns subtitles onto the trimmed clip, and the next bake is a **full composite by construction** (`computePartialRebakePlan`'s duration guard; a splice into the stale baked MP4 is impossible).
- **Voice is locked in after a trim:** the raw capture WebM no longer matches the timeline, so "Change Voice" fails honestly with the existing re-record message instead of desyncing audio. (Trimming the raw audio is a possible follow-up.)

## Unchanged contracts
- No new execution context, message family, storage key, or take writer (grep-verified — the v5.6→v5.9 editing arc still adds zero `MSG_` kinds).
- `SegmentEditorHandle` mount, two-view draft contract, bake pipeline, splice path: untouched.
- `BAKED_MP4_READY_KEY` deliberately does NOT fire on apply (no baked bytes produced) — deck/panel/status update through the take-snapshot broadcast.

## Verify
```bash
node scripts/test-timeline.mjs          # 18 (shift + fractional full-span) — was 10
node scripts/test-take-manager.mjs      # 33 (was 31) — stamp null-delete patch
node scripts/test-timeline-geometry.mjs # 48
node scripts/test-waveform-peaks.mjs    # 10
node scripts/test-segment-dirty-tracker.mjs && node scripts/test-splice-plan.mjs && node scripts/test-partial-rebake-plan.mjs
npm run build && npx tsc --noEmit       # PASS / clean (3 documented pre-existing)
```

## Real-browser QA sign-off

Windows / Chrome, single machine. Evidence: `.ignore/QA-5.9.0/` (gitignored). Gate = roadmap §7.

| Check | Result |
|-------|--------|
| Apply from trim mode (confirm → progress → done); duration + cue positions vs ghosts | **PASS** (2026-07-11) |
| Bake after apply | **PASS** — full composite; subs on the new timeline |
| "Change Voice" after apply | **PASS (accepted UX)** — Apply New Voice grays out + same “record a new clip” path as no-valid-clip; never desynced. No trim-specific copy (design note for a later UI rework — voice is committed when you trim) |
| "Revert edits" / Ctrl+Z after apply | **PASS** — no pre-trim times resurrected |
| Deck / Download / attach serve trimmed base | **PASS** |
| 1s minimal keep + trim removing all cues | **PASS** — gate blocks &lt; 1s; cues can all be cut away (blank editor) |
| Recovery after apply + close | **PASS** |
| v5.8 editor + untrimmed voice re-apply / splice regression | **PASS** |

### Post-QA fixes folded into this tag
- **Reddit legacy recorder panel:** same-take attach promote no longer aborts mid-finalizing transcription (`recorder-panel.ts`).
- **Trim OUT floor:** OUT defaults to real media length (decoded/wall-clock), not whole-second floored meta; `clampTrimRange` keeps true clip end on fractional durations.

## Deferred (explicitly out)
- Trimming the raw capture WebM (would restore post-trim voice changes).
- Word-level editing, new Smart-Split generation, demo-site parity.
- Visual/background polish — the proposed **v6.0 "Polish & Visual Maturity"** arc (roadmap §9).
- Unique “you trimmed, so voice is locked” copy on Change Voice (current clean-audio gray-out is correct and safe).

---

*Push of `main` + tag deferred per repo convention unless you push.*
