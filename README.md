# Reddit Voice Notes

A privacy-first Chrome Manifest V3 extension that records short voice notes directly in Reddit comment boxes and exports them as MP4 videos with an animated waveform — ready for Reddit's video-in-comments feature.

All recording, visualization, and transcoding happens **client-side** in the browser. The only data that leaves your machine is the final MP4 you choose to upload to Reddit.

## Status

**MVP complete (v1.0.0)** — record, transcode, download, auto-attach, keyboard shortcut, settings popup.

| Phase | Scope | Status |
|-------|-------|--------|
| 0 | Scaffold & project structure | Done |
| 1 | Permissions + Reddit button injection | Done |
| 2 | Recorder core (WebM, no FFmpeg) | Done |
| 3 | FFmpeg.wasm WebM → MP4 | Done |
| 4 | Polish, limits, error states | Done |
| 5 | Reddit auto-attach (best-effort) | Done |
| 6 | Shortcuts, settings popup, finalization | Done |

## Features

- Mic button injected next to Reddit's video icon (Shadow DOM–aware)
- Floating recorder with live waveform, 2-minute cap, discard/cancel flows
- Client-side WebM capture → FFmpeg.wasm MP4 (offscreen document)
- Download MP4 (primary, always reliable)
- Best-effort **Attach to Reddit** via native file input
- Configurable keyboard shortcut (default **Ctrl+Shift+X** / **⌘+Shift+X** on Mac) <-- ts broken sorry
- Settings popup to change shortcut, reload extension

## Tech stack

- **[WXT](https://wxt.dev)** — Manifest V3 extension framework with Vite, TypeScript, and hot reload
- **Vanilla TypeScript** — no framework in content scripts; Shadow DOM for UI
- **ffmpeg.wasm** — lazy-loaded client-side transcoding in an offscreen document

## Project layout

```
entrypoints/
  background.ts          # Service worker, offscreen orchestration, commands
  content.ts             # Runs on reddit.com only
  offscreen/             # FFmpeg WASM worker
  popup/                 # Settings popup (shortcut, reload)
public/
  icon/                  # Extension icons + mic.svg source
src/
  recorder/              # getUserMedia + canvas + MediaRecorder
  reddit-injector/       # DOM detection, injection, auto-attach, shortcuts
  settings/              # Shortcut config (chrome.storage.sync)
  ui/                    # Recorder panel, toasts, icons
  ffmpeg/                # Transcode messaging + ffmpeg-runner
  messaging/             # MV3 message types + base64 binary transport
wxt.config.ts
```

## Development

### Prerequisites

- Node.js 18+
- npm 9+
- Chrome or Edge (Chromium 120+)

### Setup

```bash
npm install
```

### Dev mode (hot reload)

```bash
npm run dev
```

Load `.output/chrome-mv3-dev/` in `chrome://extensions` (Developer mode → Load unpacked).

Visit [reddit.com](https://www.reddit.com), open a post with video comments enabled, and expand the comment box. You should see a microphone button next to Reddit's video icon.

### Usage

1. Click the mic button **or** press **Ctrl+Shift+X** (customizable in the extension popup) <-- ts broken sorry
2. Record → Stop → wait for FFmpeg → **Download MP4** or **Attach to Reddit**
3. Post your comment

### Production build

```bash
npm run build
```

Output: `.output/chrome-mv3/`

### Type check

```bash
npm run compile
```

### Package zip

```bash
npm run zip
```

## Permissions

| Permission | Purpose |
|------------|---------|
| `storage` | Persist keyboard shortcut settings |
| `offscreen` | FFmpeg WASM transcoding (Chrome 109+) |
| `host_permissions` for `reddit.com` | Content script injection |
| Microphone (runtime) | Requested when recording starts |

## Keyboard shortcut

- **Default:** `Ctrl+Shift+X` (Windows/Linux) / `⌘+Shift+X` (Mac)
- **Change:** Open the extension popup → click the shortcut field → press your combo
- **Chrome command:** Also registered as `open-voice-recorder` — rebindable at `chrome://extensions/shortcuts`

Shortcut works when a Reddit comment composer is available (focused or on page).

## MVP constraints

- **2-minute hard cap** on recordings (see `docs/bug-archive.md` for why not Reddit's 3:00)
- **MP4 output** (H.264 + AAC) for Reddit compatibility
- **Download path is primary** — auto-attach is best-effort
- **Client-side only** — no external servers except Reddit upload

## Updating for Reddit UI changes

Reddit-specific selectors and attach logic live in `src/reddit-injector/`. Search for `UPDATE WHEN REDDIT UI CHANGES`.

## Shadow DOM note

Reddit's comment toolbar lives inside web-component shadow trees. The extension walks open shadow roots (and optionally uses `chrome.dom.openOrClosedShadowRoot` when available). Do **not** add a `dom` permission to `manifest.json` — injection works without it.

## Known limitations

- Reload extension + hard-refresh Reddit after updates
- Very long recordings stress large base64 messages (~3 min near Chrome limits)
- Auto-attach may break when Reddit changes uploader UI — download always works
- `chrome://extensions/shortcuts` and popup shortcut settings are separate bindings

## Dev dependency security notes

`npm audit` may report vulnerabilities in WXT's **dev-only** toolchain. These are not shipped in the extension bundle. Use `overrides` in `package.json`. Do **not** run `npm audit fix --force` — it downgrades WXT.

## License

Private — MVP complete.