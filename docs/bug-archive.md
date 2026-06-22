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

---

## BUG-007 — FFmpeg frame duplication storm on bad WebM timestamps (2026-06)

### Symptoms

- Same-length recordings sometimes transcode in ~10s, sometimes hang or crawl at `speed` ~0.2× until client/offscreen timeout.
- FFmpeg logs show `dup` climbing with frame count (e.g. `dup=984` at frame 1006) and **"More than 1000 frames duplicated"**.
- Input probe reports `vp8 … **1k tbr, 1k tbn**`, often `Duration: N/A`.
- Output stream shows **~1000 fps** instead of ~24 fps.

### Root causes (confirmed via offscreen logs, 2026-06-21)

1. **Broken/missing video PTS in MediaRecorder WebM** — `canvas.captureStream(24)` + `MediaRecorder` can emit WebM where FFmpeg infers a bogus **1000 fps** timebase (`1k tbr`).
2. **No timestamp normalization in encode strategy** — `h264-aac` in `ffmpeg-runner.ts` passes through with no `-r`, `-fps_mode`, `-vsync`, or PTS repair.
3. **CFR sync duplicates frames** — FFmpeg stretches sparse real frames across the bogus timeline → thousands of libx264 encodes in WASM (`threads=1`).
4. **Preflight does not catch it** — `webm-preflight.ts` treats `Duration: N/A` / `Infinity` as normal Chrome behavior (BUG-004); no check for `1k tbr` or dup-prone metadata.

### Healthy baseline (for comparison)

- Input `~22 tbr`; output `~22 fps`; `dup` single digits; `speed` 4–5×; ~44s clip → ~10s transcode.

### Likely triggers

- Reddit tab **backgrounded** — `requestAnimationFrame` stalls; bursty/sparse canvas frame timestamps.
- **Cap-stop races** — see BUG-001; truncated final chunks may worsen timestamp gaps.
- Stop/`requestData` timing edge cases.

### Fix (2026-06-21, pretty-9)

1. **Primary encode** (`h264-aac`): `-fflags +genpts+igndts`, `-fps_mode passthrough`, `-r 24` — avoids CFR dup to bogus 1k fps timeline.
2. **Fallback encode** (`h264-aac-fps`): `-vf fps=24` when passthrough strategy still dup-storms.
3. **Early abort**: log watcher sets dup-storm flag when `dup≥100`, dup/frame ≥ 0.5, or “More than N frames duplicated”; strategy aborts in ~200ms and retries next strategy instead of hanging at 75s.
4. **Remux fallback** (`faststart`) unchanged as last resort.

### Related files

- `src/ffmpeg/ffmpeg-runner.ts` — `TRANSCODE_STRATEGIES`, log collector
- `src/ffmpeg/webm-preflight.ts` — duration/size checks only today
- `src/recorder/voice-recorder.ts` — `captureStream(WAVEFORM_TARGET_FPS)`, MediaRecorder stop
- `pretty-branch.md` — pretty-9 diagnosis section

---

## BUG-008 — Settings popup blank after dulcet-4 (2026-06)

### Symptoms

- Extension settings popup opens as an empty ~10px-tall box (correct width, no content).
- Brief hang before render; no UI from `entrypoints/popup/main.ts`.

### Root cause (confirmed)

**Circular ESM import:** `src/voice/types.ts` re-exported `resolve-config.ts`, which imports `types.ts` and `presets.ts` (which imports `types.ts`). Popup loads `clip-appearance-summary` → `voice-summary` / `clip-profiles` → `voice/types` → cycle → module init failure before `innerHTML` is set.

### Fix (2026-06, `dulcet`)

- Removed re-exports from `types.ts`.
- Consumers import `voiceEffectIsActive`, `voiceEffectConfigsEqual`, `scaleVoiceEffectByIntensity`, `resolveVoiceEffectConfig` from `resolve-config.ts` directly.
- Guard comment on `types.ts`; barrel `index.ts` documented as offscreen-only.

### Prevention

