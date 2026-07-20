# Extension Points — Reddit Voice Notes

**Version:** v1.36 · **Updated:** 2026-07-19 · **Reflects:** `feature/v6.0.0-popup-ui-refresh` @ package `5.11.0` · **v6 Track C popup chrome token-driven**
**Status:** Canonical registry of integration seams. Pair with `docs/architecture/architecture-map.md`.  
**Changelog:** v1.36 — **Track C popup Cividis unification** (2026-07-19): the browser-action popup chrome is now token-driven from the shared Cividis/Studio set via a popup-only overlay (`entrypoints/popup/popup-palette.css` `@import`s `studio-palette.css`; guarded by extended `test-ui-tokens.mjs` adoption + banned-hex assertions). **No new seam** — but one discovered constraint is now load-bearing: `entrypoints/popup/style.css` doubles as the Design Studio's shared control-primitive base (`design-studio/main.ts` imports it), so popup-only restyling must go through the overlay, never the base. Deferred hardening candidate: extract a real `control-primitives.css` shared layer. Elevated restart caution stays inside the existing `restart-caution.ts` contract (same API/call sites). v1.35 — **Style Control Center + shared performance policy** (2026-07-14): renamed the panel contract to `style`; production registries now drive six-spectrum/seven-atmosphere/seven-accent pickers and the summary. Shared normalized controls persist through the existing `DesignOverrides` pathway. `performance-governor.ts` maps registry ceilings + Detail to Comfortable/Elevated/Guarded and returns an active accent list that both UI and capture consume; one expensive accent pauses without changing saved order. Identity swaps reset per-canvas state; `subtitleSafeDim` paints below captions. Focused total 226/226; build and responsive fixture QA PASS. No new context/message/store/signal/dependency/layer/version/ADR. v1.34 — Particle Burst / complete stackable catalog. Earlier history remains in git.

> For each seam: the **files to touch**, the **contract** to satisfy, the
> **sync points** (places that must change together), and whether a new instance
> needs **both a preview and a bake path** (the preview=bake promise).

---

## Voice effects — v5 (graph-native, Dulcet II)

The flat v3/v4 layer (presets.ts / filter-graphs.ts / migrate-v1.ts / Web-Audio preview)
was removed in Branch 4. A voice is a `StylizedGraph` of fragments; the only config is
`graph` (user-composed) or `characterPresetId`.

- **Add a fragment (primitive):** add one entry to `FragmentParamMap` + `FRAGMENT_DEFS`
  in `src/voice/dsp/fragment-types.ts`, then an emitter in `src/voice/dsp/ffmpeg-renderer.ts`.
  The discriminated union, defaults, registry, and composer UI all derive from that map.
- **Add a character preset:** `src/voice/dsp/preset-graphs.ts` → register a recipe
  (`build()` returns fragments); it surfaces automatically as a chip in the voice panel.
- **Bake path:** `resolveVoiceGraph(config)` → `buildStylizedGraph()` → `-af` (linear) or
  `-filter_complex` + aux IR WAVs (parallel/convolution), run by `src/ffmpeg/ffmpeg-runner.ts`.
- **Preview=bake?** YES — Test and the live export both resolve through the *same*
  `resolveVoiceGraph()` and the *same* renderer, so Test is byte-identical to the bake.
  There is no separate preview DSP backend (the dry player just plays the rendered clip).
- **Sync points:** `characterPresetId`/`graph` ↔ summary (`src/voice/voice-summary.ts`) ↔
  Studio composer (`src/ui/design-studio/voice-composer.ts` + `voice-controls.ts`) ↔
  dirty key (`voiceEffectUserIntentKey` in `src/voice/resolve-config.ts`, id-free).
- **Import rule:** `src/voice/types.ts` may import only the `fragment-types` leaf — never
  `resolve-config` / renderers — to avoid pulling FFmpeg into the popup (BUG-008 class).

## Subtitle effects — v1

- **Add a style/effect field:** `src/transcription/types.ts` (`SubtitleStyleConfig`).
- **Preview path:** `subtitle-controls.ts` + `subtitle-preview.ts` / segment player + `subtitle-effects.ts`; the timeline is an editing surface over the same cue draft.
- **Primary bake path:** `browser-composite.ts` calls `createOverlayFramePainter` directly at decoded base-frame PTS, blends in Canvas2D, then VideoEncoder+mux writes the MP4. Add rich visual effects to the shared painter first.
- **Fallback bake paths:** dual-IVF WebCodecs overlay → FFmpeg alphamerge; MediaRecorder overlay → FFmpeg composite; final `subtitle-burnin.ts` drawtext tier. A new effect must declare its behavior on every tier or explicitly trigger a richer tier.
- **Preview=bake?** YES on the primary shared-painter path. Drawtext fallback is a documented approximation with the same bundled DejaVu TTF, static colors, and bounded glow layers.
- **Sync points:** style field ↔ preview/painter ↔ fallback declarations (`subtitleStyleHasCanvasOnlyEffects` / drawtext) ↔ `studio-section-summaries.ts` chip.
- **Gotchas:**
  - Use `textfile=` for cue text — commas/apostrophes break `-vf` chain (BUG-031).
  - No silent libass fallback — `burnInLogIndicatesFailure` must reject failed burns; do not add a fallback that exits 0 with no visible subs (BUG-025/028/030).
  - `fontcolor` in drawtext must use `0xRRGGBBAA` or named color, never `0xRRGGBB@opacity` (BUG-028).

## Font pipeline — v1

- **Add a font variant:** `public/assets/fonts/` (bundle TTF) → `FONT_ASSETS` in `src/ffmpeg/subtitle-burnin.ts` → `PREVIEW_FAMILY_FOR_KEY` + `ASSET_FOR_FAMILY` in `src/ui/design-studio/preview-font-loader.ts` → `FONT_FAMILY_OPTIONS` in `src/ui/design-studio/subtitle-controls.ts` → `DEFAULT_SUBTITLE_STYLE.fontFamily` if needed in `src/transcription/types.ts`.
- **Preview=bake?** YES — the same TTF must be loaded via FontFace API (for canvas) AND written to WASM FS at `/burnin-font.ttf` (for FreeType). Mismatched fonts break the WYSIWYG guarantee.
- **Sync points:** picker value key (opaque string, e.g. `'dejavu-sans'`) must be consistent across all four maps above.
- **web_accessible_resources:** `assets/fonts/*` must remain in `wxt.config.ts` `web_accessible_resources` for `browser.runtime.getURL` to work in content scripts and extension pages.

