# DSP Foundation Design — Dulcet II (v5)

**Branch:** `dulcet-ii/dsp-foundation` · **Sub-Phases:** 1.1 (done) → 1.2 → 1.3
**Codename:** Dulcet II · **Status:** living design doc
**Related:** `docs/v5-development-roadmap.md`, `docs/v5-development-roadmap-supplemental.md`, `docs/v5-implementation-notes.md`

---

## Branch naming (read first)

v5 reuses the "dulcet" codename, but a real branch named `dulcet` already exists
(the merged v3 line). Git cannot have both a branch `dulcet-ii` **and** branches
under `dulcet-ii/` (ref D/F conflict). So **`dulcet-ii` is a namespace, not a
branch**:

| Role | Branch |
|------|--------|
| Integration line (was "`dulcet`" in the roadmap) | `dulcet-ii/integration` |
| Feature branches | `dulcet-ii/dsp-foundation`, `dulcet-ii/pitch-formant`, `dulcet-ii/preview-pipeline`, `dulcet-ii/character-system` |

Wherever the roadmap docs say `dulcet`, read `dulcet-ii/integration`; wherever they
say `dulcet/<x>`, read `dulcet-ii/<x>`.

## Founding decisions (v5, locked)

1. **Fresh `dulcet-ii` namespace** — old `dulcet` left as history.
2. **Replace + migrate** — the fragment graph is the *canonical* config; the flat
   `VoiceEffectConfig` becomes a legacy *input* a one-way adapter migrates forward.
   No production user data exists (dev profiles only), so no long-term compat shim.
3. **Backend-agnostic fragments** — a fragment describes *intent + high-level
   params*; renderers translate. FFmpeg renderer now; Web Audio renderer in
   Branch 3. One source of truth → preview and export cannot drift.

---

## Module layout (`src/voice/dsp/`)

| File | Responsibility | Imports |
|------|----------------|---------|
| `fragment-types.ts` | **The new config shape.** Descriptors, param shapes, `StylizedGraph`, `FRAGMENT_DEFS` registry, `create*`/`normalize*`. Pure-data **leaf**. | none (leaf) |
| `renderer.ts` | Backend-agnostic `FragmentRenderer<TNode,TResult>` + `RenderContext` + intensity `scale`. | `fragment-types` |
| `ffmpeg-renderer.ts` | FFmpeg implementation: per-kind emitters → `FfmpegGraphResult` (`-af` / `-filter_complex`). | `fragment-types`, `renderer` |
| `build-stylized-graph.ts` | `buildStylizedGraph()` orchestrator + `CANONICAL_CHAIN_ORDER` + `orderFragmentsCanonically()`. | `fragment-types`, `ffmpeg-renderer`, `renderer` |
| `migrate-v1.ts` | Legacy `VoiceEffectConfig` → `StylizedGraph`. | `../resolve-config`, `../types`, dsp |
| `index.ts` | Barrel. **FFmpeg-free** (no WASM pull) → popup-safe, unlike `@/src/voice`. | dsp |

The whole subsystem is WASM-free at import time, so the settings popup / Design
Studio may import it directly (the BUG-008 circular-import landmine does not apply —
`fragment-types.ts` imports nothing).

---

## Data model

```
StylizedGraph
├─ version: 1            schema version (forward migration)
├─ enabled: boolean      voice-off default = false
├─ intensity: 0–10       global slider
├─ turbo: boolean        forces effective intensity 12
└─ fragments: AnyFragment[]   USER-ORDERED chain (drag to reorder)

GraphFragment<K>
├─ id        stable, for reorder / UI keying
├─ kind      one of 21 kinds across 7 categories
├─ enabled   per-fragment toggle
└─ params    FragmentParamMap[K]  (1–3 high-level sliders)
```

**21 kinds / 7 categories** (`FRAGMENT_DEFS` is the single registry that powers
the Branch-4 UI labels/tooltips, migration defaults, and the `parallel` flag):

| Category | Kinds |
|----------|-------|
| pitch-formant | `pitchFormant` |
| dynamics | `gate` `compressor` `limiter` `deEsser` `deClick` |
| modulation | `flanger` `chorus` `phaser` `tremolo` `vibrato` `ringMod` |
| color | `saturation` `harmonicExciter` `presenceAir` `spectralCarve` `eq` |
| spatial | `convReverb`* `algoReverb` |
| textural | `granular`* |
| hybrid | `hybridLayer`* |

`*` = `parallel: true` → requires `-filter_complex` (see below).

Adding a primitive = one row in `FragmentParamMap` + one `FRAGMENT_DEFS` entry +
one emitter. The discriminated union, defaults, normalization, and ordering all
derive from those.

---

## Renderer contract & the `-af` vs `-filter_complex` split

Today's legacy export is a single linear `-af` comma-chain. The v5 supplemental
requires **parallel streams** (hybrid vocoder layers), **convolution**, and
**granular** texture — none of which fit a linear `-af`. So the FFmpeg renderer
returns a structured `FfmpegGraphResult`:

