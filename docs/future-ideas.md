# Future Ideas

A running log of low-priority, unimplemented ideas with enough context to pick them up later.

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