- Never re-export `resolve-config` from `types.ts`.
- Popup/settings UI: use direct paths (`voice-summary`, `resolve-config`, `types`) — not `@/src/voice` barrel (pulls `process-audio` → ffmpeg-runner).

### Related files

- `src/voice/types.ts`, `src/voice/resolve-config.ts`, `src/voice/index.ts`
- `src/ui/popup/clip-appearance-summary.ts`

---

## BUG-009 — Intensity slider dropped bundled voice preset (2026-06)

### Symptoms

- Moving intensity 1–10 switched voice preset dropdown to **Custom**.
- Preview/export sounded like pitch-only custom, not the selected preset (Robot, Deeper, etc.) at reduced strength.

### Root cause (confirmed)

`voice-controls.ts` intensity handler set `presetId: 'custom'` on every slider move (copied from pitch-knob behavior). Intensity is a modulation layer on the active preset, not a fork to Custom.

### Fix (2026-06, `dulcet`)

- Intensity handler keeps `presetId`; only updates `intensity` / `turbo`.
- Added `resolveVoiceEffectConfig()` — rebuilds bundled preset SFX from `presets.ts` + applies user `intensity`/`turbo`/`enabled` (mirrors visual preset + `designOverrides`).
- Export/preview: `resolveVoiceEffectConfig()` → `scaleVoiceEffectByIntensity()`.

### Related files

- `src/voice/resolve-config.ts`
- `src/ui/design-studio/voice-controls.ts`
- `src/voice/filter-graphs.ts`, `src/voice/preview-chain.ts`

---

## BUG-010 — Vosk sandbox blob worker blocked by CSP (2026-06)

### Symptoms

- Transcribe harness reaches decode (~10%) then fails; console shows repeated:
  `Creating a worker from 'blob:null/…' violates the following Content Security Policy directive: "child-src 'self'". Note that 'worker-src' was not explicitly set, so 'child-src' is used as a fallback.`
- `transcribe-audio.ts`: `Vosk sandbox failed to become ready` or model load never completes.
- Error originates in bundled `vosk.js` `WorkerFactory` (vosk-browser).

### Root cause (confirmed)

1. **vosk-browser spawns Emscripten workers from blob URLs** — `createBase64WorkerFactory()` decodes embedded worker code into a `Blob`, calls `URL.createObjectURL(blob)`, then `new Worker(blobUrl)`. In a manifest sandbox iframe (opaque/null origin), the URL is `blob:null/<uuid>`.
2. **Default sandbox CSP only allows `child-src 'self'`** — Chrome falls back to `child-src` when `worker-src` is omitted. Blob workers are **not** `'self'` extension scripts; they are blocked even though `'unsafe-eval'` is present for the main thread.
3. **Distinct from prior eloquent-0 CSP failures** — BUG-010 is the *third* layer after (a) extension_pages `unsafe-eval` forbidden → manifest sandbox, and (b) WXT dev HMR localhost CORS on null-origin sandbox → static `public/vosk-sandbox.*`. Each layer must be solved independently; see `docs/transcription-architecture.md`.

### Fix (2026-06, `eloquent`)

- `wxt.config.ts` sandbox CSP: add `worker-src blob: 'self'` and `child-src blob: 'self'`.
- Sandbox pages **can** relax CSP beyond extension_pages minimum; blob workers stay confined to the sandbox iframe (no `chrome.*` APIs).

### Design lesson (compare BUG-001–009)

| Prior bug class | What it taught | Transcription parallel |
|-----------------|----------------|------------------------|
| BUG-001/002 — base64 + buffer transfer | MV3 messaging and WASM buffer lifetime are sharp edges | PCM uses `postMessage` transferables (~8 MB for 2:00 mono), not base64 |
| BUG-003/006 — heartbeats vs semantic progress | Stall detection must track real work | Vosk progress stages: loading-model → inference → finalizing |
| Personal-bg relay — Reddit **page** CSP | `createImageBitmap` / blob URLs on reddit.com | **Extension** CSP eval — needs manifest sandbox, not content-script relay |
| FFmpeg worker (BUG-002 adj.) | Dedicated worker + dispose on failure | Vosk internal worker inside sandbox only; separate `enqueueTranscribeJob` queue |

