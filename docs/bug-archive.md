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

- **Recording cap reduced to 2:00** — `DISPLAY_MAX_RECORDING_SECONDS = 120`, enforced stop at 118s. Sacrifices Reddit's nominal 3:00 headroom for pipeline stability and room for theme/personalization features.
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