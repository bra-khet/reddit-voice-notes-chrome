# Bug Archive — Reddit Voice Notes

Structured record of confirmed bugs, mitigations, and deferred architectural fixes.
Read this before changing the recording cap, binary transport, or FFmpeg pipeline.

---

## BUG-001 — Cap-stop transcode hang / permanent failure (2026-06)

### Symptoms

- Recordings under ~2:30 transcode in ~1 minute and work reliably.
- Recordings run to the auto-stop cap (~3:00) hang for many minutes, then fail or poison later attempts.
- After a bad cap run, even short recordings fail until the extension is reloaded.
- Console shows large payloads, e.g. `bytes: 14698030, base64Chars: 19597376` (~14.7 MB WebM → ~19.6 M base64 chars).

### Root causes (confirmed)

1. **Payload size + base64 relay** — The pipeline sends the full WebM from content script → background → offscreen FFmpeg, then returns the full MP4 the same way. Each hop uses base64 strings. At ~15 MB raw WebM, expect ~20 M base64 chars outbound and a similar order of magnitude for the MP4 return. Peak memory holds multiple copies (encode buffer + JSON message + decode buffer).

2. **Canvas video bitrate** — `MediaRecorder` uses `videoBitsPerSecond: 2_500_000` plus `audioBitsPerSecond: 128_000` on a 640×360@24fps waveform track. Audio alone would be tiny; the **video track dominates file size** (~100+ KB/s observed). Three minutes of waveform video is far heavier than three minutes of audio would be.

3. **Cap auto-stop WebM integrity** — Stopping via `setTimeout` at the recording cap races with MediaRecorder's 1s `timeslice`. The final chunk can be truncated or malformed. FFmpeg then hangs or exits 1 on all strategies. See `claude-progress.md` (cap transcode hang history).

4. **Per-strategy timeout scaled with file size (fixed 2026-06)** — Early hardening used `45s + 20s×MB`, which allowed **~345s per strategy** on a 15 MB file. A hung `ffmpeg.exec()` on corrupt cap WebM blocked the UI for ~6 minutes *per strategy* before failing over.

5. **Poisoned FFmpeg singleton (fixed 2026-06)** — `disposeFfmpeg()` was not called after failures; the offscreen WASM worker stayed corrupted until extension reload.

### Evidence

| Recording length | WebM bytes (observed) | Transcode outcome |
|------------------|----------------------|-------------------|
| ~2:20 (manual stop) | 14,698,030 | Success in ~1 min |
| ~3:00 (cap stop) | ~15,000,000+ | Hang / fail; breaks subsequent jobs |

Size alone does not explain the gap (similar MB). **Cap-stop corruption + long strategy timeouts + worker poisoning** explain it.

### Mitigation (2026-06, `pretty` branch)