### Related files

- `wxt.config.ts` — `content_security_policy.sandbox`
- `public/vosk-sandbox.html`, `public/vosk-sandbox.js` — sandbox host
- `src/transcription/vosk-sandbox-client.ts`, `vosk-sandbox-host.ts`
- `docs/transcription-architecture.md`

---

## BUG-011 — Vosk IDBFS blocked in blob:null workers (2026-06)

### Symptoms

- After BUG-010 (`worker-src blob:`), console shows:
  `Failed to sync file system: SecurityError: Failed to execute 'open' on 'IDBFactory': access to the Indexed Database API is denied in this context.`
- Error originates in `blob:null/<uuid>` worker (vosk Emscripten `syncFilesystem` / IDBFS).
- Model load stalls or fails after decode progress (~10–12%).

### Root cause (confirmed)

1. **vosk-browser ships worker code as a blob URL** — `createBase64WorkerFactory()` → `blob:null/…` worker origin.
2. **Emscripten IDBFS caches unpacked models in IndexedDB** — `syncFilesystem()` calls `FS.syncfs()` against IDB on load/save.
3. **Blob-origin workers cannot open IndexedDB** in Chrome extension contexts (manifest sandbox and extension pages). This is separate from BUG-010 (CSP allowed creating the worker; storage is still denied by origin).
4. **Manifest sandbox parent also lacks durable storage** — even main-thread IDB in opaque sandbox is unreliable; worker must run as packaged `'self'` script (`chrome-extension://…`) for IDBFS.

### Fix (2026-06, `eloquent`) — superseded by BUG-013

Packaged `chrome-extension://` workers **cannot be constructed from null-origin manifest sandbox** (see BUG-013). Extraction script removed; blob worker retained with non-fatal IDBFS sync.

### Design lesson

| Approach | eval (main) | Worker spawn from sandbox | IndexedDB cache |
|----------|-------------|---------------------------|-----------------|
| extension_pages (offscreen) | **Blocked** | N/A | N/A |
| sandbox + blob worker | Allowed | **Yes** (`worker-src blob:`) | **No** — sync skipped |
| sandbox + packaged worker | Allowed | **No** — origin null blocks `chrome-extension://` worker URL | Would work if spawn worked |

### Related files

- `scripts/build-vosk-sandbox.mjs` — `patchVoskEmbeddedWorker()`
- `docs/transcription-architecture.md`

---

## BUG-013 — Sandbox null-origin cannot spawn chrome-extension:// workers (2026-06)

### Symptoms

- After BUG-011 packaged-worker fix: `(void 0) is not a function` resolved, then:
  `Failed to construct 'Worker': Script at 'chrome-extension://…/vosk-emscripten-worker.js' cannot be accessed from origin 'null'.`
- Fails in ~500ms at model construction (same fallback empty transcript path as BUG-012).

### Root cause (confirmed)

Manifest **sandbox iframe = opaque/null origin**. It may load `chrome-extension://` scripts as **documents**, but **cannot construct `Worker(chrome-extension://…)`** from that context — cross-origin worker script access is blocked.

BUG-011 traded BUG-010 blob CSP for extension-origin IDBFS, but packaged workers are unreachable from sandbox. **No single worker URL satisfies both sandbox eval and extension IDB.**

### Fix (2026-06, `eloquent`)

- **Revert to vosk-browser `WorkerFactory()` blob workers** (requires BUG-010 `worker-src blob:`).
- **`patchVoskEmbeddedWorker()`** in `build-vosk-sandbox.mjs` — patch embedded worker so `syncFilesystem()` **logs and resolves** on IDBFS error instead of rejecting (model loads via `downloadAndExtract` into MEMFS each session; no persistent IDB cache in sandbox).
- Removed `public/vosk-emscripten-worker.js` extraction.

### Accepted tradeoff (eloquent-0 spike)