## Message pipelines — v3 (BUG-038 terminal ownership)

- **Add a pipeline:** define `MSG_<NAME>_{START,ACK,OFFSCREEN,PROGRESS,COMPLETE,CANCEL}` in `src/messaging/types.ts`, mirroring the existing shape (payload interfaces + parse helpers).
- **Add a query (v2, new kind):** a plain request/response with no lifecycle — reference: `MSG_QUERY_TRANSCODE_INFLIGHT` (v5.4.0 recovery). Queries must be **idempotent and side-effect-free** so recovery chains can call them safely; do not grow a query into a pipeline — if it needs PROGRESS, it's a pipeline.
- **Background relay:** add `register<Name>Tab` / `relay<Name>Broadcast` / `relay<Name>Failure` in `entrypoints/background.ts`; add to `rememberRelayTab` / `forgetRelayTab` via `src/messaging/relay-registry.ts`.
- **Design Studio receiver:** decide tab-relay vs `runtime.onMessage` — if Design Studio is the consumer, use `burnInSkipTabRelayByJobId` pattern (extension page, not content script).
- **Studio-direct progress (H12 resolved):** transcode/transcribe/burn-in clients on extension pages listen to the original offscreen `runtime.onMessage` broadcast. Background marks extension-page initiators in the matching `*SkipTabRelayByJobId` map and suppresses only `tabs.sendMessage`; the late-bound Reddit-tab fallback is for content-script jobs, not normal Studio delivery.
- **Terminal owner (transcribe, BUG-038):** after ACK, background—not the page—owns terminal persistence. Store the minimum job context needed to persist either result or scaffold (`durationSeconds`, language), keep a wall-clock watchdog beyond the worker ceiling, commit IDB before the ready signal, and retire context on cancel/supersession. A future recoverable pipeline must name its durable terminal owner explicitly; never place the only save/timeout listener in a tab that the user can close.
- **Chunked blob relays (v2):** `MSG_GET_BAKED_MP4_META/_CHUNK` accept `store: 'baked' | 'base'` (default `'baked'`, backward compatible); background keeps a per-store byte cache. Adding a new fetchable store means extending that union, not a new message pair.
- **Offscreen handler:** add to `entrypoints/offscreen/main.ts` job queue.
- **Sync points:**
  - Failure must broadcast COMPLETE **before** `forgetRelayTab` (BUG-032).
  - Cross-pipeline queue races: burn-in reads `rvnLastBaseMp4` written by transcode — ensure ordering via IDB existence check, not queue coordination.
  - Heartbeats tagged `*-heartbeat` so stall detectors ignore them (BUG-006).
  - **Not everything is a message (v2):** cross-context *state* belongs in a storage key with `storage.onChanged` (see Take lifecycle seam + ADR-0002). Reach for a pipeline only when there is work-with-progress to relay.

## Storage — v2 (full-IDB preferences)

- **User preferences (v5.11):** all durable truth lives in extension-origin `rvnUserPrefs` IDB: one `global` row plus per-entity `profiles` / `customStyles` rows. `rvnUserPrefs.v2` local holds schema/revision timestamps only and is published after the atomic transaction.
- **Preference writer:** every mutation—including import—stays behind the preserved `user-preferences.ts` API + `enqueuePrefsOp`. Normalization strips transcript result text before the IDB split; profiles retain voice + subtitle setting snapshots.
- **Content-script boundary:** `user-prefs-db.ts` detects Reddit origin and uses `MSG_USER_PREFS_DB_LOAD` / `REPLACE`; background calls explicit direct helpers. These are bounded request/response operations, not progress pipelines. Never open the DB directly from a content script.
- **Migration:** read v1 blob → normalize → atomic IDB replace → coordinator/theme publication → remove v1. Any DB failure returns/retains v1 and retries later.
- **New small datum:** `chrome.storage.local` key → add to storage map (`docs/design-studio.md §3.2`); one writer only. Preference truth does not return to local storage.
- **New large/structured datum:** new `src/storage/*-db.ts` IDB module + relay if a content script needs access (content scripts cannot read extension IDB — they get bytes via chunked background relay).
- **New cross-context signal:** `rvn.<x>.ready` key + poll/listener pattern (see `rvn.sessionTranscript.ready` as reference).
- **Rule:** never put image blobs or transcript cue text in `rvnUserPrefs` — size, quota, and relay semantics all break.
- **Persist-before-publish rule (H13, ENFORCED since 2026-07-12):** the three `saveLast*` store functions throw on unpersistable size (exported `*_MIN/MAX_BYTES` bounds) and on IDB failure, and return the authoritative persisted meta (`savedAt`/`byteLength`/`mimeType`/`durationSeconds`). Callers MUST build stamps and fire `*.ready` signals only from that returned meta — never from `Date.now()` or the input blob. A new store module must ship the same contract; a new save caller that bypasses the returned meta recreates the R13 bug class.

## Theme / background / canvas flair — v1

- **New theme preset/background:** `src/theme/presets.ts`, `src/theme/backgrounds.ts`; animated flair resolves through the audio-reactive registry.
- **Preview=bake?** YES by construction — canvas capture becomes the video track; theme changes appear in every recorded frame.
- **Gotcha:** Profile at 24 fps before merge — expensive per-frame work can drop below `WAVEFORM_TARGET_FPS` and cause dup-storm on slow machines (BUG-007 trigger class).
- **Layout constants:** keep waveform bar counts/spacing fixed in v4 scope — changing them breaks the preview WYSIWYG guarantee for clips already recorded.

## Audio-reactive visual system — v20 (v6 Phase 4 Style/governor integration)