- **Recording cap reduced to 2:00** — `DISPLAY_MAX_RECORDING_SECONDS = 120`, enforced at 120s (true 2:00/2:00; the old 2s underflow was for Reddit's 3:00 upload check). Sacrifices Reddit's nominal 3:00 headroom for pipeline stability.
- **Strategy timeout capped at 90s** — `ffmpeg-runner.ts` `STRATEGY_TIMEOUT_MAX_MS`.
- **FFmpeg worker lifecycle** — `disposeFfmpeg()` on failure/timeout; offscreen job queue; per-strategy timeouts.
- **Theme assets** — `assets/backgrounds/*` added to `web_accessible_resources`.

### Deferred architectural rework (do not forget)

To restore a 3:00 cap safely:

1. **Chunked binary transport** — Avoid single `runtime.sendMessage` blobs; use `chrome.runtime.sendMessage` chunks or `postMessage` to offscreen with `ArrayBuffer` transfers where possible.
2. **Lower waveform video cost** — Reduce `RECORDER_VIDEO_BPS`, fps, or resolution for long recordings; or audio-only WebM with static poster frame for Reddit.
3. **Cap-stop hardening** — Guaranteed MediaRecorder flush before cap stop; validate WebM cluster integrity before sending to FFmpeg.
4. **MP4 return path** — Stream or chunk MP4 back; avoid holding WebM + MP4 base64 simultaneously in the content script.
5. **Optional: terminate offscreen document** after each job to guarantee clean WASM state.

### Related files

- `src/utils/constants.ts` — cap seconds
- `src/recorder/voice-recorder.ts` — MediaRecorder, cap stop
- `src/messaging/binary.ts` — base64 encode/decode
- `src/ffmpeg/ffmpeg-runner.ts` — WASM transcode, timeouts
- `entrypoints/offscreen/main.ts` — job queue
- `entrypoints/background.ts` — message relay

---

## BUG-002 — Intermittent `ArrayBuffer is already detached` (2026-06)

### Symptoms

- Cap-stop transcode sometimes fails with: `Failed to execute 'postMessage' on 'Worker': ArrayBuffer at index 0 is already detached.`
- Other cap runs on the same build succeed; behavior is intermittent.

### Root cause (confirmed)

`@ffmpeg/ffmpeg` `writeFile()` **transfers** the underlying `ArrayBuffer` to the WASM worker (zero-copy). Our fallback transcode loop reuses the same `Uint8Array` for up to five strategies — the first `writeFile` detaches the buffer; the second strategy's `writeFile` throws.

Secondary race: calling `disposeFfmpeg()` / `terminate()` on strategy timeout while `ffmpeg.exec()` is still settling can surface the same error unless the exec promise is ignored after timeout.

### Fix (2026-06)

- `writeInputWebm()` passes `inputBytes.slice()` (fresh buffer per strategy).
- `runWebmToMp4()` and offscreen unpack use `.slice()` so relay buffers are never aliased.
- `execWithTimeout()` uses a `settled` guard so late exec rejections after timeout/terminate are ignored.

### Why the pipeline feels fragile

Several **independent sharp edges** stack non-linearly:

| Layer | Fragility |
|-------|-----------|
| MediaRecorder cap stop | 1s timeslice race → occasional corrupt WebM |
| FFmpeg WASM | Single worker, virtual FS, buffer transfer semantics |
| chrome.runtime messaging | Full-file base64, size limits, no streaming |
| MV3 service worker | Can sleep; needs keep-alive during transcode |
| Dev HMR | Content script reinjection mid-job duplicates console noise |

Failures are intermittent because **cap-stop chunk integrity and buffer lifetime are timing-dependent**, not deterministic. Reducing cap to 2:00 and fixing buffer copies removes two major edges; the rest need architectural rework (BUG-001 deferred items).

### Related files

- `src/ffmpeg/ffmpeg-runner.ts` — `writeInputWebm`, `execWithTimeout`
- `entrypoints/offscreen/main.ts` — unpack `.slice()`

---

## BUG-003 — Client timeout on healthy jobs / stall false positives (2026-06)

### Symptoms

- ~1 minute (~2.3 MB) recordings sometimes hit client timeout while cap-stop and short clips work.
- Console shows multiple `Sending WebM for transcode` lines with **different jobIds** (sequential recordings, not one job duplicated).
- UI sits on "Converting…" until stall/timeout despite FFmpeg eventually succeeding on retry.

### Root causes (confirmed)

1. **Fixed wall-clock client timeout** started at `sendMessage`, not when progress moved — slow WASM cold start or offscreen queue wait consumed the budget before transcode began.
2. **Five sequential FFmpeg strategies** — each failure/timeout opened another stall window (up to 75–90s each).
3. **No progress heartbeat** — offscreen sent nothing while FFmpeg loaded WASM, so the content script assumed a stall.
4. **Overlapping transcode timers** — back-to-back recordings could overlap client timers before offscreen queue drained (mitigated with `transcode-lock.ts`).

### Fix (2026-06)

Explicit pipeline checks at every hop (no heuristics):

| Stage | Explicit check |
|-------|----------------|
| Content script | `validateWebmRecording()` (browser video metadata) |
| Content pack | `verifyWebmPackedBinary()` (base64 shape + EBML magic) |
| Background relay | `validateTranscodeStartRequest()` + immediate ACK |
| Offscreen unpack | `assertWebmBytes()` |
| FFmpeg output | `assertMp4Bytes()` (ftyp box) + `verifyMp4PackedBinary()` |
| Content receive | `verifyMp4PackedBinary()` before Blob |

**Stall detection:** content script fails only after **45s without any progress message** (including offscreen heartbeats every 8s). Absolute ceiling 6 minutes.

**Fewer strategies:** `h264-aac` then `faststart` only; one offscreen job retry with worker dispose + 400ms settle.

### Related files

- `src/messaging/binary-verify.ts` — explicit payload validators
- `src/ffmpeg/transcoder.ts` — stall-based timeout
- `src/ffmpeg/transcode-lock.ts` — one transcode per tab
- `src/ffmpeg/webm-preflight.ts` — browser-side WebM check
- `entrypoints/background.ts` — validate + ack before async dispatch
- `entrypoints/offscreen/main.ts` — heartbeat + job retry

---

## BUG-004 — WebM preflight rejects valid MediaRecorder blobs (2026-06)

### Symptoms

- Clicking Stop crashes the recorder popup with `Uncaught (in promise) Error: Recording has no playable duration`.
- Happens immediately after stop, before transcode begins.

### Root cause (confirmed)

1. **Chrome reports `video.duration === Infinity`** for MediaRecorder WebM blobs that lack a Duration EBML element — this is normal, not corruption; FFmpeg transcodes them fine.
2. `validateWebmRecording()` used `!Number.isFinite(video.duration)` which rejects `Infinity`.
3. **`stopRecording()` did not catch** preflight errors — only `transcodeToMp4()` had `setError` handling.

### Fix (2026-06)

- Accept `Infinity` duration when metadata loads without `onerror`.
- Brief `durationchange` wait for transient `NaN` right after stop.
- Wrap preflight + transcode in `stopRecording` try/catch → `setError`.

### Related files

- `src/ffmpeg/webm-preflight.ts`
- `src/recorder/voice-recorder.ts`

---

## BUG-005 — Orphan transcode jobs / double send / progress flicker (2026-06)

### Symptoms

- Console shows two `Sending WebM for transcode` lines with **different jobIds and byte sizes** from what felt like one recording.
- Progress pegs at **20%** for long stretches; brief flicker to **~35%** then back to 20%.
- Second (smaller) job sometimes succeeds while the first appears hung; long waits before completion.

### Root causes (confirmed)

1. **Not a duplicate relay of one blob** — byte sizes differ (e.g. 1.57 MB then 407 KB) = two separate `stopRecording` → transcode chains.
2. **Orphaned async `stopRecording`** — `openRecorderPanel()` / `RecorderPanel.open()` calls `dispose()` on the old session but does not abort in-flight preflight/transcode. The old session object keeps running and enqueues job 1 while a new session enqueues job 2.
3. **`transcode-lock` serializes jobs** — job 2 waits behind job 1 in the content script; UI may be bound to job 2 while job 1 blocks the lock → multi-minute waits.
4. **20% peg is expected FFmpeg mapping** — transcoding stage reports `0.2 + ratio * 0.75`; WASM often stays at 0.2 until `progress` events fire. **35%** ≈ brief `progress` (~0.2) before strategy retry resets to 20%.

### Fix (2026-06)

- `sessionEpoch` + supersede checks: skip transcode if panel disposed/reopened during preflight.
- `AbortController` on client transcode: `dispose()` / `cancel()` release lock and listeners immediately.
- Enter `processing` phase **before** WebM preflight (UI cannot re-stop during validate).
- Monotonic progress reporting (never regress 35% → 20% in UI).

### Related files

- `src/recorder/voice-recorder.ts` — session epoch, abort, early processing phase
- `src/ffmpeg/transcoder.ts` — AbortSignal, monotonic progress
- `src/ui/recorder-panel.ts` — dispose aborts via session.dispose()

---

## BUG-006 — Infinite transcode hang (heartbeats mask stall) (2026-06)

### Symptoms

- ~1 minute recordings sometimes finish in ~3s, sometimes hang indefinitely until manual cancel.
- UI pegs at ~20% converting; no client timeout even past 90s.
- Console shows normal `Sending WebM for transcode` / preflight logs; no obvious error.

### Root causes (confirmed)

1. **Heartbeats counted as progress** — Offscreen emits `*-heartbeat` progress every 8s. Content script reset its 45s stall timer on *any* progress message, so a hung `ffmpeg.exec()` or `loadFfmpeg()` never tripped client stall detection.
2. **Client abort did not stop offscreen** — BUG-005 aborted the content listener and released `transcode-lock`, but FFmpeg kept running in the offscreen queue, blocking subsequent jobs.
3. **`loadFfmpeg()` had no timeout** — A stuck WASM fetch/load could heartbeat forever without reaching `execWithTimeout`.
4. **Absolute client ceiling was 6 minutes** — Too long for user-facing failure on a ~2 MB clip.

### Fix (2026-06)

- Stall timer resets only on **meaningful** progress (ratio increase or non-heartbeat stage change).
- `MSG_TRANSCODE_CANCEL` propagates client/background cancel → offscreen `disposeFfmpeg()` + queue skip.
- Background **supersedes** prior tab job when a new transcode starts.
- Offscreen **90s wall-clock** per attempt; `loadFfmpeg` **30s** timeout.
- Client absolute max reduced to **90s**.

### Design lesson

Heartbeats were **syntactic** health checks. Project rule going forward: **semantic health checking** — see `docs/engineering-principles.md`.

### Related files

- `src/ffmpeg/transcoder.ts` — meaningful stall detection, cancel on fail/abort
- `src/ffmpeg/transcode-cancel.ts` — offscreen cancellation registry
- `entrypoints/offscreen/main.ts` — wall-clock timeout, cancel handling
- `entrypoints/background.ts` — cancel relay, tab supersede
- `src/ffmpeg/ffmpeg-runner.ts` — load timeout