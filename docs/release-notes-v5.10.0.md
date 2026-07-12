# Release notes — v5.10.0 **Raw Trim Apply** (post-trim voice freedom)

**Tag:** `v5.10.0` · **Date:** 2026-07-11  
**Prior stable:** `v5.9.0`  
**Branch:** merged `feature/v5.10.0-raw-trim-apply` → `main`  
**Design (authoritative, as-built):** [`v5.10.0-raw-trim-apply-roadmap.md`](v5.10.0-raw-trim-apply-roadmap.md)  
**Restore:** `git checkout v5.10.0 && npm install && npm run dev`

---

> **The headline:** trim no longer locks your voice. v5.9.0's Apply trim was honest but final — it dropped the raw capture stamp, so "Change Voice" after a cut meant re-recording from scratch. v5.10.0 trims the **raw capture WebM alongside the base MP4** in the same atomic apply: the clean voice source now matches the trimmed timeline, so voice re-apply, Change Voice, intensity/Turbo tweaks, and audition in the subtitle editor all work *after* a trim. This closes the v5.9 §3I follow-up and completes the editing suite's "trim, then polish the voice" workflow.

---

## What shipped

### Raw-recording leg of Apply trim (the unlock)
- **`applyTrimToWebM`** (`src/editing/trim.ts`): mediabunny `Conversion` + `WebMOutputFormat` with the same `trim` contract as the v5.9 MP4 cut — sample-accurate Opus boundaries (mediabunny decodes, trims the edge sample, re-encodes). Output is **audio-only** by design: the VP8 canvas track is discarded (`video: { discard: true }`) because every post-trim consumer of `baseRecording` is an audio consumer, and keeping video would force a pointless whole-clip re-encode.
- **`planRawTrimLeg`** (pure, Node-tested): gates the leg over the H6 stamp↔store check — `'trim'` (verified match), `'drop-stamp'` (stamp present but store empty/superseded → the v5.9 lock outcome, honestly), `'skip'` (legacy take, no stamp).
- **A raw-leg problem never fails the trim.** Conversion error, H6 mismatch, or a result outside the store's persistability bounds (256 B – 18 MB, now exported from `last-recording-db.ts` — the H13 pre-check: never stamp bytes the store may silently refuse) demotes the leg to `'drop-stamp'`; the MP4 cut proceeds. Only a user cancel aborts the whole apply (pre-commit, nothing written).

### One atomic commit, voice-aware
- The fresh `baseRecording` stamp (or its honest delete) rides the **same** `updateCurrentTake` (`expectId`) write as the new base stamp, duration, intent clear, `bakedMp4` drop, and `baked → ready` demotion — other contexts can never observe a half-updated artifact set.
- Trim outcome now reports tri-state **`rawAudio: 'trimmed' | 'dropped' | 'none'`** (replaces v5.9's `voiceLocked`); the take note says "voice changes stay available" only when the leg actually succeeded.
- Progress meter rebudgeted (MP4 0.02–0.70, WebM 0.72–0.90 when the leg runs) — never runs backwards.

### Post-trim voice flows (zero UI code — the unlock is emergent)
- `voice-reapply.ts` and `clean-audio-source.ts` are **unchanged**: the trimmed WebM satisfies the same H6 clean-audio door, and the rendered voice track naturally matches the trimmed video duration — no desync possible by construction.
- The Voice panel's "Apply voice to current take" re-enables automatically (it gates on the surviving stamp), and the `savedAt`-keyed recording poll picks up the trimmed source line ("Last recording: N s · N KB").

## Unchanged contracts
- No new execution context, message family, storage key, or take writer (the v5.6→v5.10 editing arc still adds zero `MSG_` kinds).
- No ffmpeg.wasm involvement — the WebM trim uses the same mediabunny vehicle as the v5.9 MP4 trim.
- `BAKED_MP4_READY_KEY` still does NOT fire on apply; post-trim bakes remain full composites by construction (duration guard).
- Recovery, deck, Download, attach: all stamp-verified paths see the trimmed artifacts consistently.

## Verify
```bash
node scripts/test-timeline.mjs          # 22 (was 18) — planRawTrimLeg truth table
node scripts/test-take-manager.mjs      # 34 (was 33) — dual-stamp one-write patch
node scripts/test-timeline-geometry.mjs # 48
node scripts/test-waveform-peaks.mjs    # 10
node scripts/test-segment-dirty-tracker.mjs && node scripts/test-splice-plan.mjs && node scripts/test-partial-rebake-plan.mjs
node scripts/test-voice-reapply-plan.mjs && node scripts/test-segment-editor-clip-source.mjs
npm run build && npx tsc --noEmit       # PASS / clean (3 documented pre-existing)
```

## Real-browser QA gate — **OPEN (run before push / distribution)**

The mediabunny conversion path is WebCodecs (browser-only); automated gates cover everything else. Gate = roadmap §7. Suggested evidence dir: `.ignore/QA-5.10.0/`.

| Check | Result |
|-------|--------|
| Trim 10s from start/middle/end of a ~60s clip → duration + cue positions vs ghosts | — |
| **Change Voice / re-apply after apply** (character swap, intensity, Turbo) → audition + bake, no desync, correct length | — |
| Trimmed recording line in Voice panel (duration/KB/savedAt update) | — |
| Bake after apply + voice change → full composite, subs + new voice on new timeline | — |
| 1s minimal keep · trim removing all cues · cues at exact boundaries | — |
| Recovery after apply + close + re-open editor | — |
| Deck / Download / attach serve trimmed base (and baked after re-bake) | — |
| Raw-leg fallback: force a store mismatch → trim succeeds, voice locks honestly (v5.9 behavior) | — |
| v5.9 trim, partial-splice, browser composite, pre-trim voice re-apply regression | — |

## Deferred (explicitly out)
- Full video-track editing / visual trim of the raw WebM (audio-only is the whole need).
- On-the-fly WebM trim per re-apply (trim once at apply time).
- Mobile / demo-site parity for post-trim voice flows.
- Visual/background polish — the proposed **v6.0 "Polish & Visual Maturity"** arc (roadmap §9).

---

*Push of `main` + tag deferred per repo convention unless you push.*
