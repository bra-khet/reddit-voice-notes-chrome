# Future Ideas

A running log of low-priority, unimplemented ideas with enough context to pick them up later.

---

## Preferences Import — merge / union mode (post-v5.11)

**Priority:** Low / UX enhancement  
**Effort:** Small–Medium  
**Status:** Raised in v5.11.0 real-browser QA (2026-07-13) · **not a defect** · full-replace Import remains correct for v5.11

### What it is

Today Design Studio **Import JSON** is an explicit **full replace**: after confirmation, the imported snapshot becomes the entire preference truth (profiles, custom styles, globals). That matches backup/restore and was QA-verified.

A user may also want **merge / union**: keep existing profiles and custom styles whose IDs/names are not present in the import file, and only add/overwrite those that are. Useful when sharing a “profile pack” without wiping personal styles.

### Sketch (if ever scheduled)

- Add a strategy parameter on `importUserPreferencesFromJSON` (e.g. `'replace' | 'merge'`) **or** a separate **Merge Import** control next to **Import JSON**.
- Merge must still: validate the versioned envelope, normalize through the same path as migration, run under `enqueuePrefsOp`, and respect profile/style caps (12+12).
- Define conflict rules: same id → import wins; same display name different id → keep both or rename — pick one rule and document it.
- Confirmation copy must distinguish “Replace all…” vs “Merge into existing…”.

### Non-goals for this idea alone

- No cloud sync, no multi-device merge CRDT, no schema redesign.
- Do not change the default Export envelope or the replace path without a product decision.

### Context

- Shipped contract: [`docs/v5.11.0-prefs-storage-refactor.md`](v5.11.0-prefs-storage-refactor.md) §5  
- QA note: `.ignore/QA-5.11.0/qa-checklist.md` §9

---

## Chronos Indicator — Live FFmpeg Timecode During Export

**Priority:** Low / future  
**Effort:** Medium  
**Status:** Design only — nothing implemented

### What it is

Instead of showing a coarse percentage ("Converting to MP4… 43%"), show where in the recording the encoder has reached — e.g. `0:42 / 1:47` — so the user gets a time-domain sense of progress rather than an abstract ratio.

---

### Available signals

`@ffmpeg/ffmpeg` fires two event types on the `FFmpeg` instance during `exec()`:

- **`log`** — each line of FFmpeg stderr (currently consumed in `ffmpeg-runner.ts` via `attachLogCollector` for dup-storm detection).
- **`progress`** — `{ progress: number; time: number }` fired per-frame during encode.
  - `progress`: 0–1 ratio of estimated completion (already surfaced as the coarse bar).
  - `time`: current output timestamp in **microseconds** (divide by 1,000,000 for seconds). This is the unique signal — it gives the timecode position within the recording that FFmpeg has encoded up to.

The `time` field is available right now. The current handler in `transcodeWithStrategies` (`ffmpeg-runner.ts:466`) explicitly discards it:

```ts
// current — time thrown away
const progressHandler = onFfmpegRatio
  ? ({ progress }: { progress: number }) => onFfmpegRatio(progress)
  : null;
```

The recording's total duration is known at stop time (`RecorderState.elapsedSeconds`) but is not currently forwarded to the offscreen or included in progress messages. Without it you can only show the numerator (`0:42`); with it you can show `0:42 / 1:47`.

For the burn-in pass (`runSubtitleBurnIn`), the same `progress` event fires on the same FFmpeg instance, so the same approach applies — the denominator there would be the clip length already known from the base MP4.

---

### Where the indicator would live

The recording panel's processing area in `recorder-panel.ts`. During the `'processing'` phase, the template renders:

```html
<!-- existing coarse bar -->
<div class="progress" data-progress hidden>
  <div class="progress__bar" data-progress-bar></div>
</div>
```

And the status text is currently:

```ts
// recorder-panel.ts ~line 807
this.statusEl.textContent = `Converting to MP4… ${state.processingProgress}%`;
```

A Chronos indicator would add a timecode label alongside or beneath this — e.g.:

```
Converting to MP4…   0:42 / 1:47
[====================          ]
```

No new DOM container is strictly required; the existing `[data-progress]` bar could remain, with the text readout appended to `statusEl` or placed in a dedicated `[data-chronos]` span next to it.

---

### Message-relay path

FFmpeg runs inside the offscreen document (a service worker context). Progress must travel four hops to reach the recording panel DOM:

```
offscreen/main.ts (FFmpeg instance)
  → ffmpeg.on('progress', { progress, time })
  ↓
  broadcastProgress(jobId, ratio, stage)          [currently: time discarded here]
  ↓ chrome.runtime.sendMessage (MSG_TRANSCODE_PROGRESS)
background.ts
  → relays to all tabs
  ↓ chrome.tabs.sendMessage
content script (transcoder.ts)
  → onBroadcast listener → onProgress(ratio)      [currently: time also discarded here]
  ↓
voice-recorder.ts → RecorderState.processingProgress
  ↓
recorder-panel.ts → DOM update
```

Every hop already exists and is exercised for the coarse ratio. Adding `time` is a data-threading exercise at each layer:

1. **`ffmpeg-runner.ts`** — change the `onFfmpegRatio` callback type (or add a parallel `onFfmpegTime` callback) to also carry `timeUs: number` from the `ProgressEvent`.
2. **`messaging/types.ts`** — add `timeUs?: number` to `TranscodeProgressMessage` (one-liner; mirrors how `stage?` was added).
3. **`offscreen/main.ts`** — pass `timeUs` through `broadcastProgress`.
4. **`transcoder.ts`** — extract `timeUs` from the broadcast and forward it to the caller.
5. **`voice-recorder.ts`** — store `processingTimeUs` in `RecorderState`, alongside `processingProgress`.
6. **`recorder-panel.ts`** — format and render the timecode. For the denominator, pass `recordingDurationSeconds` (known at stop time from `elapsedSeconds`) in `TranscodeStartRequest` so the offscreen can echo it back in progress messages, or derive it locally from `RecorderState.elapsedSeconds`.

---

### Effort estimate — Medium

**Why not Easy:** While the relay plumbing is templated (the `burnin` and `transcribe` message families were added by copying the transcode pattern), threading a new field through six files in a race-prone, multi-hop message pipeline has non-trivial surface area. `TranscodeProgressMessage` is consumed in `transcoder.ts` by a live `browser.runtime.onMessage` listener; any type change must be matched at both ends atomically. The denominator question (passing `recordingDurationSeconds` through `TranscodeStartRequest` → offscreen → progress messages back) adds one more file to the change set.

**Why not Hard:** No new architecture required. The signal exists. The relay exists. No WASM changes. No new message family. The UI slot is already there (`statusEl`, existing progress bar). The total diff would be ~40–60 lines across 6 files, with no side effects on the transcode success/failure paths. The burn-in indicator would follow automatically once the transcode path is wired.

**Gotcha to remember:** WebM recordings from Chrome often have `Duration: N/A` in FFmpeg's probe output, so FFmpeg's own `progress` ratio can be unreliable or jump. `time` (the output timecode) is more trustworthy as a chronometer — it advances monotonically as frames are encoded regardless of container duration metadata. Using `elapsedSeconds` from `RecorderState` as the denominator sidesteps this entirely.

---

## Voice Character Profile Studio — Static Hosted Companion Page

**Priority:** Medium / future
**Effort:** Large (separate deliverable, outside the extension bundle)
**Status:** Design only — depends on the Clipboard Voice Character Backup MVP (`docs/v5.1.1-QOL-charactercopypaste.md`) shipping first.

### What it is

The **Clipboard Voice Character Backup** feature is the bootstrap for something larger: a **standalone static webpage** (GitHub Pages or equivalent), hosted **separate from the extension itself**, where users can visit to **further test and refine their voice character profiles** away from the in-extension Voice panel.

Because the extension already serializes a voice character config to the clipboard as versioned JSON, that same payload becomes the interchange format with the web page:

- **Extension → Page:** copy a voice character in the Studio Voice panel, paste it into the page to load it.
- **Page → Extension:** refine/preview on the page, copy the result, paste it back into the Voice panel via the existing paste path.

The page is a richer scratch space (multiple slots, side-by-side compares, sliders, sharable links) that would be heavy to build inside the extension popup, but is natural as a static site.

### Hard requirement — schema parity / migratability

The clipboard JSON schema designed for the MVP is the contract between the extension and this future page. Therefore:

- The MVP **must** use a discriminator + version (`type` + version, e.g. `rvn-voice-character-v1` / `rvn-profile-v1`) so the page can validate and migrate payloads safely.
- The web page **must** follow the **same schema** or stay **migratable** from it — never a divergent format. Any schema change ships a version bump and a migration shim on both sides.
- Keep the serialized voice config **graph-native** (the `StylizedGraph` world — see `project_voice_resolve_worlds`), never legacy flat fields, so the page and extension share one canonical voice representation.

### Why it's deferred

It's an entirely separate hosting + build target with no impact on the extension MVP beyond the schema-stability commitment above. The MVP delivers value alone; this page is the "Phase 2" evolution noted in the clipboard plan's *Future Evolution* (file export/import, named slots).