```
mode: 'none' | 'af' | 'complex'
af:            string | null   // linear chain (mode 'af')
filterComplex: string | null   // graph (mode 'complex', 1.2)
outputLabel:   string | null   // -map target in complex mode
stages:        string[]        // per-fragment progress labels
```

Linear fragments contribute `-af` segments; any `parallel` fragment promotes the
whole graph to `-filter_complex` (`asplit`/`amix`/`afir`). **1.1 implements only
the linear path**; the `complex` branch throws an explicit "not until 1.2" guard so
the seam is visible, never silently wrong.

## buildStylizedGraph flow

```
buildStylizedGraph(graph, renderer = ffmpegRenderer)
  → effective intensity (turbo ? 12 : intensity)
  → if !enabled or intensity 0 → assemble([])  → mode 'none'
  → for each ENABLED fragment in array order: renderer.emit(frag, ctx)
  → renderer.assemble(nonNullNodes, ctx)
```

Array order is the **user's** chain. `CANONICAL_CHAIN_ORDER` only seeds new graphs,
migrated presets, and the UI "reset order" — it is never force-applied at build.

### CANONICAL_CHAIN_ORDER (open decision — confirm/adjust)

Proposed default: clean → shape → character → space → safety. See the doc comment
in `build-stylized-graph.ts` for the full rationale and the trade-offs (compressor
before/after EQ; pitch before/after cleanup; de-esser placement; limiter position).

---

## Migration mapping (`migrateVoiceEffectToGraph`)

Resolves any preset to concrete **unscaled** values, then maps; the emitters apply
intensity scaling at build (matching the legacy resolve→scale→build flow).

| Legacy field | Fragment |
|--------------|----------|
| `pitchShift.semitones ≠ 0` | `pitchFormant { semitones }` |
| `eq.{low,mid,high}Gain` | `eq` |
| `dynamics.compressorEnabled` | `compressor { amount: 50 }` |
| `dynamics.normalize` | `compressor { amount: 30, makeup: 40 }` (≈ leveling) |
| `reverb.amount > 0` | `algoReverb { mix }` |

Verified round-trips (smoke, 2026-06-24): robot → `pitchFormant→eq→compressor`
emitting the exact legacy `g=3`/`g=-2` EQ; deeper@10 vs @5 scales `-5→-2`;
whisper maps normalize→compressor; voice-off → `none`; an unimplemented stylized
kind skips to `none` (no crash).

---

## Integration plan (Sub-Phase 1.3 — not yet wired)

The legacy export path (`ffmpeg-runner.ts:462`, `process-audio.ts:141`) still calls
`buildFfmpegAudioFilter(config) → { filter, stage }`. 1.3 swaps the source:

1. **DONE (step 1):** `process-audio.ts` `processAudioBytesWithGraph()` /
   `processAudioWithGraph()` run a `StylizedGraph` through ffmpeg.wasm — both the
   linear `-af` chain and the complex `-filter_complex` path (writes aux IR WAVs as
   extra `-i`, `-map`s the output pad, longer timeout for convolution). Additive: the
   legacy `processAudioBytes(config)` path is untouched. **Harness-testable now;
   pending runtime QA of filter availability + convolution perf.**
2. Wire the live transcode (`ffmpeg-runner.ts`) — needs `-filter_complex` + aux `-i`
   threaded into the muxed WebM→MP4 strategies alongside the waveform video stream.
3. Store `StylizedGraph` (migrate legacy on read) instead of `VoiceEffectConfig`
   across prefs/profiles/Design Studio (~24 files; do with the app running for QA).
4. Refactor `resolve-config.ts` intensity scaling into `RenderContext` with the
   **non-linear, per-primitive** curve (user decision); refresh `presets.ts` as
   native fragment graphs.

The dsp module + the `process-audio` graph runner are additive; the live recorder /
export / storage paths are still on the legacy config.

## Status / next

- **1.1 DONE:** model, registry, renderer contract, FFmpeg renderer (v1 primitive
  set), `buildStylizedGraph`, migration, smoke-verified round-trip.
  `CANONICAL_CHAIN_ORDER` confirmed (clean → shape → character → space → safety).
- **1.2a DONE:** linear-`-af` stylized emitters — modulation (flanger, chorus,
  phaser, tremolo, vibrato), color (saturation via `asoftclip`, harmonicExciter via
  `aexciter`, presenceAir via `equalizer`+`treble`), clarity (deEsser via `deesser`,
  deClick via `adeclick`). 15 of 21 kinds now emit; smoke-verified syntax + intensity
  response. Strength (depth/mix/amount) folds with intensity; LFO rate stays raw.
