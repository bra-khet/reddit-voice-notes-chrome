# Voice DSP Architecture — Graph-Native Contract

<!--
CHANGED: Recast the completed Dulcet II roadmap as a compact description of the current voice system.
WHY: Branch plans and migration logs are historical; graph shape and preview/export parity remain active canon.
-->

## Archive Notice (Living Document)

The complete Dulcet II design, branch sequence, migration notes, and QA record are preserved at [`archive/docs/v6.0.0-checkpoint/living-snapshots/dsp-foundation-design.md`](../archive/docs/v6.0.0-checkpoint/living-snapshots/dsp-foundation-design.md). Supporting v5 roadmaps are indexed in [`archive/docs/MANIFEST.md`](../archive/docs/MANIFEST.md); milestone context lives in [`HISTORY.md`](HISTORY.md).

## Canonical model

A voice is graph-native:

- a user-composed `StylizedGraph`, or
- a `characterPresetId` that resolves to a graph.

Legacy flat-effect fields are migration inputs only. New voice features extend the graph; they do not add another effect world.

| Module | Owns |
|--------|------|
| `src/voice/types.ts` | Public voice configuration and graph types |
| `src/voice/dsp/fragment-types.ts` | Fragment IDs, parameters, defaults, and validation |
| `src/voice/dsp/preset-graphs.ts` | Bundled character/preset graphs |
| `src/voice/dsp/resolve-graph.ts` | Preset/custom graph resolution |
| `src/voice/dsp/build-stylized-graph.ts` | Ordered graph assembly |
| `src/voice/dsp/renderer.ts` | Renderer-neutral fragment contract |
| `src/voice/dsp/ffmpeg-renderer.ts` | FFmpeg filter emission |
| `src/voice/dsp/ir-generator.ts` | Deterministic auxiliary impulse responses |
| `src/voice/resolve-config.ts` | Normalized config resolution |
| `src/voice/process-audio.ts` | Production processing entry |
| `src/voice/preview-chain.ts` | Audition orchestration |

## Render contract

`resolveVoiceGraph` and `buildStylizedGraph(graph, ffmpegRenderer)` are the shared semantic path for audition and export.

- Simple graphs may render as `-af`.
- Graphs requiring auxiliary inputs render as `-filter_complex`.
- Convolution/reverb assets must be written into the FFmpeg filesystem before execution.
- Fragment order is deterministic; modulation must not mutate saved graph identity.
- Invalid or out-of-range parameters normalize to safe values.

The graph builder decides topology. UI modules may compose configuration but must not emit FFmpeg strings.

## Preview and export parity

| Surface | Input | Renderer |
|---------|-------|----------|
| Extension “Test with my voice” | Fresh microphone sample | Shared graph → FFmpeg renderer |
| Hosted Voice Lab audition | Bundled sample or microphone | Same extension source and graph renderer |
| Base transcode | Raw recording WebM | Same resolved graph |
| Re-apply voice | H6-verified raw WebM | Same resolved graph + stream-copy video remux |

If a graph cannot render in one of these paths, the feature is incomplete. Do not add a preview-only Web Audio approximation as a second source of truth.

## Persistence and interchange

- Profiles persist normalized graph-native voice configuration.
- Clipboard interchange uses the versioned `rvn-voice-character-v1` envelope.
- Hosted Voice Lab imports the extension’s real clipboard and DSP modules; no mirrored DSP tree exists.
- Schema evolution requires validation and migration on both import and stored-profile boundaries.

## Extension checklist

To add a fragment:

1. Register its parameter shape/defaults in `fragment-types.ts`.
2. Implement the renderer-neutral contract and FFmpeg emission.
3. Add it to the intended composition surface without changing unrelated fragment order.
4. Verify config normalization, preset/custom resolution, one-shot mic audition, production transcode, and hosted Voice Lab build.
5. Update [`architecture/extension-points.md`](architecture/extension-points.md) if a sync point or renderer requirement changed.

To add a preset, compose existing fragments in `preset-graphs.ts`; do not fork renderer logic.

## Non-negotiables

- One graph representation.
- One resolution path.
- One FFmpeg graph builder for preview and output.
- Deterministic auxiliary assets.
- No legacy flat-field resurrection.
- No silent fallback to a different-sounding effect.