---

## Subtitle Canvas — Text Gradient & Wave Animation (user-facing tunables)

**Priority:** Low / future polish  
**Effort:** Small–Medium (UI + persistence; renderer hooks already exist)  
**Status:** Partial — v5.3.4 Phase 3.5.3/3.5.3b shipped canvas-only; DEV toggles only

### What shipped (v5.3.4)

Opinionated vertical text fill gradient and optional downward “wave” sweep on the **canvas overlay** path (`subtitle-overlay-renderer.ts`). Drawtext bake/preview stay flat fill.

### Variables worth exposing to users later

| Name | Location | Role | Current default |
|------|----------|------|-----------------|
| `textGradient` | `SubtitleStyleConfig` | Master on/off for vertical gradient fill | `true` |
| `textGradientWave` | `SubtitleStyleConfig` | Enables per-frame highlight sweep | `false` |
| `CANVAS_TEXT_GRADIENT_WAVE_CYCLE_SECONDS` | `subtitle-effects.ts` | Full sweep period (seconds) | `3.5` |
| `CANVAS_TEXT_GRADIENT_WAVE_BAND_HALF` | `subtitle-effects.ts` | Highlight band half-width (0–1 along glyph height) | `0.18` |
| `resolveCanvasTextGradientStops()` | `subtitle-effects.ts` | Static top/bottom hex derivation from caption color | opinionated preset |
| `canvasTextGradientWavePhase()` | `subtitle-effects.ts` | Maps `timestampSeconds` → 0–1 wave phase | derived from cycle constant |

### Future UI ideas (out of scope for v5.3.4)

- Slider for **wave speed** (replaces or overrides `CANVAS_TEXT_GRADIENT_WAVE_CYCLE_SECONDS`).
- Slider for **band width** (`CANVAS_TEXT_GRADIENT_WAVE_BAND_HALF`).
- Per–text-color gradient presets (white/black/theme/special stop tables).
- Horizontal or diagonal sweep modes; multi-stop custom gradients; easing curves.
- Optional sync wave phase to clip timeline vs wall-clock encode time.
- Preview parity: live canvas preview in Design Studio (today: overlay render harness only).

---

## Subtitle Canvas — Glow Hue Rotation Modes (user-facing tunables)

**Priority:** Medium / future polish  
**Effort:** Small–Medium per mode (core rainbow + monochromatic ship in v5.3.4 Phase 3.5.5)  
**Status:** Partial — rainbow + monochromatic modes; additional modes deferred

### What ships (v5.3.4 Phase 3.5.5)

Per-frame animated glow color on canvas overlay when **Glow color = Hue rotate** (`colorSource: 'rainbow'`). Smooth at full overlay FPS (not stepped bake).

### Variables worth exposing to users later

| Name | Location | Role | Current default |
|------|----------|------|-----------------|
| `glow.colorSource` | `SubtitleGlowConfig` | `'rainbow'` enables animated glow (canvas only) | `'theme'` |
| `glow.hueRotateMode` | `SubtitleGlowConfig` | Rotation algorithm — see modes below | `'rainbow'` |
| `glow.hueRotateSpeed` | `SubtitleGlowConfig` | Degrees per second | `45` (~8s full wheel) |
| `resolveCanvasOverlayGlowHex()` | `subtitle-effects.ts` | Per-frame glow hex from style + `timestampSeconds` | — |

### Rotation modes

| Mode | Status | Behavior |
|------|--------|----------|
| `rainbow` | **Shipped** | Full 0–360° hue wheel at `hueRotateSpeed` |
| `monochromatic` | **Shipped** | Theme-bar hue family; oscillating S/V around `resolveGlowColorHex('theme', …)` |
| `linear` | Deferred | Linear RGB channel sweep (not hue wheel) |
| `hsv-inverse` | Deferred | Complementary / inverted HSV path (180° flip or inv-V) |
| `rgb-rotate` | Deferred | Cyclic permutation of R/G/B channels |

### Future UI ideas (out of scope for v5.3.4)

- **Hue rotate speed** slider (maps to `hueRotateSpeed`).
- Monochromatic **base anchor** selector (theme vs special vs text color).
- Phase offset / direction (reverse sweep).
- Apply rotation to dual-border outer ring only vs halo only.
- Drawtext fallback approximation (stepped hue tiers) — likely never; canvas-first.

---

## Smart Adjust — Transcript Editor UX (v5.3.6 Phase 1 QA)

**Priority:** Medium — after bake-fit threshold QA passes  
**Effort:** Medium–Large (UI/UX)  
**Status:** Core logic shipped; presentation deferred

