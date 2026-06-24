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

1. Store `StylizedGraph` (migrate legacy on read) instead of `VoiceEffectConfig`.
2. Replace `buildFfmpegAudioFilter` call sites with
   `buildStylizedGraph(graph).af` + a `stylizedGraphIsActive(graph)` guard.
3. Refactor `resolve-config.ts` intensity scaling into the renderer (`RenderContext`)
   and add the **non-linear, per-primitive** curve the roadmap calls for.
4. Refresh `presets.ts` to author presets natively as fragment graphs.

Until then this module is **additive and unwired** — existing export is untouched
and the build stays green.

## Status / next

- **1.1 DONE:** model, registry, renderer contract, FFmpeg renderer (v1 primitive
  set), `buildStylizedGraph`, migration, smoke-verified round-trip.
  `CANONICAL_CHAIN_ORDER` confirmed (clean → shape → character → space → safety).
- **1.2a DONE:** linear-`-af` stylized emitters — modulation (flanger, chorus,
  phaser, tremolo, vibrato), color (saturation via `asoftclip`, harmonicExciter via
  `aexciter`, presenceAir via `equalizer`+`treble`), clarity (deEsser via `deesser`,
  deClick via `adeclick`). 15 of 21 kinds now emit; smoke-verified syntax + intensity
  response. Strength (depth/mix/amount) folds with intensity; LFO rate stays raw.
- **1.2b:** the `-filter_complex` promotion path + parallel kinds — `ringMod`
  (sine carrier × signal via `amultiply`), `convReverb` (`afir` + IR bundle),
  `granular`, `hybridLayer` (vocoder-style) — plus `spectralCarve` (`afftfilt`).
- **1.3:** wire into export, non-linear intensity curves, native fragment presets.

### Open decisions
- **IR bundle** for `convReverb` (1.2b): count/size/format/licensing of impulse
  responses. Blocks `convReverb` only — the rest of 1.2b (ringMod, granular,
  hybridLayer, the filter_complex scaffold) is independent.
- **Non-linear per-primitive intensity curve** shape (1.3) — replaces the linear
  `RenderContext.scale`.
- Runtime QA gate: confirm `asoftclip`/`aexciter`/`deesser`/`adeclick` exist in the
  shipped `@ffmpeg/core` build; harden per-fragment skip so one missing filter does
  not fail the whole `-af` chain (today it falls back to raw audio all-or-nothing).