- First model load re-downloads/unpacks ~40 MB tar.gz per session (slower, more memory) until a future architecture moves inference to extension-origin offscreen with a different Vosk packaging strategy.

### Related files

- `scripts/build-vosk-sandbox.mjs`
- `wxt.config.ts` — sandbox `worker-src blob: 'self'`
- `docs/transcription-architecture.md`

---

## BUG-014 — Vosk worker invalid URL base in blob:null context (2026-06)

### Symptoms

- After BUG-013 blob worker restore: `TypeError: Failed to construct 'URL': Invalid base URL` in `blob:null/<uuid>` worker (~line 240).
- Sandbox posts error to harness; fallback empty transcript.

### Root cause (confirmed)

vosk-browser worker resolves model download URL as:

```js
new URL(modelUrl, location.href.replace(/^blob:/, ""))
```

In a blob worker, `location.href` is `blob:null/<uuid>`. Stripping `blob:` yields `null/<uuid>` — **not a valid base URL**. Chrome throws even when `modelUrl` is absolute `chrome-extension://…`.

### Fix (2026-06, `eloquent`)

- `patchVoskEmbeddedWorker()` — if `modelUrl` contains `://`, use `new URL(modelUrl)` only (no blob base).
- `normalizeAbsoluteExtensionUrl()` in `constants.ts` — parent validates `chrome-extension://` before `postMessage`.
- `vosk/*` remains in `web_accessible_resources` for worker fetch.

### Related files

- `scripts/build-vosk-sandbox.mjs`
- `src/transcription/constants.ts`, `vosk-sandbox-client.ts`
- `wxt.config.ts` — `web_accessible_resources`

---

## BUG-015 — Empty Vosk transcript despite successful model load (2026-06)

### Symptoms

- Harness: model extracts/loads (verbose VoskAPI logs), then `Done — 0 segment(s), 0 chars` in ~2–3s.
- `applied: true` path with empty `text` / `segments` — pipeline “succeeds” with no speech.
- Inference stage completes faster than audio duration suggests.

### Root causes (confirmed)

1. **Worker pacing race** — `acceptWaveformFloat()` only `postMessage`s chunks to the blob worker; eloquent-0 loop fed all chunks synchronously then immediately called `retrieveFinalResult()`. Final request could run **before** worker consumed audio → no `result` events.
2. **Fixed 300ms finalize timeout** — collected `segments` from streaming `result` events only; if final text arrived after timeout, transcript stayed empty.
3. **Silent success on empty text** — no error when Vosk returned zero speech; harness showed “Done” instead of failure.
4. **Possible PCM relay edge cases** — `postMessage` transfer + `AudioBuffer` views without copy; zero/silent PCM not validated before inference.

### Fix (2026-06, `eloquent`)

- `src/transcription/pcm-stats.ts` — `analyzePcm`, `assertPcmUsable`, `coerceFloat32Samples`, `formatPcmStats`.
- `decode-webm-audio.ts` — copy PCM to owned `Float32Array`; assert after decode.
- `vosk-sandbox-client.ts` — assert before transfer.
- `vosk-sandbox-host.ts` — coerce relayed samples; yield between chunks; drain worker (~35% realtime, capped); wait for post-`retrieveFinalResult` results; **fail** if still empty (include PCM summary in error).
- Progress stages now include PCM stats: `decode-done:…`, `pcm-received:…`, `inference-drain:…ms`.

### Related files

- `src/transcription/pcm-stats.ts`, `decode-webm-audio.ts`, `vosk-sandbox-host.ts`, `transcribe-audio.ts`
- `entrypoints/transcribe-harness/main.ts`

---

## BUG-012 — vosk-browser UMD import undefined under esbuild (2026-06)

### Symptoms

- Transcribe harness reaches decode (~10%) then fails in ~500ms with `(void 0) is not a function`.
- Sandbox posts `VOSK_SANDBOX_RESULT` with `ok: false`; harness shows fallback empty JSON (`text: ""`, `segments: []`).
- Built `public/vosk-sandbox.js` contains `modelPromise = (void 0)(modelUrl)` instead of `createModel(modelUrl)`.
- esbuild warning: `Import "createModel" will always be undefined because the file "vosk-browser/dist/vosk.js" has no exports`.