- **Carrier:** `src/theme/audio-reactive/audio-frame.ts` owns `AudioVizFrame`: normalized energy (0–1), exactly 32 log-spaced bands (0–1), optional waveform (-1–1), shared `timeMs`, and optional transient. `WaveformRenderer.drawFrame()` supplies live analyser data; `renderThemePreview()` supplies representative synthetic data. Raw time-domain bytes and the deterministic preview waveform are normalized only when the active definition requests them. Never invent a second preview-only frame shape (I22).
- **Registry/runtime:** `src/theme/audio-reactive/index.ts` registers `AudioVisualDefinition` factories by `kind:id` (`spectrum` / `overlay`). Optional input demand lives in static `definition.wants`; producers call `getAudioVisualWants()` before frame construction and must never create a visual just to inspect capabilities. `renderAudioVisualForCanvas()` creates once and reuses state through a `WeakMap<HTMLCanvasElement, …>`, clamps `dt` to 100 ms, and resolves normalized defaults/overrides. Overlay render environments carry only `amplitudeMode` and `reduceMotion`, which Forest immediately consumes; do not grow them into a second frame carrier.
- **Draw slots:** primary overlays render first, then up to three normalized ordered stackables, then the spectrum; all occupy the existing record-time canvas visual layer below subtitles. This is not a fourth compositing layer. Subtitles remain post-base (I3).
- **Registered spectra:** `audio-reactive/spectra/classic-neon.ts` owns the prior 32-bar transfer curve and default/fallback. `minimal.ts` is the 8–16 mark accessibility definition. `phosphor.ts` is a ≤240-cell CRT. `radial-spectrum.ts` is a mirrored 24–64 segment polar ring. `central-pulse.ts` is a 36–72 point organic orb with ≤3 envelope echoes. `oscilloscope.ts` is the sole `wants.waveform` consumer: rising-zero-crossing triggering downsamples the analyser snapshot to 96–160 points, then a preallocated six-slot ring provides at most 960 trace elements and clears across long render gaps. It supports linear/circular layouts, an instrument graticule, High Contrast without history/glow, and a fixed energy-scaled reduced-motion wave. All six use the same capture/preview definition and shared alignment environment. If a saved additive spectrum ID has no registered definition, capture falls back to Classic rather than drawing blank.
- **Non-linear/simulation seam:** `audio-reactive/layout.ts` owns only consumed pure coordinates; flow/spatial/agent/grid/emitter/plume helpers remain narrowly consumer-driven. Digital Rain's `BoundedActivationGrid` remains a directional float-propagation lattice; Conway's separate `BoundedLifeGrid` is binary, double-buffered, dead-edge, and B3/S23-only. Layered Smoke's `BoundedPlumeField<T>` is only a fixed group of newest-first node rings with age/expiry and a live plume ceiling; it has no airflow, pressure, fluid cells, physics, or renderer. None pretends to be a universal simulation API. `simulation/stackable.ts` creates isolated per-canvas state, preserves saved order, skips duplicate/over-cap IDs, and sums `getPerformanceCost()`. It owns no scene graph, arbitrary chain authoring, auto-governor, physics, or drawing policy. Aurora ribbon geometry, Glitch tear/onset state, Rising Ember spawn/flight, electricity route/contact/branch buffers, Conway audio pattern seeding, Smoke buoyancy/curl, Neon tube/charge state, and Particle Burst onset/shell/physics state stay consumer-local.
- **Registered overlays:** `audio-reactive/overlays/sparkle.ts` (twinkle/particle, 18–64), `bokeh.ts` (public **Bubbles**, serialized ID `bokeh`; soft-lens depth/parallax, 5–14), `forest-spirits.ts` (three 6–16-node chaining-boids spirits, 18–48 pooled agents / ≤192 render elements), `digital-rain.ts` (14×9–32×18 vertical/horizontal/radial glyph lattice, ≤577 elements), `inferno.ts` (28–72 particle hearth/bonfire/corona, ≤219 elements), `aurora.ts` (100–200 tapered ribbon shards from bar tops/opposing sides/radial rim, ≤403 elements), and `glitch.ts` (12–36 scanlines + two RGB ghosts + ≤10 source-copy tears, ≤81 elements) are deterministic registry-native algorithms. Glitch uses explicit onset hints or local positive spectral flux, supports horizontal/bilateral/radial damage geometry, and performs no canvas self-copy under reduced motion. Old placeholder pixels are intentionally not preserved (ADR-0009/0010).
- **Registered stackables:** `audio-reactive/stackables/ember.ts` is Rising Ember: 16–44 lifetime-pooled cinders / ≤132 elements. `stackables/electricity.ts` exports two definitions: Electric Arc (`electric-arc`) uses 6–18 short corona streamers rooted on 3–6 conductors with ≤8 forks / ≤300 passes; Lightning (`lightning`) keeps one continuously connected 14–30-point route between two contacts plus ≤5 branches / ≤158 elements. `stackables/conway.ts` owns one fixed 48×16 Life field, deterministic glider/R-pentomino/acorn/oscillator audio stamps, 80–220 ms generations, and ≤769 paints. `stackables/smoke.ts` owns 4–10 plume histories of 9 fixed nodes each, audio-weighted buoyancy/curl, three-pass volumetric lobes and one spine per plume, capped at ≤280 elements. `stackables/neon-glow.ts` owns 3–7 continuous 18-point tubes and two charge phases per tube, capped at 126 geometry points / 49 bloom-body-core and knot passes; its path atmosphere is intentionally independent from Classic's bar spectrum. `stackables/particle-burst.ts` owns 14–28 onset shards, ≤3 fixed shock shells, local positive-flux history, and a ≤261-pass ceiling. All seven IDs support linear/centered/radial geometry, empty capture silence, deterministic preview, no-blur High Contrast, and fixed reduced motion.
- **Persistence:** `DesignOverrides` carries optional `spectrumPreset`, `visualizerParams`, `overlayPreset`, and `stackables`. `normalizeDesignOverrides`/`normalizeVisualizerParams` allowlist IDs/layouts, clamp controls/weights, normalize ≤7 palette colors, and dedupe/cap stackables at three. No new store, signal, message, or `USER_PREFS_VERSION` bump.
- **Shared UI ramp:** `CIVIDIS` in `src/ui/tokens.ts` mirrors `--rvn-cividis-*` in `studio-palette.css`; `test-ui-tokens.mjs` prevents branch drift. Pair color with labels/icons—never encode governor state by hue alone.
- **Style discovery/persistence:** `style-controls.ts` registers and discovers production definitions, renders the signal chain and pickers, and commits only normalized `DesignOverrides` patches through `mount-clip-studio.ts`'s existing local-preview/debounced-save pathway. Do not recreate the retired Background Flair bridge or add a second save channel. Runtime-only spectrum layout/afterimage discovery is cached once per ID; picker rows may scroll, but the Control Center grid must retain `minmax(0, 1fr)` / card `min-width:0` containment.
- **Performance/size:** `performance-governor.ts` is a pure policy shared by Style and `backgrounds.ts`: cost scales definition `maxElements` by Detail; Comfortable ≤560, Elevated ≤980, Guarded above 980. Guarded suspends exactly the costliest selected accent from `activeStackables`; never rewrite the saved list. Canvas 2D only; no WebGL/WASM/dependency. `npm run qa:visual-size -- --preset <id> --base <base.mp4> --baked <baked.mp4>` reads real MP4 metadata, requires a near-120-second pair, and enforces base ≤25 MiB / baked ≤30 MiB plus ≤0.1 s drift. Run it for every heavy preset and keep the artifact report with QA evidence.
- **Legibility/hot-swap:** `subtitle-safe-dim.ts` paints after spectrum and before post-base captions in preview/capture. `WaveformRenderer.setTheme()` and Studio local changes reset audio-visual + stackable canvas state only when spectrum/overlay/stackable identity changes; tuning edits retain smoothing histories.
- **Decision/canonical design:** ADR-0007 + ADR-0009 + ADR-0010 (Accepted) + `docs/v6.0.0-custom-styles-refactor.md`. ADR-0007 already specifies the ordered ≤3 stackables and performance-governor direction; this pure policy changes no structural ownership, so no new ADR. Live browser FPS and real heavy-preset/three-stack artifacts remain confidence gates.

