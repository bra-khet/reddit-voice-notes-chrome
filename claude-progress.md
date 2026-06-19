# Reddit Voice Notes — Session Progress

## Stable checkpoint (handoff)

| Field | Value |
|-------|-------|
| **Tag** | `v0.1.0-phase3-stable` |
| **Date** | 2026-06-19 |
| **Commit** | `git rev-parse v0.1.0-phase3-stable` |
| **Milestone** | Phase 3 complete — semi-useful personal tool |

**What works at this tag**

- 🎤 Button injection on Reddit comment composers (Shadow DOM–aware)
- Floating recorder panel: live waveform, timer, record/stop/cancel
- Client-side WebM capture (mic + canvas video track)
- Lazy FFmpeg.wasm transcoding in offscreen document → downloadable MP4
- Progress UI during WASM load and transcode
- Privacy-first: all processing local; only MP4 download leaves the machine

**Intentionally not done yet (later phases)**

- Phase 4: polish, 3-minute cap UX, accessibility, richer error states
- Phase 5: best-effort Reddit auto-attach to native video uploader
- Phase 6: icons, keyboard shortcut, settings popup, README finalization

**Restore this checkpoint**

```bash
git fetch --tags
git checkout v0.1.0-phase3-stable
npm install
npm run dev
# Load .output/chrome-mv3-dev in chrome://extensions, reload + hard-refresh Reddit
```

---

## Completed phases

| Phase | Status | Notes |
|-------|--------|-------|
| 0 | Done | WXT MV3 scaffold |
| 1 | Done | Shadow DOM injection, 🎤 button on `COMMENT-COMPOSER-HOST` / `RTE-TOOLBAR-BUTTON-VIDEO` |
| 2 | Done | Recorder panel, live waveform, WebM capture + download |
| 3 | Done | ffmpeg.wasm WebM → MP4 via offscreen document + background relay |

## Architecture (Phase 3)

```
Reddit tab (content script)
  → record WebM (MediaRecorder + canvas waveform)
  → base64-pack WebM → background SW
  → offscreen document (FFmpeg WASM worker)
  → base64-pack MP4 → background relays progress/complete via tabs.sendMessage
  → content script → Download MP4
```

Key modules: `src/recorder/`, `src/reddit-injector/`, `src/ui/`, `src/ffmpeg/`, `src/messaging/binary.ts`, `entrypoints/background.ts`, `entrypoints/offscreen/`.

FFmpeg assets: `public/ffmpeg/` (gitignored; copied on `npm install` via `scripts/copy-ffmpeg-core.mjs`).

## Backlog (Phase 5+ polish — user requested)

- **Waveform visual polish**: themes, bar vs line, glow, settings presets
- **Recorder panel**: optional anchor near composer vs fixed bottom-center
- **Settings**: waveform style picker when time allows

## Known fixes applied (Phase 3 debugging)

- **Re-record bug (Phase 2)**: Only stop canvas video tracks after each take; rebuild mic pipeline on "Record again".
- **FFmpeg messaging**: Two-phase protocol (ACK + broadcast) — avoids "message channel closed".
- **FFmpeg worker load**: Full `public/ffmpeg/esm/` bundle; worker from extension URL; core/wasm from extension URLs (not blob).
- **Progress relay**: Offscreen `runtime.sendMessage` → background `tabs.sendMessage` → content script.
- **Binary transport**: `Uint8Array`/`ArrayBuffer` stripped across MV3 relay — use `webmBase64` / `mp4Base64` + `byteLength` (`src/messaging/binary.ts`).
- **Recording**: VP8-first, 1s timeslice, `finalizeMediaRecorder()` chunk drain, explicit bitrates.

## Known limitations at stable tag

- Must reload extension + hard-refresh Reddit tab after extension updates.
- Very long recordings (near 3 min) may stress base64 message size; chunked storage not implemented.
- Reddit auto-attach not implemented — manual MP4 upload to video comment.
- Injection selectors may need updates when Reddit changes composer UI.
- Tested primarily on modern Chrome; Edge (Chromium) expected to work.

## Dev notes

- Do **not** add `dom` to manifest — unknown permission; injection works without it.
- **Do** declare `offscreen` in manifest — required for `chrome.offscreen.createDocument()`.
- `npm audit fix --force` downgrades WXT — use `overrides` in `package.json` instead.
- CSP: `script-src 'self' 'wasm-unsafe-eval'` on extension pages.
- `web_accessible_resources`: `ffmpeg/*`, `ffmpeg/esm/*`.

## Next up: Phase 4

Polish, limits UX, cancel flow, accessibility, dark-mode refinements, clearer error states. Confirm before starting.