# Release notes — v5.3.0 **Subtitle QoL**

**Tag:** `v5.3.0` · **Date:** 2026-06-27
**Merge:** `subtitle-qol-failure-scaffold-v1` → `main` (from the v5.2.0 baseline)
**Restore:** `git checkout v5.3.0 && npm install && npm run dev`
**Prior stable:** `v5.2.0` (main — voice character lock + clipboard backup)

## Summary

**Subtitle QoL** turns the subtitles pipeline from a happy-path-only feature into a
robust one. Vosk failures (no speech, empty result, inference errors, timeouts) no
longer hang the Design Studio on amber "Pending" — they become an explicit red
state plus an **automatic timecode scaffold** (evenly-timed empty cues spanning the
clip) you can type straight into. Long cues get a one-click **Smart Split**, cues
can finally be **deleted**, and the FFmpeg burn-in was hardened so it no longer
crashes on longer or busier clips.

Everything stays **session-scoped and client-side**; no profile or output-format
changes, fully backward compatible with existing transcripts.

## Highlights

### Graceful Vosk failure → timecode scaffold

| Area | What shipped |
|------|----------------|
| **No more silent hangs** | Every transcribe outcome resolves to an explicit, persisted state instead of waiting out the 120 s timeout |
| **Failure taxonomy** | `no-speech` · `inference-error` · `empty-result` · `timeout` (`transcribe-failure.ts`), persisted with the snapshot (`error`, `isScaffolded`) |
| **Auto scaffold** | On failure, evenly-timed empty cues spanning the clip (`generateTranscriptScaffold`, default 3 s/slot, runt-tail merge) open in the editor ready for manual captions |
| **Status surfacing** | New delivery states `failed` · `no-speech` · `scaffolded` drive a red status strip + "Scaffolding mode" banner; filling a slot and saving clears the alarm |
| **Manual scaffold** | "Generate scaffold" button creates the same template on demand even when transcription succeeded |

### Long-segment Smart Split

- Per-cue **✂ Split** breaks a long cue into shorter timed cues that each fit one
  caption line — measured against the live preview caption box (WYSIWYG), with the
  time span divided proportionally to each chunk's length.
- A **⚠ LONG** badge flags cues that would trail off screen in the baked video.
- New pure, tested modules: `src/utils/text-metrics.ts` (canvas measurer + greedy
  word grouping) and `splitSegmentIntoChunks` in `transcript-editing.ts`.

### Per-cue delete

- Each cue card gets a delete control (a custom nav-chip + chevron-X asset). Deletes
  are part of the working draft — the editor's Cancel/Discard reverts them until you
  Apply to preview.

### Burn-in robustness (BUG-035)

- Longer / more-populated clips no longer fail the bake with `Failed to parse
  expression: (w-text_w)/2` or `memory access out of bounds`. The drawtext
  filtergraph is now budgeted with a **degradation chain** (`drawtext-glow` →
  `drawtext-glow-min` → `drawtext-plain`); a fresh ffmpeg.wasm instance per tier
  means an oversized clip downshifts instead of crashing.
- The **soft halo glow** was re-engineered to a flat per-cue layer cost
  (`GlowRingMode`): `blurRadius` now controls ring *spread*, not layer *count*, so
  the halo renders for ~10 cues instead of being dropped at 4. Empty scaffold slots
  are excluded from the graph.

### Rainbow pulse removed

- The animated special-hue **rainbow** was removed — low value and the dominant
  drawtext multiplier behind the bake failures. Static **Special hue** remains. The
  preview glow now uses the same single-ring halo as the bake, so dragging the
  sliders / color wheel stays smooth.

### Cold-start fix (BUG-034) + deferred edge (DEF-001)

- Fixed the cold-start "inference-error" on the first recording of a fresh session
  (an offscreen-document dispatch race): dispatch mutex + ping guard + eager
  prewarm. A residual variant only reproducible by spamming record/stop during
  offscreen boot is consciously deferred (`docs/deferred-issues.md` § DEF-001) as an
  MV3 offscreen-boot characteristic.

## Compatibility & scope

- **Backward compatible:** existing successful transcripts are unaffected; new
  delivery states and snapshot fields are additive. Old profiles with the removed
  `specialHueRainbow` flag simply drop it on load.
- **Session-scoped:** no profile-level scaffolding defaults, no baked-output format
  change, no changes to the voice graph, animated backgrounds, recorder core, or
  Reddit injection.

## Testing

No test framework — pure modules are unit-tested via esbuild bundle + `node:assert`:

- `scripts/test-scaffold.mjs` (24) — scaffold contract
- `scripts/test-transcribe-failure.mjs` (7) — failure classifier
- `scripts/test-smart-split.mjs` (15) — width grouping + proportional split timing
- `scripts/test-burnin-budget.mjs` (6) — filtergraph budget + degradation + empty-slot skip

Gates per change: `npx tsc --noEmit` (0 errors) · the four suites · `npx wxt build`.

## Reference

- `docs/v5.3.0-subtitle-qol-design-document.md` — design document
- `docs/design-studio.md` §7 — Subtitles panel & segment editor semantics
- `docs/transcription-architecture.md` — failure emission, scaffolding, burn-in budget
- `docs/bug-archive.md` — BUG-034, BUG-035 · `docs/deferred-issues.md` — DEF-001
