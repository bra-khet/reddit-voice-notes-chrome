# Reddit Voice Notes — Session Progress

## Completed phases

| Phase | Status | Notes |
|-------|--------|-------|
| 0 | Done | WXT MV3 scaffold |
| 1 | Done | Shadow DOM injection, mic button on comment composer |
| 2 | Done | Recorder panel, live waveform, WebM capture + download |
| 3 | Done | ffmpeg.wasm WebM → MP4 via offscreen document + background relay |
| 4 | Done | Polish: 3-min cap UX, cancel/discard, a11y, errors, dark/light, assets |
| 5 | Done | Best-effort Reddit auto-attach via file input / dropzone |

## Phase 5 deliverables

- **`src/reddit-injector/video-attach.ts`**: Finds Reddit video file input (Shadow DOM), clicks video button to reveal if needed, assigns MP4 via `DataTransfer`, dispatches `change`/`input`; dropzone fallback
- **Composer context**: Recorder panel tracks which comment box opened it
- **Success UI**: Download MP4 (primary) + Attach to Reddit (secondary) + Record again (tertiary link)
- **Graceful fallback**: Clear toast if attach fails; download path unchanged
- **Selectors**: `FILE_INPUT_SELECTORS`, `DROPZONE_SELECTORS` in `selectors.ts` (UPDATE WHEN REDDIT UI CHANGES)
- **Version**: `0.3.0`

## Mic icon (Phase 4 tweak)

- Toolbar mic uses muted gray (`#818384`) via CSS on `.rvn-mic-icon` — SVG `stroke="currentColor"` inherits it

## Architecture

```
Reddit tab (content script)
  → record WebM → base64 → offscreen FFmpeg → MP4
  → Download MP4 (always works)
  → optional: attachMp4ToComposer() → Reddit file input / dropzone
```

## Known limitations

- Auto-attach is **best-effort** — Reddit UI changes may break it; download always works
- Must reload extension + hard-refresh Reddit after updates
- Very long recordings may stress base64 message size
- Injection/attach selectors need manual updates when Reddit changes composer UI

## Next up: Phase 6

Keyboard shortcut, settings popup polish, README finalization, manifest metadata.