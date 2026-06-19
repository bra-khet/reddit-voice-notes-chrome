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

## Dev notes

- Do **not** add `dom` to `manifest.json` — Chromium reports it as unknown; injection works without it.
- `npm audit fix --force` downgrades WXT — use `overrides` in `package.json` instead.