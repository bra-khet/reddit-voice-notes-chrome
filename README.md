# Reddit Voice Notes

A privacy-first Chrome Manifest V3 extension that records short voice notes directly in Reddit comment boxes and exports them as MP4 videos with an animated waveform — ready for Reddit's video-in-comments feature.

All recording, visualization, and transcoding happens **client-side** in the browser. The only data that leaves your machine is the final MP4 you choose to upload to Reddit.

## Status

**Phase 3 complete** — Lazy FFmpeg.wasm offscreen transcoding, MP4 download path.

| Phase | Scope | Status |
|-------|-------|--------|
| 0 | Scaffold & project structure | Done |
| 1 | Permissions + Reddit button injection | Done |
| 2 | Recorder core (WebM, no FFmpeg) | Done |
| 3 | FFmpeg.wasm WebM → MP4 | Done |
| 4 | Polish, limits, error states | Next |
| 5 | Reddit auto-attach (best-effort) | Planned |
| 6 | Icons, shortcuts, finalization | Planned |

## Tech stack

- **[WXT](https://wxt.dev)** — Manifest V3 extension framework with Vite, TypeScript, and hot reload
- **Vanilla TypeScript** — no framework in content scripts; Shadow DOM for UI
- **ffmpeg.wasm** — lazy-loaded client-side transcoding (Phase 3)

### Why WXT?

WXT gives first-class MV3 support (service worker, content scripts, popup, offscreen documents), TypeScript out of the box, and `wxt dev` hot reload — without the magic of heavier scaffolds. The spec's module layout maps cleanly onto WXT entrypoints + `src/` modules.

## Project layout

```
entrypoints/
  background.ts          # Service worker (offscreen/ffmpeg orchestration later)
  content.ts             # Thin entry — runs on reddit.com only
  popup/                 # Settings popup (version + reload)
public/
  icon/                  # Extension icons (16–128px)
src/
  recorder/              # getUserMedia + canvas + MediaRecorder
  reddit-injector/       # DOM detection, button injection (UPDATE WHEN REDDIT UI CHANGES)
  ui/                    # Floating recorder panel, toasts
  utils/                 # Shared constants and helpers
  ffmpeg/                # Lazy ffmpeg.wasm transcoding
wxt.config.ts            # Manifest + WXT configuration
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

WXT writes the unpacked extension to `.output/chrome-mv3-dev/`. Load that folder in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `.output/chrome-mv3-dev`

Visit [reddit.com](https://www.reddit.com), open a post with video comments enabled, and expand the comment box. You should see a 🎤 button next to Reddit's video icon. Console output:

```
[Reddit Voice Notes] Content script loaded on www.reddit.com
[Reddit Voice Notes] Reddit injector starting (Phase 1)
[Reddit Voice Notes] Composer MutationObserver started
[Reddit Voice Notes] Injected voice note button
```

Click the 🎤 button to open the recorder panel. Record → Stop → wait for FFmpeg → Download MP4.

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
| `storage` | Persist minimal settings |
| `offscreen` | FFmpeg WASM transcoding in a hidden document (Chrome 109+) |
| `host_permissions` for `reddit.com` | Content script injection |
| Microphone (runtime) | Requested when user starts recording (Phase 1+) |

## MVP constraints

- **3-minute hard cap** on recordings
- **MP4 output** (H.264 + AAC) — Reddit reliably accepts MP4/MOV
- **Download path is primary** — auto-attach to Reddit uploader is best-effort
- **Client-side only** — no external servers except Reddit upload

## Updating for Reddit UI changes

All Reddit-specific selectors and injection logic live in `src/reddit-injector/`. Look for `UPDATE WHEN REDDIT UI CHANGES` comments when Reddit ships UI updates.

## Shadow DOM note

Reddit's comment toolbar lives inside web-component shadow trees. The extension walks open shadow roots (and optionally uses `chrome.dom.openOrClosedShadowRoot` when available). Do **not** add a `dom` entry to `manifest.json` — Chromium flags it as an unknown permission; it is not required for injection to work.

## Dev dependency security notes

`npm audit` may report vulnerabilities in WXT's **dev-only** toolchain (`web-ext-run`, `esbuild`, etc.). These packages are not shipped in the extension bundle. We pin patched versions via `overrides` in `package.json`. Do **not** run `npm audit fix --force` — it downgrades WXT to an ancient incompatible release.

## License

Private — MVP in active development.