## Design Studio surfaces — v2 (Style panel contract)

- **New section/control:** nest inside the four bounded sections (Style / Background / Voice / Subtitles); reuse `studio-save-pathways.ts` + `studio-subpanel-guard.ts` — do NOT hand-roll `window.confirm` patterns.
- **Style contract:** the live identifiers are `data-studio-panel="style"` and `data-summary-style`; `bar-style` is retired. The waveform icon remains the intentional Style/signal glyph. Registry choices call `applyLocalDesignOverrides` and the existing debounced custom-style save.
- **Dirty state:** respect the four independent dirty layers — profile / custom style / transcript panel / segment modal. Never collapse to one boolean (`docs/design-studio.md §3.5`).
- **Data contracts:** `data-studio-panel`, `data-summary-*`, `data-studio-panel-open` are checked by multiple consumers — do not rename without a grep audit.
- **Preview coupling:** new controls that affect clip appearance must call `applyLocalDesignOverrides()` → immediate preview; debounced persist for HSV-style rapid input.
- **Import rule:** Studio and Popup import only direct files — never `@/src/voice` or `@/src/transcription` barrels (they pull WASM dependencies; BUG-008 pattern).
- **Preference backup (v5.11):** Export/Import belongs beside profile management. Flush pending writes before export/import; validate the versioned envelope, normalize, confirm replacement, then commit once through the preference queue.

## Voice live-mic preview — v1 (v5.3.1)

Transient mic capture as an alternative *input source* for the in-Studio voice audition.
Adds **no** new fragment, renderer, message family, or storage — it only feeds a fresh
capture into the existing voice render path.

- **Capture seam:** `src/voice/mic-test-capture.ts` → `startMicTestCapture(options)` returns
  a controller (`stop` / `cancel` / `done: Promise<Blob>`). Pure leaf: **no FFmpeg, no
  storage imports.** Inject mic constraints via `options.acquireStream`
  (`() => acquireMicStream(prefs.audio)`) to match the real recorder.
- **Render/play path:** reuse `resolveVoiceGraph()` → `processAudioWithGraph(blob, graph,
  …, { maxDurationSeconds })` → the single `VoicePreviewHandle.playProcessed`. **Do not**
  add a wrapper or a second player.
- **Preview=bake?** YES by construction — identical resolve + renderer as the bake; the
  capture is just a different input. No new fidelity gap.
- **Sync points:** the two audition buttons + shared Stop in `voice-controls.ts`
  (`refreshStopUi`, `refreshActionAvailability`); CSS in `entrypoints/design-studio/style.css`
  (`.studio__voice-tests`, `.studio__voice-meter`, `.studio__voice-stoprow`); canonical
  doc `docs/design-studio.md` §6.5; plan `docs/v5.3.1-voice-live-mic-preview-design-document.md`.
- **Invariant (must hold):** the capture is **never** persisted — `mic-test-capture.ts`
  imports no storage, so it cannot write `rvnLastRecording`. Any future "save this take"
  feature must be a deliberate, separate decision, not a silent IDB write here.
- **Gotcha:** Design Studio is a *separate origin* from reddit.com, so `getUserMedia`
  prompts again on first use there (verified working — v5.3.1 §6.0 gate).

## Overlay encoding backbone — v1 (v5.3.9 / v5.3.10)

The subtitle-overlay bake is "segments, not files": the chunk planner partitions
the timeline, a **painter** draws any global frame, an **encoder strategy**
turns painted frames into encoded segments, a **stitcher** joins them, and the
composite consumes the result. Two encoder strategies exist; both sit on the
same paint seam.

**Current default (ADR-0003):** browser full composite bypasses those overlay-segment encoders entirely — it decodes the clean base, calls the same painter directly at each base-frame PTS, blends, encodes, and muxes in page. The dual-IVF and MediaRecorder segment strategies below are permanent fallback seams, not prerequisites of the default path.

- **The paint seam (encoder-agnostic):** `createOverlayFramePainter` in
  `src/transcription/subtitle-overlay-renderer.ts` — paints the overlay's
  global frame at any timestamp (cue cache + fonts handled). Every capture
  strategy MUST paint at `(startFrame + i) / fps` — the exact serial expression
  — so animation phase (Oklch, gradient wave) and cue-cache keys stay
  chunk-invariant. OffscreenCanvas-backed, no DOM in the loop → worker-portable.
