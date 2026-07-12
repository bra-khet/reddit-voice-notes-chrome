# Extension Points — Reddit Voice Notes

**Version:** v1.8 · **Updated:** 2026-07-11 · **Reflects:** `main` @ `v5.9.0`
**Status:** Canonical registry of integration seams. Pair with `docs/architecture/architecture-map.md`.  
**Changelog:** v1.8 — full v5.9 audit: corrected the subtitle/bake seam to show direct browser composite as primary (dual-IVF is fallback), documented Studio-direct runtime progress (H12 resolved), added the fail-loud artifact-store write rule (H13), and removed the last inert-trim sentence. No new seam. v1.7 — **atomic trim APPLY** shipped (v5.9.0): the audio-editing seam's "artifact integration still deferred" caveat is lifted — new `trim-apply.ts` orchestrator entry (H6 base mutate, dual-copy cue shift via `shiftCuesForTrim`/`replaceSessionTranscriptResults`, stamp null-delete take patch, voice-lock + full-composite-after-apply gotchas); timeline cue editor seam's trim note updated (Apply strip control, preview=apply). NO new seam. v1.6 — **partial re-bake splice EXECUTION** shipped (v5.7.0): new "Partial re-bake splice — v1" seam; the "Audio editing & voice re-apply" seam's PLAN-only caveat is lifted (execution is live behind the kept-region fidelity gate, `experimental.partialRebakeSplice` **default ON**). Added "Timeline cue editor — v1" seam (v5.8.0: a DOM timeline surface over the existing edit / dirty-tracking / trim seams — **no** new message/storage/take-writer; pure `timeline-geometry`/`waveform-peaks` leaves; frame-snap via `timeline.ts`). v1.5 — added "Audio editing & voice re-apply — v1" seam (v5.6.0: TakeVoiceStamp provenance, clean-audio door, stream-copy remux, timeline/trim/dirty-tracking primitives); Take lifecycle seam gains the additive `voice`/`edits` snapshot fields. v1.4 — Take lifecycle seam: H6 shipped (`takeArtifactMatchesStore` + `clearArtifact` are now part of the contract — stamp verification is mandatory at consumption sites); carry-forward block added. v1.3 — added "Take lifecycle & artifacts — v1" and "Studio capture host — v1" seams (v5.4.0); bumped "Message pipelines" to v2 (query-message kind, `store` param on baked-MP4 relay); overlay backbone gotcha updated (webCodecsBake default flipped true). v1.2 — added "Overlay encoding backbone — v1" seam (v5.3.9/v5.3.10). v1.1 — added "Voice live-mic preview — v1" seam (v5.3.1). v1.0 — initial (eloquent-5).

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

## Message pipelines — v2 (v5.4.0)

- **Add a pipeline:** define `MSG_<NAME>_{START,ACK,OFFSCREEN,PROGRESS,COMPLETE,CANCEL}` in `src/messaging/types.ts`, mirroring the existing shape (payload interfaces + parse helpers).
- **Add a query (v2, new kind):** a plain request/response with no lifecycle — reference: `MSG_QUERY_TRANSCODE_INFLIGHT` (v5.4.0 recovery). Queries must be **idempotent and side-effect-free** so recovery chains can call them safely; do not grow a query into a pipeline — if it needs PROGRESS, it's a pipeline.
- **Background relay:** add `register<Name>Tab` / `relay<Name>Broadcast` / `relay<Name>Failure` in `entrypoints/background.ts`; add to `rememberRelayTab` / `forgetRelayTab` via `src/messaging/relay-registry.ts`.
- **Design Studio receiver:** decide tab-relay vs `runtime.onMessage` — if Design Studio is the consumer, use `burnInSkipTabRelayByJobId` pattern (extension page, not content script).
- **Studio-direct progress (H12 resolved):** transcode/transcribe/burn-in clients on extension pages listen to the original offscreen `runtime.onMessage` broadcast. Background marks extension-page initiators in the matching `*SkipTabRelayByJobId` map and suppresses only `tabs.sendMessage`; the late-bound Reddit-tab fallback is for content-script jobs, not normal Studio delivery.
- **Chunked blob relays (v2):** `MSG_GET_BAKED_MP4_META/_CHUNK` accept `store: 'baked' | 'base'` (default `'baked'`, backward compatible); background keeps a per-store byte cache. Adding a new fetchable store means extending that union, not a new message pair.
- **Offscreen handler:** add to `entrypoints/offscreen/main.ts` job queue.
- **Sync points:**
  - Failure must broadcast COMPLETE **before** `forgetRelayTab` (BUG-032).
  - Cross-pipeline queue races: burn-in reads `rvnLastBaseMp4` written by transcode — ensure ordering via IDB existence check, not queue coordination.
  - Heartbeats tagged `*-heartbeat` so stall detectors ignore them (BUG-006).
  - **Not everything is a message (v2):** cross-context *state* belongs in a storage key with `storage.onChanged` (see Take lifecycle seam + ADR-0002). Reach for a pipeline only when there is work-with-progress to relay.

## Storage — v1