- **1.2b-i DONE:** `-filter_complex` assembler + parallel-node model
  (`ParallelSpec`: in-graph `sources`, `auxInputs` for extra `-i` files, dry/wet
  `amix` with per-spec `mixDuration`, mono normalization at the graph head) +
  `ringMod` (sine × signal via `amultiply`).
- **1.2b DONE:** **all 21 kinds now emit.** `convReverb` (procedural JS IR via
  `ir-generator.ts` → WAV aux input → `afir`, `mixDuration: longest` to keep the
  tail); `hybridLayer` (parallel synth layer *derived from the voice* — finite, no
  infinite-source bounding); `granular` (linear `aecho` multi-tap smear — first-pass
  approximation; true per-grain is future AudioWorklet/WASM, `randomization`/
  `pitchScatter` unmapped); `spectralCarve` (resonant EQ peaks tilting vocal→metallic
  — robust approximation of `afftfilt`). Kitchen-sink graph smoke-verified.
- **1.3:** wire into export, non-linear intensity curves, native fragment presets.

### filter_complex model
All-linear graphs → one `-af` chain (stereo preserved). Any parallel fragment →
`-filter_complex`, mono-normalized at the head; each parallel node does
`asplit` → wet branch (from `build()`, optionally pulling lavfi sources or aux `-i`
files) → `amix` against dry per `wetMix`. Result carries `outputLabel` (for `-map`)
and ordered `auxInputs` (files 1.3's wiring writes + adds as `-i`).

### Open decisions
- **IR generation** for `convReverb`: **RESOLVED** — procedural/synthesized in JS.
- **Intensity curve**: **RESOLVED (first pass)** — global ease-in
  `intensityFactor = (intensity/10) ** 1.3` (f(10)=1.0, f(12)≈1.27) in
  `RenderContext`. Per-primitive curves remain a future refinement.

### Verified (user QA, 2026-06-24, via voice-harness graph mode)
All 21 fragment kinds run in ffmpeg.wasm; granular + hybrid called out as standouts.
Core (`@ffmpeg/core@0.12`, ffmpeg 5.1.4) confirmed to include every filter used — no
fallback approximations needed. `algoReverb` aecho delay/decay-count bug fixed.
**Sub-Phases 1.1 + 1.2 + intensity curve merged to `dulcet-ii/integration`.**
- Runtime QA gate: confirm `asoftclip`/`aexciter`/`deesser`/`adeclick` exist in the
  shipped `@ffmpeg/core` build; harden per-fragment skip so one missing filter does
  not fail the whole `-af` chain (today it falls back to raw audio all-or-nothing).

---

## Preview pipeline (Branch 3 — `dulcet-ii/preview-pipeline`)

The Design Studio voice panel auditions effects through **two tiers**. The split is
deliberate: real-time Web Audio cannot reproduce the stylized graphs (the supplement
explicitly relaxes the live-preview requirement), so fidelity comes from an offline
render rather than a second DSP backend.

### Tier 1 — "Test character voice" (one-shot, AUTHORITATIVE)
- Renders the **active** `StylizedGraph` through `processAudioWithGraph` (ffmpeg.wasm,
  in the Studio page) on the last recording, then plays the result dry via
  `VoicePreviewHandle.playProcessed` (no effect chain — the audio is already final).
- **Identical to the bake by construction:** both the Test button and the live export
  (`ffmpeg-runner.runWebmToMp4`) resolve the config through the *same*
  `resolveVoiceGraph()` and run the *same* renderer. What you hear is what bakes —
  verified by user QA across linear, legacy, and complex/parallel presets.
- Works for **all** graph kinds (linear `-af` and parallel `-filter_complex` + aux IRs).
- Trade-off: costs a render (first click also spins up ffmpeg.wasm, ~32MB). Acceptable
  per the "users will happily wait a few seconds for a good test" philosophy.
- **Performance cap (§3.2):** previews are limited to the first `PREVIEW_MAX_SECONDS`
  (30s) via an opt-in `maxDurationSeconds` → `-t` on the graph args. Clips ≤30s render
  in full and stay byte-identical to the bake; longer clips trim (with a status note).
  The export path never sets this, so **bakes are always full-length**.

### Tier 2 — "Play preview" (instant, APPROXIMATION)
- The legacy Web Audio chain (`preview-chain.ts`): `playbackRate` pitch + biquad EQ +
  `DynamicsCompressor`. Zero latency, good for quick legacy/pitch tweaks.
- **Cannot represent v5 character graphs** — its renderer reads only the flat legacy
  fields and ignores `characterPresetId`. So when a character voice is active, this
  button is **disabled** (with a hint steering to Test) rather than playing a
  misleading near-raw result (§3.3 edge case).
- Even for legacy presets it is only *roughly* representative (the bake now goes through
  the migrated graph, not this chain). Authoritative auditioning is always Tier 1.

### Single master preview
One `VoicePreviewHandle` owns playback; every entry point (`play`, `playProcessed`)
calls `stop()` first, so only one clip plays at a time and the Stop button governs both
tiers uniformly.