- **Add an encoder strategy:** produce per-chunk artifacts + a stitcher for
  them, decide what the composite consumes, and give the strategy its own
  fallback edge to the MediaRecorder pipeline. Reference implementations:
  MediaRecorder (`captureOverlayChunkRaw` → FFmpeg stream-copy concat →
  normalize → WebM overlay composite) and WebCodecs
  (`src/encoding/overlay-webcodecs-encoder.ts` → pure-TS IVF concat →
  alphamerge composite, NO normalize — see ADR-0001 for why that is safe there
  and only there).
- **Segment metadata:** `src/encoding/encoded-segment.ts`
  (`EncodedOverlaySegmentMeta`) — timing, cue span, codec, cost telemetry.
  New strategies must emit it; future editing features consume it.
- **Preview=bake?** YES via the shared painter — the paint pixels are identical
  regardless of encoder. The encode/composite leg is the per-strategy QA surface.
- **Sync points:** `overlay-chunk-planner.ts` (partition invariants, tested),
  `subtitle-canvas-bake.ts` (strategy selection + fallback order:
  webcodecs → mediarecorder-parallel → serial → drawtext),
  `experimental.parallelBake` / `experimental.webCodecsBake` prefs
  (**both default TRUE since v5.4.0** — `resolveOverlayBakeEncoder` /
  `resolveParallelBakeEnabled` in `user-preferences.ts` + one-time rollout
  migration; opt-out only),
  Overlay Lab toggles (BOTH the render and bake buttons must pass strategy
  flags explicitly — v5.3.9.1 gotcha), timing summary
  (`overlay-lab-timing-summary.ts`: distinct stage label per distinct work).
- **Gotchas:**
  - Never mark an encoder's output "composite-ready" without construction-level
    guarantees + validation (v5.3.9.1 regression class; ADR-0001).
  - MediaRecorder output is VFR with tail-hold frames — it always needs
    normalize; only constructed (WebCodecs) streams may skip it.
  - Alpha luma range from `VideoEncoder` is machine-dependent — always go
    through the calibration probe (`src/encoding/webcodecs-support.ts`), never
    assume limited or full.

## Take lifecycle & artifacts — v1 (v5.4.0)

The "current take" is the single cross-context session datum: one snapshot under
`rvn.take.current` (`chrome.storage.local`), synced by `storage.onChanged` —
**deliberately not a message family** (ADR-0002). Blobs never enter the snapshot;
they stay in the single-slot IDB stores, referenced by `TakeArtifactStamp`s.
Authoritative contract: the header of `src/session/take-manager.ts`.

- **Consume the take (read/subscribe):** `getTakeManager().getCurrentTake()` /
  `.subscribe(listener)` — reads pass through `normalizeStaleTake` (transient
  `recording`/`processing` older than `STALE_TRANSIENT_MS` = 2 min demote to
  `draft`). Never read the raw storage key directly.
- **Write the take:** only through TakeManager methods, and only from the three
  sanctioned writers — recorder session (capture transitions), background
  (artifact stamps after relayed IDB writes), Studio bake (`updateFromBake`).
  A new writer is an architectural decision: name it in ADR-0002's successor.
- **Add an artifact kind:** extend `TakeArtifactKind` +
  stamp it where its blob is persisted; consumers must treat unknown kinds as
  absent (forward compatibility).
- **Add a status:** extend `TakeStatus` + the deck state matrix
  (`current-take-status.ts`, tested in `scripts/test-take-deck.mjs`) + the
  transient set in `isTransientTakeStatus` if it can strand on crash.
- **Capture voice provenance (H8):** `CurrentTake.captureVoiceIntent` exists before
  `baseMp4` is ready and contains only normalized config + `voiceEffectUserIntentKey`.
  Recorder refreshes it in the awaited pre-transcode patch; recovery normalizes
  the opaque config, renders it, and then promotes `TakeVoiceStamp`. Do not replace
  this with a read of mutable `rvnUserPrefs` except for legacy snapshots that lack it.
- **Preview=bake?** N/A — pure state; but the deck's Download CTA must resolve
  blobs from extension-origin IDB *at click time*, never cache bytes in the UI.
- **Sync points:** `voice-recorder.ts` (transitions + `sessionEpoch` race guard +
  prior-snapshot stash), `background.ts` (`recordArtifact`, orphan adoption,
  `persistOrphanStudioTranscodeResult`), `studio-take-recovery.ts` (recovery
  chain + `MSG_QUERY_TRANSCODE_INFLIGHT`), `recorder-panel.ts` (attach mode +
  `maybePromoteNewerTake` live-sync), tests `test-take-manager.mjs` /
  `test-take-deck.mjs`.
- **Verify before adopting blobs (H6, mandatory since 2026-07-06):** any consumer
  that resolves a blob a stamp points at MUST call
  `takeArtifactMatchesStore(stamp, storeMeta)` first — the stores are
  single-slot and may hold a newer capture's bytes. On mismatch, call
  `getTakeManager().clearArtifact(kind, { note })` with an honest note
  ("Recording superseded — re-record"); never adopt silently. Content-script
  consumers get the store meta cheaply via `fetchBakedMp4Meta(store)`
  (`src/storage/baked-mp4-fetch.ts`) before pulling chunks. Reference call
  sites: `studio-take-recovery.ts` resume, `recorder-panel.ts` attach,
  `current-take-status.ts` Download CTA.
