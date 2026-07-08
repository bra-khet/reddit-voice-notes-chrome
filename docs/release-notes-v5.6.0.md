# Release notes — v5.6.0 **Audio Decoupling & Voice Re-apply**

**Tag:** `v5.6.0` · **Date:** 2026-07-08
**Branch:** merged `feature/5.6.0-audio-decoupling` → `main`
**Prior stable:** `v5.5.1`
**Restore:** `git checkout main && npm install && npm run dev`
**Contract:** [`v5.6.0-audio-decoupling.md`](v5.6.0-audio-decoupling.md) · [ADR-0004](architecture/adr/0004-audio-decoupling-voice-reapply.md)

---

> **The headline:** change a take's voice effect after capture without re-recording. Raw mic audio already persisted in the capture WebM — v5.6.0 stamps voice provenance on the take, re-renders through Dulcet II, and stream-copy remuxes new audio under the existing video (burned-in subtitles and waveform pixels bit-exact). Studio voice panel: **Apply voice to current take**.

---

## What's new

### Voice re-apply (Phase 1 — user-facing)

- **`TakeVoiceStamp`** on `CurrentTake` — `intentKey`, normalized config, `origin` (capture/reapply), `revision`.
- **`reapplyVoiceToCurrentTake`** — H6-gated raw WebM → Dulcet II AAC render → stream-copy remux of `baseMp4` and `bakedMp4` when stamped; visuals untouched (invariant I6).
- **Studio surface** — "Apply voice to current take" in the voice panel; honest gate copy; chronos stages `voice-reapply-{dsp,remux-base,remux-baked,save}`.
- **Voice-off re-apply** — `forceRender` renders a clean AAC track from a no-op graph.

### Editing-suite backend (scaffolds — not user-facing yet)

- **`src/timeline/timeline.ts`** — shared global-PTS frame math (`frame / fps`).
- **`src/editing/segment-dirty-tracker.ts`** — cue diff → dirty windows → segments.
- **`src/editing/partial-rebake-coordinator.ts`** — keyframe-grid partial-rebake **planner**; full composite still runs (Phase 2b = splice execution).
- **`src/editing/trim.ts`** — `planTrim`, `edits.trim` intent, `applyTrimToMp4` (mediabunny); no Studio UI yet (Phase 3).

---

## User QA (2026-07-08) — PASS

| Scenario | Result |
|----------|--------|
| Capture voice A → Apply voice B | **PASS** — audio changes; visuals bit-identical |
| Reddit attach (original + reapplied) | **PASS** |
| Voice-off (zero effects) re-apply | **PASS** |

---

## Follow-up branches (not in v5.6.0)

- **Phase 2b** — partial-rebake packet splice execution behind `coordinateRebake` + fidelity harness.
- **Phase 3** — trim UI + atomic artifact/cue shift integration.

---

## Verification

- `node scripts/test-voice-reapply-plan.mjs` — 12/12
- `node scripts/test-take-manager.mjs` — 31/31
- `node scripts/test-timeline.mjs` — 10/10
- `node scripts/test-segment-dirty-tracker.mjs` — 11/11
- `node scripts/test-partial-rebake-plan.mjs` — 9/9
- `npm run build` PASS

---

## Upgrade notes

- Reload the extension after `npm run build` to pick up v5.6.0.
- Takes captured before v5.6.0 may lack a voice stamp — re-apply shows honest degradation copy until re-recorded.
- Opt-out of browser composite unchanged: `experimental.browserComposite: false` in `rvnUserPrefs`.