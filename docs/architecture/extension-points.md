# Extension Points — Reddit Voice Notes

<!--
CHANGED: Rebuilt the registry around current seams and sync requirements, removing the pre-release changelog and carry-forward diary.
WHY: New work needs exact files/contracts without reading every historical addition to the seam.
-->

**Version:** v1.44 · **Baseline:** `v6.0.0` · **Updated:** 2026-07-23

## Archive Notice (Living Document)

The full v1.43 registry and its historical changelog are preserved at [`archive/docs/v6.0.0-checkpoint/living-snapshots/architecture/extension-points.md`](../../archive/docs/v6.0.0-checkpoint/living-snapshots/architecture/extension-points.md). Milestone context lives in [`docs/HISTORY.md`](../HISTORY.md).

For each extension, identify the owning files, contract, sync points, preview/output requirement, bounded cost, and proof.

## Voice graph

**Files:** `src/voice/types.ts`, `src/voice/dsp/{fragment-types,preset-graphs,resolve-graph,build-stylized-graph,renderer,ffmpeg-renderer}.ts`, `src/voice/resolve-config.ts`.

- New fragment: register typed normalized params and one renderer implementation.
- New preset: compose existing fragments; do not fork renderer logic.
- Preview and export both resolve through the same graph builder.
- Clipboard/profile schemas remain graph-native and versioned.
- Verify mic audition, production transcode/re-apply, and hosted Voice Lab build.

Canonical: [`../dsp-foundation-design.md`](../dsp-foundation-design.md).

## Subtitle effects and fonts

**Files:** `subtitle-effects.ts`, `subtitle-overlay-renderer.ts`, `subtitle-overlay-fonts.ts`, `subtitle-burnin.ts`, `subtitle-canvas-bake.ts`.

- Declare whether the effect is canvas-only or has drawtext parity.
- Add normalized config and painter behavior together.
- Keep segment prep and frame timestamps shared.
- Bundle fonts through the existing FontFace/FFmpeg filesystem paths.
- Bound draw passes and preserve reduced fallback behavior.

Canonical: [`../transcription-architecture.md`](../transcription-architecture.md).

## Message pipelines

**Owner:** `src/messaging/types.ts`; relays in `entrypoints/background.ts`; worker in `entrypoints/offscreen/main.ts`.

Existing pipeline families are transcode, burn-in, and transcribe.

- Prefer adding optional data to an existing family over creating a sibling lifecycle.
- Validate START before ACK.
- Register relay/terminal ownership before dispatch.
- Publish terminal result before relay cleanup.
- Cancel/supersede by job ID and reject late terminals.
- Extension-page consumers use direct runtime broadcasts with content-tab duplicate suppression.
- Hosted loopback must not re-broadcast what all listeners already receive.

A new lifecycle-bearing family requires an architecture-map update and likely an ADR.

## Preference storage

**Files:** `src/settings/user-preferences.ts`, `src/storage/user-prefs-db.ts`, `src/storage/background-loader.ts`, background preference handlers.

- Truth is `rvnUserPrefs` IDB (`global`, `profiles`, `customStyles`).
- Serialize RMW through `enqueuePrefsOp`.
- Normalize reads/imports/migration and every new field.
- Commit the full transaction before publishing `rvnUserPrefs.v2`.
- Reddit content scripts load/replace through background helpers.
- Hosted Studio owns its HTTPS-origin DB via `isOwnStorageOrigin()`.

Do not add a preference store or bump `USER_PREFS_VERSION` for an additive normalized field.

## Take lifecycle and artifact stores

**Files:** `src/session/take-manager.ts`, `src/storage/artifact-commit.ts`, single-slot DB modules, recovery/current-take UI.

- Only TakeManager writes `rvn.take.current`.
- Snapshot stores metadata/stamps; blobs stay in single-slot IDB.
- Writers persist first and build stamps/signals from returned persisted metadata.
- Every consumer verifies stamp vs store metadata.
- Use `expectId`/freshness guards for multi-step mutation.
- Missing/mismatched artifact demotes capability honestly.

Adding an artifact kind requires parser, normalization, writer, all consumers, recovery, and UI state to change together.

## Studio capture

**Files:** `src/recorder/recorder-host.ts`, `voice-recorder.ts`, `studio-recorder.ts`, `mount-clip-studio.ts`.

- Both capture surfaces use the same recorder session and stop-time fork.
- Studio preview displays the actual capture canvas.
- Preference/style hot-swap must update preview and capture.
- Stop is the durable blob-write boundary; discard restores the prior take.
- Raw audio clone remains available for STT and re-apply.

## Audio editing and voice re-apply

**Files:** `src/audio/*`, take voice stamps, base/raw/baked stores.

- Enter through the H6-verified raw recording.
- Resolve the same graph as normal transcode.
- Replace audio under existing video without repainting visuals.
- Preserve duration/channel validation and superseded-take guard.
- Re-apply availability derives from a valid raw stamp, not UI optimism.