- **Gotchas:**
  - Blobs are written **only at stop** — a feature that persists mid-recording
    audio breaks the discard-restore invariant (I10) and needs an ADR.
  - Keep the snapshot JSON-safe and small; `parseCurrentTake` drops anything
    malformed — additive fields must be optional.
  - Concurrent recordings are supported (user-QA'd 2026-07-06): freshness
    precedence resolves the winner; expect a transient window between two
    completions where the display shows the newer take's length while the
    older one is still the downloadable artifact (accepted, display-only).

## Studio capture host — v1 (v5.4.0)

Headless recorder mount for any surface that wants native capture.
Reference consumers: `src/ui/design-studio/studio-recorder.ts` (Studio deck
transport); `src/ui/recorder-panel.ts` still drives the session directly and
can adopt the host when its UI is unified.

- **Mount:** `mountRecorder({ hostContext, onStateChange, onLiveCanvas,
  onTakeComplete })` in `src/recorder/recorder-host.ts` → handle with
  `open/startRecording/stopRecording/cancel/close`. The host owns mic/session
  lifecycle + auto-draft on close; the surface owns ALL transport chrome.
- **Live preview contract (the WYSIWYG invariant):** `onLiveCanvas` hands over
  the `WaveformRenderer` **canvas element itself** — the exact element
  `captureStream()` feeds MediaRecorder. Insert it; never copy pixels from it
  per frame. Zero copies = zero preview-vs-output drift.
- **Preview=bake?** YES by construction — the previewed canvas IS the encoded
  video source.
- **Sync points:** take transitions happen inside `VoiceRecorderSession`
  (see Take lifecycle seam); `pagehide` auto-draft on every surface;
  concurrent-session guard when a fresh transient take from the *other*
  surface exists; workflow phase writes (`'capture'` on record, `'polish'` on
  stop).
- **Gotchas:**
  - Design Studio is a separate origin from reddit.com — `getUserMedia`
    permission prompts once per origin.
  - `dispose()` must NOT tear down during `processing`
    (`detachAuditionOnPageHide` — the v5.4.0 QA-#4 lesson: closing chrome must
    not abort the offscreen transcode).
  - Pause any theme RAF loops while the live canvas is mounted
    (`auditionActive` guard) — two RAF writers on one preview surface flicker.

## Audio editing & voice re-apply — v1 (v5.6.0)

Audio is decoupled from capture: the raw mic WebM (`baseRecording`) is the
invariant source; the voice a take's MP4 audio carries is recorded as
provenance (`TakeVoiceStamp` on the snapshot: intentKey + normalized config +
origin capture/reapply + revision); re-applying a voice is a Dulcet II render
plus a **pure stream-copy remux** — video packets bit-exact, so visuals
(including burned-in subtitles) never re-composite for an audio change.
Canonical contract: `docs/v5.6.0-audio-decoupling.md` (+ ADR-0004).

- **Read the take's raw audio:** ONLY through `loadCleanAudioForTake(take)`
  (`src/audio/clean-audio-source.ts`) — it enforces H6 and demotes dead stamps.
  Never load `rvnLastRecording` directly for editing purposes.
- **Replace an MP4's audio track:** `replaceAudioTrack({ video, audio })`
  (`src/audio/audio-remux.ts`) — audio must already be AAC-in-MP4
  (`processAudioWithGraph` output; pass `forceRender: true` to render a
  clean track from a no-op graph). Output is validated (exact video packet
  count, A/V duration drift bounds) or throws; callers write stores only
  after validation (I7).
- **Re-apply a voice end-to-end:** `reapplyVoiceToCurrentTake({ config })`
  (`src/audio/voice-reapply.ts`) — Studio page only; updates baseMp4 AND
  bakedMp4 when stamped, stamps provenance via `createTakeVoiceStamp`,
  fires `BAKED_MP4_READY_KEY` when baked bytes changed. Studio surface:
  "Apply voice to current take" in `voice-controls.ts`.
- **Editing primitives:** `src/timeline/timeline.ts` (frame math = the
  painter's global-PTS expression; `TrimRange` + `clampTrimRange`),
  `src/editing/segment-dirty-tracker.ts` (cue diff → dirty windows →
  segments), `src/editing/partial-rebake-coordinator.ts` (keyframe-grid
  splice coordinator — **execution SHIPPED v5.7.0**; see the Partial re-bake
  splice seam below), `src/editing/trim.ts` (`planTrim` gate; intent in
  `take.edits.trim`; `loadTrimIntent` read helper added v5.8.0; mediabunny
  `Conversion` apply; pure `shiftCuesForTrim` added v5.9.0 — mirrors the
  ghost-preview math `projectCueThroughTrim`, no frame-snapping of cue times;
  v5.10.0 adds `applyTrimToWebM` — audio-only trim of the raw capture WebM,
  video track discarded by design — and the pure `planRawTrimLeg` gate
  `'skip' | 'drop-stamp' | 'trim'` over the H6 stamp↔store check).
- **Apply a trim end-to-end (v5.9.0):** `applyTrimToCurrentTake({ requested,
  fps, editedResult })` (`src/editing/trim-apply.ts` — NEW module, kept out of
  `trim.ts` so `test-timeline.mjs` bundles the pure logic without the storage
  graph; structurally parallel to `reapplyVoiceToCurrentTake`). H6-verified
  base → container trim → dual-copy cue shift (`replaceSessionTranscriptResults`
  rewrites BOTH session-transcript copies — revert must never resurrect
  pre-trim times) → superseded guard → commit-last: new base stamp +
  `meta.durationSeconds` + `edits.trim` clear + `bakedMp4` stamp DELETE
  (patch `null` = delete, v5.9.0 take-manager evolution) +
  status `baked → ready`. **v5.10.0 raw leg:** `planRawTrimLeg` resolves the
  `baseRecording` stamp against `rvnLastRecording` up front; a verified match
  runs `applyTrimToWebM` (audio-only, sample-accurate Opus) and the fresh
  `baseRecording` stamp rides the SAME `updateCurrentTake` write — post-trim
  voice re-apply / Change Voice stay available. Any raw-leg failure (no stamp,
  H6 mismatch, conversion error, un-persistable size per the exported
  `LAST_RECORDING_MIN/MAX_BYTES` bounds — H13 pre-check) demotes to the v5.9
  stamp-DELETE outcome and never fails the trim. Outcome carries tri-state
  `rawAudio: 'trimmed' | 'dropped' | 'none'`. Deliberately NO
  `BAKED_MP4_READY_KEY` (no baked bytes produced — the take-snapshot broadcast
  is the channel). Studio surface: "Apply trim" + two-click confirm in the
  timeline trim strip (`onApplyTrim` dep; host owns the post-apply
  draft/undo/clip-source refresh; the Voice panel's apply affordance
  re-enables emergently off the surviving stamp).
- **Preview=bake?** YES for voice — re-apply resolves through the same
  `resolveVoiceGraph` + renderer as the audition. N/A for the remux
  (bit-copy by definition).
- **Chronos stages:** `voice-reapply-{dsp,remux-base,remux-baked,save}`
  (`voice-reapply-plan.ts`); `partial-rebake-plan` is telemetry-only and must
  never label execution work.
- **Sync points:** `take-manager.ts` (`voice`/`edits` parse + merge,
  `createTakeVoiceStamp` revision semantics), `voice-recorder.ts` capture
  stamp (rides the ready promotion patch), tests
  `test-voice-reapply-plan.mjs` / `test-timeline.mjs` /
  `test-segment-dirty-tracker.mjs` / `test-partial-rebake-plan.mjs` /
  `test-take-manager.mjs` (v5.6.0 block).
- **Gotchas:**
  - A DSP fallback ABORTS the re-apply (never silently ship raw audio under
    a claimed voice); the take stays untouched.
  - **A trim apply KEEPS THE VOICE AVAILABLE (v5.10.0; supersedes the v5.9
    voice-lock):** the raw capture WebM is trimmed with the MP4 (audio-only —
    the VP8 canvas track is discarded because every post-trim consumer is an
    audio consumer and mediabunny would force a whole-clip video re-encode)
    and `baseRecording` is re-stamped in the same take write. The v5.9
    lock-in is now only the DEGRADED outcome (`rawAudio: 'dropped'`): stamp
    absent/mismatched, conversion failure, or a result outside the store's
    persistability bounds — then the stamp drops and a later re-apply fails
    honestly at the clean-audio door ("re-record to change the voice"), never
    desynced audio. The trimmed WebM's `savedAt` drives the Voice panel's
    poll, so the affordance re-enables with zero UI code.
    (`docs/v5.10.0-raw-trim-apply-roadmap.md` §10 is the as-built record.)
  - **Post-apply bakes are FULL composites by construction** —
    `computePartialRebakePlan` nulls on any duration change; never "fix" that
    guard without replacing what it protects.
  - Audio tails are bounded at video end + 1 s (`AUDIO_TAIL_ALLOWANCE_SECONDS`)
    — long convolution rings are cut by design.
  - Re-check take identity before the commit writes — a concurrent capture
    owns the single-slot stores (`superseded` error path).
  - Phase 2b (partial-splice execution) shipped in v5.7.0 — `partial-rebake-plan`
    telemetry now has a real executor (`coordinateRebake` → the Partial re-bake
    splice seam below). The `partial-splice-*` chronos stages are the live labels;
    `partial-rebake-plan` stays PLAN-only and must never label execution work.

## Partial re-bake splice — v1 (v5.7.0)

Phase 2b execution of the v5.6.0 planner: when a *re*-bake changes only a bounded
fraction of cues, re-encode just the keyframe-aligned dirty GOPs instead of the whole
clip. Ships behind `experimental.partialRebakeSplice` (**default ON**, opt-out).
Decision: ADR-0005; contract: `docs/v5.6.0-audio-decoupling.md` §4.2 + §13 QA checklist.

- **The pure plan (leaf):** `src/editing/splice-plan.ts` — `planSplice()` produces
  contiguous alternating `keep`/`reencode` regions on the artifact's REAL keyframe (GOP)
  boundaries (an encoder's keyframes need not sit on the assumed 2 s grid); the two gates
  `validateSplicePlan` (every cut on a real keyframe) and `validateSpliceOutput` ("partial
  never lies": kept + reencoded == output == expected, ≤1-frame drift); `selectSpliceFidelityAnchors`
  picks probe timestamps. Node-tested (`test-splice-plan.mjs`).
- **The browser executor:** `src/composite/composite-splice.ts` `renderCompositeSplice` —
  takes BOTH the prior `bakedMp4` (kept packets copied bit-exact) AND the CLEAN `baseMp4`
  (dirty regions re-composited from clean frames, because the baked frames there still
  carry the OLD burned-in subtitle). Re-encodes with the artifact's OWN codec string,
  forced keyframe on each region's first frame.
- **The load-bearing gate:** `src/composite/composite-fidelity.ts` `verifySpliceKeptFrames`
  — decodes the spliced output at kept-region anchors and proves them pixel-identical to
  the original (mean Δ ≤ 1.5, peak ≤ 24); the copied AVC packets share the original avcC,
  so any difference means the spliced track's sample description corrupted them. Mandatory
  final step; a miss throws → full composite.
- **The honest wiring:** `src/editing/partial-rebake-coordinator.ts` `coordinateRebake`
  takes an injected `executePartialSplice` (keeps the module pure), reports `executed:'partial'`
  ONLY when real bytes come back, and **propagates AbortError** (never a silent full
  re-render). Bake-path entry: `bakeWithOptionalSplice` in `subtitle-bake.ts` (flag on +
  plan `partial` + a prior baked MP4 exists, else `runFullComposite`).
- **Preview=bake?** N/A directly — output is a subset of the same overlay-painted frames a
  full bake produces; the fidelity gate is what guarantees the kept region is byte-for-byte
  the earlier bake (invariant I16).
- **Chronos:** `partial-splice-{scan,reencode,assemble}` from real counters — never reuse
  `partial-rebake-plan` (telemetry) or `browser-composite-*` labels.
- **Add a codec:** the executor reads the artifact's own codec string; VP9 keyframes are
  self-contained and splice cleanly, AVC needs the fidelity proof (the whole reason the gate
  exists). A new container/codec ⇒ re-run the AVC+VP9 QA matrix (`docs/v5.6.0-audio-decoupling.md` §13).
- **Gotcha:** the coverage cap (`PARTIAL_REBAKE_MAX_COVERAGE` 0.6) + keyframe expansion mean
  a two-cue edit on a short clip often plans `full` — that is correct, not a bug (the splice
  would touch most GOPs anyway).

## Timeline cue editor — v1 (v5.8.0)

The visual replacement for the flat cue-list modal: a DOM + CSS-transform timeline
(draggable/resizable bars, ruler, waveform lane, minimap, stage-mode zoom, ✂ trim mode).
**It introduced NO new message family, storage key, or take writer** — it is a surface over
the existing edit / dirty-tracking / trim seams. Canonical as-built:
`docs/v5.8.0-trim-ui-visual-subtitle-editor.md`; Studio semantics: `docs/design-studio.md`.

- **The two pure leaves (add geometry / waveform math here):**
  `src/ui/design-studio/timeline-geometry.ts` — sec↔px, view-window viewport, snap
  (`resolveSnap`/`resolveSnapSticky`), resize/move constraints, trim projection. **One import
  only** (`timeline.ts` `snapTimeToFrame`) — it owns NO frame math of its own, so edited timing
  is frame-exact = bake-exact (I17). `src/ui/design-studio/waveform-peaks.ts` — pure min/max
  peak bins, zero imports. Both Node-tested (`test-timeline-geometry.mjs` 48, `test-waveform-peaks.mjs` 10).
- **The UI substrate:** `subtitle-timeline-editor.ts` renders bars/ruler/waveform/minimap and
  emits edits into the host's draft via a `SegmentEditorHandle`. The host
  (`subtitle-segment-editor.ts`) owns the draft, undo/redo, multi-select, and the suggestion
  engine; the component never mutates the draft directly.
- **The load-bearing host invariant (two-view source-of-truth):** List and Timeline edit the
  SAME `modalDraft`; `captureActiveDraft()` reads the List DOM *only when List is active* while
  Timeline writes straight to the draft. Break this and a timeline edit + Apply reads stale List
  values (dirty-state collapse — risk R15). Any new view onto the cue draft MUST route through
  the same capture discipline.
- **Waveform source:** `getDecodedBuffer()` on `segment-cue-player.ts` (additive) — the lane
  reads the SAME decoded `AudioBuffer` the ▶ preview plays; zero extra decode, time-aligned to
  the ruler so it can't imply a cue lands where the bake won't.
- **Trim:** ✂ mode writes the non-destructive `edits.trim` intent through the existing `planTrim`
  gate (`src/editing/trim.ts` `loadTrimIntent`/`storeTrimIntent`) → TakeManager `mergeTakeEdits`.
  v5.9.0 consumes it through `applyTrimToCurrentTake`: H6 base cut + live-draft/baseline cue shift +
  one take patch that clears intent and the stale baked stamp. v5.10.0 adds the raw leg to the same
  patch: the capture WebM is trimmed too (audio-only) and `baseRecording` is re-stamped — or
  honestly dropped when the leg cannot run — so post-trim Change Voice works from the editor.
- **Preview=bake?** YES for cue timing (frame-snap, I17). **YES for trim since v5.9.0
  (preview=APPLY):** the ghost bars project the live draft through `projectCueThroughTrim`,
  and `shiftCuesForTrim` reproduces that math on apply — the host passes the LIVE draft
  (`draftAsEditedResult`) into `applyTrimToCurrentTake`, never the stale store copy. The
  trim strip's Apply control is two-click-confirm (permanent; no restore for pre-apply
  bytes) and the host resets undo + reseeds every transcript copy on success.
- **Sync points:** the `SegmentEditorHandle` mount in `subtitle-controls.ts` (preserved
  verbatim — do not change the mount contract); `style.css` `.studio__cue-timeline*` + `--stage`
  dialog; palette tokens in `studio-palette.css`; the tests above.
- **Gotcha:** the surface is big (`subtitle-timeline-editor.ts` ~2k lines) but strictly additive
  — it consumes existing seams. Resist adding a message/store for timeline state; per-session view
  state lives in the component, cue data in the draft.

---

## How to extend this registry

When a feature introduces a genuinely new seam, add a `## <Seam> — v1` section here.
When an existing seam's contract changes (new required sync point, new gotcha discovered),
bump its version in the heading and add a one-line note of what changed.

---

## Resume in a new chat (carry-forward)

```
Extension points v1.35 (2026-07-14), feature/v6.0.0-custom-styles-refactor @ package 5.11.0.
Map v3.21 · v6 Phase 4 Style Control Center + governor integrated; focused desktop/mobile production-fixture QA PASS.
Core seams unchanged: messages v3 · prefs storage v2 · take/capture/audio editing/splice/timeline v1.
Audio-reactive visual system v20; no new context/message/store/signal/compositing layer.
AudioVizFrame: normalized energy + 32 bands + registry-gated optional waveform + shared clock (I22).
AudioVisual registry uses a WeakMap per-canvas runtime; two slots only: overlay below spectrum; both record-time capture.
Classic owns default/fallback; Minimal is the a11y meter; Phosphor is a ≤240-cell CRT; Radial is a capped 24–64 segment mirrored polar ring; Central is a capped 36–72 point centered organic orb with ≤3 envelope echoes.
Sparkle/Bubbles/Forest/Digital Rain/Inferno/Aurora/Glitch overlays active. Ordered stackables: Rising Ember 16–44 cinders / ≤132, Electric Arc 6–18 corona streamers / ≤300, Lightning sustained 14–30-point channel + ≤5 branches / ≤158, Conway Life dead-edge 48×16 B3/S23 / ≤769, Layered Smoke 4–10 plumes × 9 ring nodes / ≤280, Neon Glow 3–7 tubes × 18 points + two knots / ≤49, Particle Burst 14–28 onset shards × ≤3 blooms / ≤261. Registry order is primary overlay → ≤3 stackables → spectrum. `bokeh` remains the serialized stability key (ADR-0009/0010).
Shared Cividis contract: tokens.ts ↔ studio-palette.css, sync-tested; pair color with text/icon.
Novel effects remain Canvas 2D and must pass the real-artifact 120 s base≤25 MiB / baked≤30 MiB CLI gate.
Prefs remain rvnUserPrefs IDB + enqueuePrefsOp; new visual fields must normalize, no version bump.
H6/H8/H13/H14 and browser-composite fallback contracts remain unchanged.
Style uses the complete registries + existing DesignOverrides/save path; the shared governor returns active vs saved accents; caption-safe dim stays below captions.
Read ADR-0007/0009/0010 + v6 custom-styles roadmap. Next: live capture/FPS/a11y matrix + heavy 120-second artifact reports.
```
