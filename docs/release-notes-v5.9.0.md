# Release notes — v5.9.0 **Trim Apply** (atomic clip trimming)

**Tag:** `v5.9.0` (pending user QA sign-off) · **Date:** 2026-07-11  
**Prior stable:** `v5.8.0`  
**Branch:** `feature/v5.9.0-trim-apply` (merge + tag after the QA gate)  
**Design (authoritative, as-built):** [`v5.9.0-trim-apply-roadmap.md`](v5.9.0-trim-apply-roadmap.md)  
**Restore:** `git checkout feature/v5.9.0-trim-apply && npm install && npm run dev`

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
node scripts/test-timeline.mjs          # 16 (was 10) — shift scenarios incl. ghost parity
node scripts/test-take-manager.mjs      # 33 (was 31) — stamp null-delete patch
node scripts/test-timeline-geometry.mjs # 48
node scripts/test-waveform-peaks.mjs    # 10
node scripts/test-segment-dirty-tracker.mjs && node scripts/test-splice-plan.mjs && node scripts/test-partial-rebake-plan.mjs
npm run build && npx tsc --noEmit       # PASS / clean (3 documented pre-existing)
```

## QA gate (real-browser, user sign-off required before merge/tag)
The full checklist is roadmap §7. The rows that are new to this release:

| Check | Expect |
|-------|--------|
| Apply from trim mode (confirm → progress → done) | Shorter clip; duration correct everywhere (deck, Download, attach) |
| Cue positions after apply | Exactly where the ghost bars previewed; boundary cues dropped |
| Bake after apply | FULL composite (no splice in console), subs on the new timeline |
| "Change Voice" after apply | Honest re-record message — never desynced audio |
| "Revert edits" after apply | Shifted baseline cues — never pre-trim times |
| Ctrl+Z after apply | Cannot cross the cut (stack cleared) |
| Trim removing all cues / 1s minimal keep | Honest empty editor / gate blocks below 1s |
| Recovery after apply + close | Trimmed take resumes; H6 passes |

## Deferred (explicitly out)
- Trimming the raw capture WebM (would restore post-trim voice changes).
- Word-level editing, new Smart-Split generation, demo-site parity.
- Visual/background polish — the proposed **v6.0 "Polish & Visual Maturity"** arc (roadmap §9).
