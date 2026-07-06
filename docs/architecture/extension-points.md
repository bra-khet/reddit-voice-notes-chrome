# Extension Points — Reddit Voice Notes

**Version:** v1.3 · **Updated:** 2026-07-06 · **Reflects:** `main` @ package `5.4.0` (tag deferred)  
**Status:** Canonical registry of integration seams. Pair with `docs/architecture/architecture-map.md`.  
**Changelog:** v1.3 — added "Take lifecycle & artifacts — v1" and "Studio capture host — v1" seams (v5.4.0); bumped "Message pipelines" to v2 (query-message kind, `store` param on baked-MP4 relay); overlay backbone gotcha updated (webCodecsBake default flipped true). v1.2 — added "Overlay encoding backbone — v1" seam (v5.3.9/v5.3.10). v1.1 — added "Voice live-mic preview — v1" seam (v5.3.1). v1.0 — initial (eloquent-5).

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
- **Preview path:** `src/ui/design-studio/subtitle-controls.ts` + `src/transcription/subtitle-preview.ts` + `src/transcription/subtitle-effects.ts`.
- **Bake path:** `src/ffmpeg/subtitle-burnin.ts` (drawtext strategies + `temporalizeDrawtextColor`).
- **Preview=bake?** YES, with documented quantization where FFmpeg drawtext is static per filter instance.
  - Animated colors → time-sliced static layers (`temporalizeDrawtextColor` / `RAINBOW_BAKE_SLICE_SECONDS`).
  - Font rendering → same DejaVu TTF files: FontFace API for canvas (RVN-* family names via `preview-font-loader.ts`), FreeType WASM FS for bake (`BURNIN_FONT_FS_PATH`).
- **Sync points:** style field ↔ `subtitle-preview.ts` render ↔ `subtitle-burnin.ts` drawtext ↔ `studio-section-summaries.ts` chip.
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
- **Gotchas:**
  - **Stamps are currently ordering-only.** The documented stamp↔store-meta
    cross-check (detect a snapshot whose blobs moved on) is not yet implemented
    at consumption sites — hardening backlog **H6**. Until it lands, treat
    "draft with baseRecording stamp" as *probably* matching `rvnLastRecording`.
  - Blobs are written **only at stop** — a feature that persists mid-recording
    audio breaks the discard-restore invariant (I10) and needs an ADR.
  - Keep the snapshot JSON-safe and small; `parseCurrentTake` drops anything
    malformed — additive fields must be optional.

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

---

## How to extend this registry

When a feature introduces a genuinely new seam, add a `## <Seam> — v1` section here.
When an existing seam's contract changes (new required sync point, new gotcha discovered),
bump its version in the heading and add a one-line note of what changed.