### Shipped (functionality)

- Mode A: per-cue word shift, global font −1px.
- Mode B: full re-splice from Vosk original (promoted as **Auto-fix / Recommended**).
- Fit status + Validate all cues + two-tier real-canvas measurement.

### QA notes (2026-07) — **PASS** (logic)

- Logic and proposal quality are good; primary gap is **visual sophistication** — users need before/after preview, inline diff, or timeline context to trust multi-cue proposals.
- **Recommended proposal highlight:** amber `Recommended` tag + primary **Auto-fix** button on full re-splice (shipped). Future: extend to best Mode A pick when heuristics can rank word-shift vs font tweak reliably.
- **Default path for new users:** full re-splice from original transcript — lowest friction, most reliable; keep visually dominant until a richer UI exists.
- **Toolbar affordance (shipped):** when any cue shows ⚠ LONG, **Smart Adjust…** button in the transcript editor gains amber pulse + hint (“try Auto-fix inside Smart Adjust”).

### Future directions

- Side-by-side or overlay preview of measurement / backdrop bounds per cue.
- Visual cue map showing which segments overflow vs near-edge vs comfortable.
- Rank proposals (re-splice > word-shift > font) with amber recommended state on the top pick only.
- Integrate Smart Adjust into a unified “subtitle health” panel rather than a stacked modal.

See also: `docs/5.3.6-5.3.9-integrated-roadmap.md` Phase 1.

---

## Canvas Subtitle Bake — Performance (v5.3.4 QA)

**Priority:** Medium — revisit after v5.3.5 ships  
**Effort:** Large (pipeline / architecture)  
**Status:** v5.3.5 cue cache shipped (render paint deduped); **total bake** and **pacing floor** still open

### Observed (2026-07 stress tests + Overlay Lab timing logs)

Sources: `.ignore/5.3.4-perfCheck-QA-usernotes.md`, `.ignore/sub-QA-harness-logs/`.

Full canvas bake wall time scales with clip length; **prepare overlay** (VP8A normalize) dominates total time on long / heavy clips:

| Clip | Cues | Render | Prepare overlay (VP8A normalize) | Composite | Total |
|------|------|--------|-----------------------------------|-----------|-------|
| 120s | 15–40 | ~120s | ~210–240s | ~30–45s | ~6–6.5 min |
| 120s | 121 + rich effects | ~120s | ~330s | ~50s | ~8+ min |
| 60s | 20 | ~65s | ~120–165s | ~20s | ~3.5 min |
| 62s | 534 + rich effects (lab bake) | 75.9s (27%) | **184.1s (64%)** | 24.8s (9%) | **285.8s (~4.8 min)** |

Render-only lab runs: ~1.0–1.3× realtime vs clip duration; cue count is secondary (62s clip: 68s @ 21 cues vs 80s @ 534 cues). Per-frame paint ~41 ms @ 30 fps with rich effects. Rich effects inflate **normalize** more than render (120s clip: normalize 210s → 330s when adding 121 cues + gradient wave + dual border while render stays ~120s).

Analysis and driver matrix: `docs/v5.3.4-subtitle-canvas-overlay.md` § Performance QA.

### Current mitigations (v5.3.4–v5.3.5)

- Chronos meter + stage labels during bake.
- User-facing hint: longer clips / rich effects may take several minutes.
- `FINALIZE_TIMEOUT_MS` = 6 min (`overlay-webm-finalize.ts`).
- Canvas render perf guard: 2.5–3 min budget → drawtext fallback (render phase only).
- **v5.3.5:** Cue-stable `ImageBitmap` cache — 99% hit rate on sparse static cues; flattens cue-count scaling when LRU not saturated. Does **not** beat MediaRecorder ~1× realtime pacing floor on typical clips. See `docs/5.3.5-cue-stable-overlay-caching-design.md` §5.

### Future directions (v5.3.6+)

- Skip or fast-path alpha normalize when MediaRecorder blob is already composite-safe.
- Lower overlay fps or adaptive fps for long clips.
- Worker / OffscreenCanvas render + temporal chunking (`docs/5.3.9-worker-and-chunked-parallelization-design.md`).
- Raise LRU cap or per-cue cache shards for rich animated styles (64 entries thrashes in QA).
- Burst capture without per-frame `waitForNextCaptureTick` pacing.
- Parallel cue batches or incremental overlay segments.
- Hardware-accelerated encode outside wasm FFmpeg where MV3 permits.
- Progress chronos tied to FFmpeg `progress.time` during normalize/composite (see Chronos Indicator idea above).