### Root cause (confirmed)

1. **vosk-browser ships UMD only** — no real ESM `export`; esbuild bundles the IIFE but does not wire named imports to the UMD `exports` object.
2. **`import { createModel } from 'vosk-browser'` compiles to `undefined(modelUrl)`** — classic CJS/ESM interop failure (compare BUG-008 circular imports: different failure mode, same “module init/export” class).
3. **Upstream `createModel()` is also buggy** — always calls `reject()` after `resolve()` on load success; we avoid it and use `new Model()` + explicit load wait.

### Fix (2026-06, `eloquent`)

- `scripts/build-vosk-sandbox.mjs` — `voskBrowserToEsm()` unwraps UMD to `export const Model` / `createModel`.
- `vosk-sandbox-host.ts` — `new Model(modelUrl)` + `waitForVoskModel()` instead of `createModel()`.

### Related files

- `scripts/build-vosk-sandbox.mjs`
- `src/transcription/vosk-sandbox-host.ts`
- `public/vosk-sandbox.js` (generated)

---

## BUG-016 — Subtitle prefs lost between Design Studio sessions (2026-06)

### Symptoms

- Subtitles toggle reverts to Off after closing and reopening Design Studio.

### Fix (`eloquent`, `3bf833d`)

- Persist `transcriptConfig` through normal prefs save paths on studio mount/unmount.

### Related files

- `src/ui/design-studio/subtitle-controls.ts`, `src/settings/user-preferences.ts`

---

## BUG-017 — Subtitle toggle reverts on studio exit / discard (2026-06)

### Symptoms

- Enabling subtitles, clicking Done or Discard, reopening studio → toggle Off.

### Root cause

- Exit modal discard reapplied profile snapshot including default `transcriptConfig`; async `chrome.storage.local.set` on tab close lost in-flight writes.

### Fix (`eloquent`, `22fc616` + `c997fa4` + `eaeba08`)

- `clipProfileMatchesLiveStateForStudioExit` excludes transcript from dirty match.
- `discardStudioUnsavedChanges` preserves live transcript prefs.
- Atomic `rvnSubtitlesEnabled` + localStorage mirror; `pagehide` flush.

### Related files

- `src/ui/design-studio/studio-exit.ts`, `src/settings/user-preferences.ts`, `src/ui/design-studio/subtitle-controls.ts`

---

## BUG-018 — Transcribe 120s timeout / empty segments (2026-06)

### Symptoms

- `timeout-120s`, 0 segments; transcode finishes first (expected).

### Root cause

- Offscreen called `transcribeWebmBlob` (harness wrapper) which re-enqueued on the same queue → deadlock.

### Fix (`eloquent`, `a61f3f1`)

- Offscreen uses `runTranscribeWebmBlob` (core) only.

### Related files

- `entrypoints/offscreen/main.ts`, `src/transcription/transcribe-audio.ts`

---

## BUG-019 — Subtitle flag lost in rvnUserPrefs read-modify-write races (2026-06)

### Symptoms

- Toggle flips Off when other prefs writes race (studio close, profile apply).

### Fix (`eloquent`, `c997fa4`)

- `rvnSubtitlesEnabled` atomic key; `mergeSubtitlesEnabledIntoPrefs` on every `writeUserPreferences`.

### Related files

- `src/settings/user-preferences.ts`

---

## BUG-020 — Stale session transcript respawns / profile always dirty (2026-06)

### Symptoms

- Cleared transcript refills from IDB; profile permanently “unsaved”; old text in editor.

### Fix (`eloquent`, `eaeba08`)

- Session transcript in extension IDB only; `transcriptConfigForProfileStorage` strips `result` from profile blobs; Clear transcript + dismissal watermark.

### Related files

- `src/storage/session-transcript-db.ts`, `src/ui/design-studio/subtitle-controls.ts`, `src/transcription/types.ts`