- **New small datum:** `chrome.storage.local` key → add to storage map (`docs/design-studio.md §3.2`); one writer only; `enqueuePrefsOp` if it touches `rvnUserPrefs`.
- **New large/structured datum:** new `src/storage/*-db.ts` IDB module + relay if a content script needs access (content scripts cannot read extension IDB — they get bytes via chunked background relay).
- **New cross-context signal:** `rvn.<x>.ready` key + poll/listener pattern (see `rvn.sessionTranscript.ready` as reference).
- **Rule:** never put image blobs or transcript cue text in `rvnUserPrefs` — size, quota, and relay semantics all break.
- **Persist-before-publish rule (H13):** a blob-store save must fail loudly or return authoritative persisted metadata. Callers must not manufacture a stamp, fire `*.ready`, or report success merely because a `Promise<void>` resolved; size rejection and IDB failure are not success. Keep the order: persist → receive/verify meta → publish stamp/signal.

## Theme / background / canvas flair — v1

- **New theme preset/background:** `src/theme/presets.ts`, `src/theme/backgrounds.ts`; flair reuses existing per-frame draw patterns (`bokeh`, `sparkle`).
- **Preview=bake?** YES by construction — canvas capture becomes the video track; theme changes appear in every recorded frame.
- **Gotcha:** Profile at 24 fps before merge — expensive per-frame work can drop below `WAVEFORM_TARGET_FPS` and cause dup-storm on slow machines (BUG-007 trigger class).
- **Layout constants:** keep waveform bar counts/spacing fixed in v4 scope — changing them breaks the preview WYSIWYG guarantee for clips already recorded.

## Design Studio surfaces — v1

- **New section/control:** nest inside the four bounded sections (bar style / background / voice / subtitles); reuse `studio-save-pathways.ts` + `studio-subpanel-guard.ts` — do NOT hand-roll `window.confirm` patterns.
- **Dirty state:** respect the four independent dirty layers — profile / custom style / transcript panel / segment modal. Never collapse to one boolean (`docs/design-studio.md §3.5`).
- **Data contracts:** `data-studio-panel`, `data-summary-*`, `data-studio-panel-open` are checked by multiple consumers — do not rename without a grep audit.
- **Preview coupling:** new controls that affect clip appearance must call `applyLocalDesignOverrides()` → immediate preview; debounced persist for HSV-style rapid input.
- **Import rule:** Studio and Popup import only direct files — never `@/src/voice` or `@/src/transcription` barrels (they pull WASM dependencies; BUG-008 pattern).

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
  ghost-preview math `projectCueThroughTrim`, no frame-snapping of cue times).
- **Apply a trim end-to-end (v5.9.0):** `applyTrimToCurrentTake({ requested,
  fps, editedResult })` (`src/editing/trim-apply.ts` — NEW module, kept out of
  `trim.ts` so `test-timeline.mjs` bundles the pure logic without the storage
  graph; structurally parallel to `reapplyVoiceToCurrentTake`). H6-verified
  base → container trim → dual-copy cue shift (`replaceSessionTranscriptResults`
  rewrites BOTH session-transcript copies — revert must never resurrect
  pre-trim times) → superseded guard → commit-last: new base stamp +
  `meta.durationSeconds` + `edits.trim` clear + `bakedMp4`/`baseRecording`
  stamp DELETES (patch `null` = delete, v5.9.0 take-manager evolution) +
  status `baked → ready`. Deliberately NO `BAKED_MP4_READY_KEY` (no baked
  bytes produced — the take-snapshot broadcast is the channel). Studio
  surface: "Apply trim" + two-click confirm in the timeline trim strip
  (`onApplyTrim` dep; host owns the post-apply draft/undo/clip-source refresh).
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
  - **A trim apply LOCKS THE VOICE IN (v5.9.0):** it drops the `baseRecording`
    stamp (the raw WebM no longer matches the timeline), so a later re-apply
    fails honestly at the clean-audio door ("re-record to change the voice") —
    never desynced audio. Trimming the raw WebM is its own follow-up if wanted.
    `docs/v5.10.0-raw-trim-apply-roadmap.md` sketches that follow-up but is
    planning-only: implementation must reuse the existing `last-recording-db.ts`
    seam, preserve the H6 superseded-take guard, and obey H13's acknowledged-
    persistence rule before publishing a replacement raw-recording stamp.
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
  one take patch that clears intent and stale baked/raw-audio stamps.
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
Extension points v1.8 (2026-07-11), main @ tagged v5.9.0.
Seams: voice v5 · subtitle/font v1 · messages v2 · storage v1 · theme/Studio/live-mic v1 ·
overlay backbone v1 · take lifecycle v1 · capture host v1 · audio editing/re-apply v1 ·
partial splice v1 · timeline editor v1. No new seam/context/store/message in v5.9.
Default subtitle bake: browser decodes base → shared painter → encode/mux directly.
Fallbacks: dual-IVF+FFmpeg → MediaRecorder+FFmpeg → drawtext.
Studio pipeline progress is the offscreen runtime broadcast; skip-tab maps suppress duplicates.
Take state syncs through rvn.take.current (ADR-0002); H6 is mandatory before blob adoption.
Trim apply: H6 base cut + live/baseline cue shift + intent/stale-stamp clear; next bake is full.
Storage rule: persist and receive authoritative success/meta before publishing stamps/signals (H13).
Rule of thumb: state → storage key + onChanged; work-with-progress → MSG_ pipeline;
one-shot question → query message. New editing UI → reuse the edit/dirty/trim seams, don't add a wire.
```
