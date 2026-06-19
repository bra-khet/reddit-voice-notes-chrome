# Reddit Voice Notes — Session Progress

## Completed phases

| Phase | Status | Notes |
|-------|--------|-------|
| 0 | Done | WXT MV3 scaffold |
| 1 | Done | Shadow DOM injection, 🎤 button on `COMMENT-COMPOSER-HOST` / `RTE-TOOLBAR-BUTTON-VIDEO` |
| 2 | Done | Recorder panel, live waveform, WebM capture + download |
| 3 | Done | ffmpeg.wasm WebM → MP4 via offscreen document + background relay |

## Backlog (Phase 5+ polish — user requested)

- **Waveform visual polish**: explore low-impact customization options — themes, background styles, bar vs line renderer, glow intensity, user-selectable presets in settings popup.
- **Recorder panel**: optional anchor near composer vs fixed bottom-center.
- **Settings**: waveform style picker when time allows (spec MVP optional).

## Known fixes applied

- **Re-record bug (Phase 2)**: `disposeRecorderOnly()` was stopping mic audio tracks shared with `micStream`, causing silent/corrupt WebM on second recording. Fixed by only stopping canvas video tracks and fully rebuilding the media pipeline on "Record again".
- **FFmpeg messaging (Phase 3)**: Long transcode held a single `sendResponse` channel open (content → background → offscreen), causing "message channel closed". Fixed with two-phase protocol: quick ACK, then `TRANSCODE_COMPLETE` broadcast. Added offscreen ping/ready handshake.
- **FFmpeg progress stuck at 0% (Phase 3)**: (1) Lone `worker.js` blob URL broke ESM sibling imports — copy full `public/ffmpeg/esm/` bundle and load worker from extension URL. (2) Offscreen `runtime.sendMessage` progress never reached content scripts — background relays via `tabs.sendMessage`. (3) `web_accessible_resources` expanded to `ffmpeg/esm/*`.
- **FFmpeg blob import TypeError (Phase 3)**: `toBlobURL` for core/wasm produced `blob:chrome-extension://…` URLs that module workers cannot `import()`. Fixed by passing `chrome-extension://` URLs directly for `coreURL` and `wasmURL`.
- **FFmpeg exit code 1 (Phase 3)**: Hardened pipeline — WebM EBML validation, VP8-first recording, fallback transcode strategies with captured stderr in error messages.
- **WebM 0 bytes in offscreen (Phase 3)**: Typed arrays do not survive MV3 `runtime.sendMessage` relay. Fixed with **base64 string transport** (`webmBase64` / `mp4Base64` + byteLength) in `src/messaging/binary.ts`. Restored MediaRecorder timeslice + `finalizeMediaRecorder()` drain before blob assembly.

## Dev notes

- Do **not** add `dom` to `manifest.json` — Chromium reports it as unknown; injection works without it.
- **Do** declare `offscreen` in `manifest.json` — required for `chrome.offscreen.createDocument()` (MP4 transcoding).
- `npm audit fix --force` downgrades WXT — use `overrides` in `package.json` instead.