---

## BUG-021 — Profile UI regression after dirty-match fix (2026-06)

### Symptoms

- Saved profiles disappear from dropdown; UI stuck on Custom (unsaved); Clone hidden; HSV missing; Save as profile no-op.

### Root cause (confirmed partial)

- `flushPersist()` before profile saves fired storage listeners outside `ignoreStoragePrefs`.
- Subtitle init + coupled profile dirty refresh raced before prefs loaded.
- Legacy transcript compare always dirty (addressed in same commit but bundled with risky changes).

### Fix status

- **Reverted in BUG-022** except legacy `transcriptConfig: null` dirty skip.

### Related files

- `3dcd917` — commit to avoid re-applying wholesale

---

## BUG-022 — Profile style not applied on select (2026-06)

### Symptoms

- Profile names visible but bar style / HSV / clip style select wrong after selecting profile.

### Root cause

- `applyClipProfile` used `profile.themeId` instead of linked style `baseThemeId`; color picker skipped sync during interaction; `mergePendingColorState` stomped profile appearance.

### Fix (`eloquent`, checkpoint `eloquent-semi-fixed`)

- `resolveProfileStyleApplyState()`; `syncStyleControlsFromPrefs(force)`; `colorPicker.endInteraction()`; profile-id guard in `mergePendingColorState`.

### Related files

- `src/settings/clip-profiles.ts`, `src/settings/user-preferences.ts`, `src/ui/design-studio/mount-clip-studio.ts`, `src/ui/design-studio/color-picker.ts`

---

## BUG-023 — Design Studio UI stale while rvnUserPrefs correct (2026-06)

### Symptoms

- `rvnUserPrefs` in Extension Storage has `activeProfileId`, `customBackgroundId`, custom styles — but studio stuck on default Neon Glow.
- Profile names in dropdown; selecting profiles/presets does nothing; Save as profile (no Clone); backgrounds not drawn.
- `rvnImageDb` + `rvnLastRecording` still work (direct IDB reads).

### Root cause

- Concurrent read-modify-write: `saveTranscriptPreferences` / `setSubtitlesEnabled` could overwrite in-flight `applyClipProfile` writes.
- Boot race: `mountClipStudio` and `reconcileBackgroundPreferences` loaded prefs in parallel; `onUserPreferencesChanged` could `applyPrefs` before hydration with stale in-memory state; `entryAppearance` captured on first listener pass.

### Fix (`eloquent`)

- Serialized prefs queue (`enqueuePrefsOp`) with atomic read+commit for `applyClipProfile`, `saveAppearancePreferences`, `saveTranscriptPreferences`.
- Design Studio boot: load → reconcile → mount with `initialPrefs`; `prefsHydrated` gate on storage listener.
- `runStudioPersist` surfaces errors on profile/style/alignment changes.

### Related files

- `src/settings/user-preferences.ts`, `entrypoints/design-studio/main.ts`, `src/ui/design-studio/mount-clip-studio.ts`
- `docs/eloquent-profile-checkpoint.md`

### Checkpoint tag

- **`eloquent-prefs-hydrated`** (`7c11796`) — profiles switch; canvas bg works; BUG-024 throw still open. See `docs/eloquent-profile-checkpoint-hydrated.md`.

---

## BUG-024 — getDraftConfig ReferenceError aborts applyPrefs (2026-06)

### Symptoms

- Profile select alert: `getDraftConfig is not defined`; console stack through `getProfileSnapshotConfig` → `isProfileDirty` → `syncProfileActions` → `applyPrefs`.
- Canvas may partially update (prefs write succeeds) but **background library dropdown** empty — `personalBackground.sync` never runs after throw.

### Root cause

- `getProfileSnapshotConfig` called bare `getDraftConfig()` inside returned object literal; only a sibling **method** existed, not a closure.

### Fix (`eloquent`)

- Local `buildDraftConfig()` inside `mountSubtitleControls`; shared by persist paths and returned handle.

### Related files

- `src/ui/design-studio/subtitle-controls.ts`