Decision: [ADR-0004](adr/0004-audio-decoupling-voice-reapply.md).

## Partial re-bake splice

**Files:** `src/editing/{partial-rebake-coordinator,splice-plan}.ts`, `src/composite/{composite-splice,composite-fidelity}.ts`, `subtitle-bake.ts`.

- Plan from the clean base and current cue dirty ranges.
- Re-encode dirty keyframe-aligned GOPs only.
- Validate packet counts/duration and decode-compare kept pixels.
- Throw any miss into the full composite ladder.
- Never report `executed: 'partial'` before all gates pass.

Decision: [ADR-0005](adr/0005-partial-rebake-splice.md).

## Timeline, cue editing, and trim

**Files:** `src/timeline/timeline.ts`, `src/ui/design-studio/timeline-geometry.ts`, timeline editor, `src/editing/{trim,trim-apply}.ts`, transcript DB.

- One `TranscriptResult` draft owns list and timeline.
- Every cue-time mutation delegates to shared frame snap.
- Trim ghost and Apply share half-open projection.
- Apply shifts both transcript copies and clears undo.
- Base and optional raw trim persist before one guarded take patch.
- Duration change forces the next full bake.

## Theme and background

**Files:** `src/theme/*`, `src/storage/animated-background.ts`, `src/ui/design-studio/background-*`, recorder background state.

- Personal media lives in ImageDB; prefs store IDs/layout only.
- Studio reads directly; Reddit receives chunked relay.
- All persisted layout fields normalize.
- Preview and recorder use the same Canvas2D draw seam.
- Missing media falls back to the theme.
- Background positioning is Design-phase only.

Decision: [ADR-0008](adr/0008-background-direct-manipulation-layout.md).

## Audio-reactive visual system

**Files:** `src/theme/audio-reactive/*`, `src/recorder/waveform.ts`, `src/ui/design-studio/{style-controls,performance-governor,subtitle-safe-dim}.ts`.

Render order is primary atmosphere → up to three ordered accents → spectrum → optional caption-safe dim.

- Add definitions through the registries.
- Consume the normalized `AudioVizFrame`; request waveform only through static `wants`.
- State is per-canvas, bounded, deterministic in preview, and reset on identity change.
- Declare `maxElements`; the shared governor must produce the same active/suspended set in preview and capture.
- Implement reduced motion and High Contrast explicitly.
- Preserve the serialized `bokeh` stability key.

Decisions: [ADR-0007](adr/0007-audio-reactive-visualizer-core.md), [ADR-0009](adr/0009-registry-native-sparkle-bokeh.md), [ADR-0010](adr/0010-bubbles-label-stable-bokeh-id.md).

## Studio UI surfaces

**Files:** `src/ui/design-studio/*`, shared tokens/palette, save/exit helpers.

- Reuse panel vocabulary, modal primitives, summary chips, and Cividis tokens.
- Preserve profile, style, transcript, and segment-modal dirty layers.
- Preserve first-save/update/clone/fork semantics.
- New actions must be keyboard accessible and non-color-dependent.
- UI restructuring must not change storage or renderer ownership.

Canonical: [`../design-studio.md`](../design-studio.md).

## Hosted Design Studio

**Files:** `demo/design-studio/host/*`, `demo/vite.config.ts`, `demo/scripts/*`, shared Studio source.

- Install the global shim before shared imports.
- Use `isOwnStorageOrigin()`, never protocol/path classification.
- Keep shared `browser.*` access inside functions.
- Use `runtime.getURL()` for packaged assets.
- Mirror complete runtime asset trees.
- Loopback relay ignores already-targeted messages and does not duplicate progress/complete.
- Artifact relays use the shared persist/signal/stamp choke point when no background responds.
- Root TypeScript excludes `demo/`; demo build runs host-neutrality, TypeScript, then Vite.

Current hosted contract: [`../static-voice-studio-design.md`](../static-voice-studio-design.md). A host adapter that begins making product policy rather than relaying is the ADR-0011 trigger.

## Blob relays

**Files:** `src/messaging/background-blob.ts`, `baked-mp4-blob.ts`, background port handlers, content consumers.

- Metadata request precedes chunk fetch.
- Enforce size, chunk count, job/store identity, and abort cleanup.
- Content scripts decode locally; they never receive an extension object URL or IDB handle.
- New blob kinds should reuse the protocol rather than create a one-off message family.

## How to extend this registry

Add a new section only for a genuinely new seam. For an existing seam, update its files, contract, sync points, and proof in place and bump this document version.

Before implementation, answer:

1. Does this add a context, host, store, writer, artifact, message lifecycle, or compositing layer?
2. Which existing normalizer and owner can absorb it?
3. What must stay synchronized across extension and hosted builds?
4. How does preview equal output?
5. What bounds cost and what is the honest fallback?
6. Which focused tests and real money path prove it?
