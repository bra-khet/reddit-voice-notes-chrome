# Reddit Voice Notes — Session Progress

## Stable checkpoint (handoff)

| Field | Value |
|-------|-------|
| **Tag** | `v0.1.0-phase3-stable` (pre–Phase 4 fallback) |
| **Date** | 2026-06-19 |
| **Milestone** | Phase 3 complete — semi-useful personal tool |

**Restore Phase 3 checkpoint**

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
| 1 | Done | Shadow DOM injection, mic button on comment composer |
| 2 | Done | Recorder panel, live waveform, WebM capture + download |
| 3 | Done | ffmpeg.wasm WebM → MP4 via offscreen document + background relay |
| 4 | Done | Polish: 3-min cap UX, cancel/discard, a11y, errors, dark/light, assets |

## Phase 4 deliverables

- **Assets organized**: `public/icon/{16,32,48,96,128}.png` (extension toolbar), `public/icon/mic.svg` (source), inline via `src/ui/icons/mic.ts`
- **Mic button**: SVG icon replaces emoji in injected toolbar button
- **3-minute cap UX**: elapsed progress bar, warning/critical timer colors (30s / 10s), auto-stop toast
- **Cancel flow**: Discard confirm while recording; cancel during processing; Escape to close
- **Accessibility**: `role="dialog"`, `aria-modal`, `aria-live` status/timer, focus restore, `focus-visible` rings
- **Error states**: Friendly messages (`src/utils/errors.ts`) + error toasts for mic denied, transcode fail, etc.
- **Theming**: Shared tokens (`src/ui/tokens.ts`), `prefers-color-scheme: light` on panel, toast, popup
- **Version**: `0.2.0`

## Architecture (unchanged core)

```
Reddit tab (content script)
  → record WebM (MediaRecorder + canvas waveform)
  → base64-pack WebM → background SW
  → offscreen document (FFmpeg WASM worker)
  → base64-pack MP4 → background relays progress/complete via tabs.sendMessage
  → content script → Download MP4
```

Key modules: `src/recorder/`, `src/reddit-injector/`, `src/ui/`, `src/ffmpeg/`, `src/messaging/binary.ts`, `entrypoints/background.ts`, `entrypoints/offscreen/`.

## Backlog (Phase 5+)

- **Reddit auto-attach**: DataTransfer / file input (Phase 5)
- **Waveform themes**: bar vs line, glow, settings presets (Phase 5+)
- **Keyboard shortcut**: Ctrl/Cmd+Shift+V (Phase 6)
- **Settings popup**: waveform style picker (Phase 6)

## Known limitations

- Must reload extension + hard-refresh Reddit tab after extension updates.
- Very long recordings (near 3 min) may stress base64 message size; chunked storage not implemented.
- Reddit auto-attach not implemented — manual MP4 upload to video comment.
- Processing cancel abandons UI; FFmpeg may still finish in offscreen (result discarded).
- Injection selectors may need updates when Reddit changes composer UI.

## Dev notes

- Do **not** add `dom` to manifest — unknown permission; injection works without it.
- Do **declare** `offscreen` in manifest — required for `chrome.offscreen.createDocument()`.
- `npm audit fix --force` downgrades WXT — use `overrides` in `package.json` instead.
- CSP: `script-src 'self' 'wasm-unsafe-eval'` on extension pages.
- `web_accessible_resources`: `ffmpeg/*`, `ffmpeg/esm/*`.

## Next up: Phase 5

Best-effort Reddit auto-attach to native video uploader. Confirm before starting.